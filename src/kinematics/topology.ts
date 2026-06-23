/**
 * Pure topology editing: add/remove pivots and links, assign roles, and keep the
 * shock's home length consistent. Every function returns a NEW design (deep
 * cloned) and never mutates its input — the store and undo history rely on that.
 * Guarded operations return a small result object so the UI can explain refusals.
 *
 * Zero React, zero store imports — same purity contract as model.ts / presets.ts.
 */

import { cloneDesign, distance, getPoint, type Design } from './model';

export interface TopoResult {
  design: Design;
  ok: boolean;
  reason?: string;
}

export interface AddPointResult {
  design: Design;
  id: string;
}

// --- queries ---------------------------------------------------------------

/**
 * Mobility (Grübler/Kutzbach for this planar, pin-jointed model): each free
 * point is 2 unknowns, each rigid link removes 1, and the shock removes 1. Zero
 * means a properly driven 1-DOF mechanism. This is a cheap integer, so the live
 * "degrees of freedom" badge can use it without running the solver.
 */
export function computeMobility(d: Design): number {
  const free = d.points.reduce((n, p) => (p.fixed ? n : n + 1), 0);
  return 2 * free - (d.links.length + 1);
}

/**
 * Whether a design is referentially sound enough to persist / reload (mirrors
 * what validateDesign requires). Does NOT require mobility 0 — an
 * under-constrained but well-formed work-in-progress is still worth keeping.
 */
export function isComplete(d: Design): boolean {
  if (d.points.length < 2) return false;
  const ids = new Set(d.points.map((p) => p.id));
  if (ids.size !== d.points.length) return false;
  for (const l of d.links) if (!ids.has(l.a) || !ids.has(l.b)) return false;
  if (!ids.has(d.shock.frame) || !ids.has(d.shock.link)) return false;
  if (d.shock.frame === d.shock.link) return false;
  if (!ids.has(d.axleId) || !ids.has(d.bbId)) return false;
  return d.shock.stroke > 0;
}

function linkExists(d: Design, a: string, b: string): boolean {
  return d.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
}

function nextNumberedId(existing: Set<string>, prefix: string): { id: string; n: number } {
  let n = 1;
  while (existing.has(`${prefix}-${n}`)) n++;
  return { id: `${prefix}-${n}`, n };
}

// --- the shock's home length ------------------------------------------------

/**
 * The drawn geometry is the fully-extended (home) configuration, so the shock's
 * eye-to-eye length must equal the current distance between its mount points.
 * This is the single source of truth — presets.finalize and the store both call
 * it, so the home configuration can never drift out of sync with the geometry.
 */
export function recomputeEyeToEye(d: Design): Design {
  const eyeToEye = distance(getPoint(d, d.shock.frame), getPoint(d, d.shock.link));
  return { ...d, shock: { ...d.shock, eyeToEye } };
}

// --- mutations -------------------------------------------------------------

export function addPoint(
  d: Design,
  x: number,
  y: number,
  opts?: { name?: string; fixed?: boolean },
): AddPointResult {
  const out = cloneDesign(d);
  const { id, n } = nextNumberedId(new Set(out.points.map((p) => p.id)), 'p');
  out.points.push({
    id,
    name: opts?.name ?? `Pivot ${n}`,
    x,
    y,
    fixed: opts?.fixed ?? false,
  });
  return { design: out, id };
}

/**
 * Remove a point and every link touching it. Refuses if the point currently
 * fills a role (axle / bottom bracket / shock mount) — reassign the role first.
 */
export function removePoint(d: Design, id: string): TopoResult {
  if (id === d.axleId) return { design: d, ok: false, reason: 'This is the rear axle — assign the axle to another point first.' };
  if (id === d.bbId) return { design: d, ok: false, reason: 'This is the bottom bracket — assign it to another point first.' };
  if (id === d.shock.frame || id === d.shock.link) {
    return { design: d, ok: false, reason: 'This is a shock mount — reassign the shock first.' };
  }
  if (!d.points.some((p) => p.id === id)) return { design: d, ok: false, reason: 'No such point.' };

  const out = cloneDesign(d);
  out.points = out.points.filter((p) => p.id !== id);
  out.links = out.links.filter((l) => l.a !== id && l.b !== id);
  return { design: out, ok: true };
}

export function addLink(d: Design, a: string, b: string): TopoResult {
  if (a === b) return { design: d, ok: false, reason: 'A link needs two different pivots.' };
  if (!d.points.some((p) => p.id === a) || !d.points.some((p) => p.id === b)) {
    return { design: d, ok: false, reason: 'Unknown pivot.' };
  }
  if (linkExists(d, a, b)) return { design: d, ok: false, reason: 'Those pivots are already linked.' };

  const out = cloneDesign(d);
  const { id } = nextNumberedId(new Set(out.links.map((l) => l.id)), 'l');
  out.links.push({ id, a, b });
  return { design: out, ok: true };
}

export function removeLink(d: Design, id: string): Design {
  const out = cloneDesign(d);
  out.links = out.links.filter((l) => l.id !== id);
  return out;
}

export function setFixed(d: Design, id: string, fixed: boolean): Design {
  const out = cloneDesign(d);
  const p = out.points.find((pt) => pt.id === id);
  if (p) p.fixed = fixed;
  return out;
}

export function setAxle(d: Design, id: string): Design {
  return { ...cloneDesign(d), axleId: id };
}

export function setBb(d: Design, id: string): Design {
  return { ...cloneDesign(d), bbId: id };
}

/** Reassign a shock endpoint; rejects making both ends the same point. */
export function setShockEnd(d: Design, which: 'frame' | 'link', id: string): TopoResult {
  const other = which === 'frame' ? d.shock.link : d.shock.frame;
  if (id === other) return { design: d, ok: false, reason: 'The shock ends must be two different points.' };
  if (!d.points.some((p) => p.id === id)) return { design: d, ok: false, reason: 'Unknown pivot.' };
  const out = cloneDesign(d);
  out.shock = { ...out.shock, [which]: id };
  return { design: recomputeEyeToEye(out), ok: true };
}

// --- photo-trace calibration ------------------------------------------------

/**
 * Scale from a known reference. Given two points clicked on the photo (in image
 * pixels) and the real distance between them in mm, returns mm-per-image-pixel.
 * This is the explicit calibration that keeps a traced design honest despite a
 * photo's perspective error. Returns 0 for a degenerate (zero-length) reference.
 */
export function calibrateScale(
  pxA: { x: number; y: number },
  pxB: { x: number; y: number },
  realMm: number,
): number {
  const pxDist = Math.hypot(pxB.x - pxA.x, pxB.y - pxA.y);
  if (pxDist <= 0) return 0;
  return realMm / pxDist;
}
