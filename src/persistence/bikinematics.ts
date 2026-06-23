/**
 * Import a BiKinematics trace (https://github.com/mark-bak/BiKinematics) into a
 * Kinematix design, so any side-profile trace someone has made drops straight in
 * as an example.
 *
 * BiKinematics stores points in *pixels* (with a `p2mm` pixel→mm scale), x
 * increasing toward the front of the bike, y up. We convert to our convention:
 * millimetres, x increasing rearward with the bottom bracket at the origin, and
 * the ground at y = 0 with the rear axle grounded at the tyre radius.
 *
 * The geometry is treated as a factual measurement and re-expressed here; the
 * file's `shock` link becomes our driver (not a rigid member), and the front
 * wheel marker is dropped (we derive the front contact from the wheelbase).
 *
 * Provenance note: these traces are reverse-engineered estimates, not official
 * manufacturer geometry — the imported design is flagged as such.
 */

import { distance, getPoint, type Design, type Link, type Point } from '../kinematics/model';
import { validateDesign } from './serialize';

interface BkPoint {
  name?: string;
  type: string; // ground | linkage | rear_wheel | front_wheel | bottom_bracket
  pos: [number, number];
}
interface BkLink {
  name?: string;
  a: string;
  b: string;
}
interface BkFile {
  points: Record<string, BkPoint>;
  links: Record<string, BkLink>;
  shock: string;
  params?: Record<string, string | number>;
}

/** Looks like a BiKinematics file (vs our own Design)? */
export function isBiKinematics(obj: unknown): obj is BkFile {
  const o = obj as Partial<BkFile> | null;
  return !!o && typeof o === 'object' && !!o.points && !!o.links && typeof o.shock === 'string';
}

function tyreRadiusFor(wheelSize: string): number {
  const s = wheelSize.replace(/["\s]/g, '');
  if (s.startsWith('27') || s === '650b') return 350; // 27.5"
  return 367; // 29" default
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'p';
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

export function fromBiKinematics(obj: unknown): Design {
  if (!isBiKinematics(obj)) throw new Error('Not a BiKinematics file');
  const file = obj;
  const params = file.params ?? {};
  const p2mm = num(params.p2mm, 1) || 1;
  const tyreR = tyreRadiusFor(String(params.wheel_size ?? '29'));

  const entries = Object.entries(file.points);
  const byType = (t: string) => entries.find(([, v]) => v.type === t);
  const bb = byType('bottom_bracket');
  const axle = byType('rear_wheel');
  const front = byType('front_wheel');
  if (!bb) throw new Error('BiKinematics file has no bottom_bracket point');
  if (!axle) throw new Error('BiKinematics file has no rear_wheel point');

  // Transform: px→mm, mirror x about the BB (rear becomes +x), ground the rear
  // axle at the tyre radius.
  const bbXmm = bb[1].pos[0] * p2mm;
  const axleYmm = axle[1].pos[1] * p2mm;
  const tx = (pos: [number, number]) => Math.round((bbXmm - pos[0] * p2mm) * 100) / 100;
  const ty = (pos: [number, number]) => Math.round((pos[1] * p2mm - axleYmm + tyreR) * 100) / 100;

  // Build points, dropping the front-wheel marker (not a mechanism point).
  const idByKey = new Map<string, string>();
  const usedIds = new Set<string>();
  const points: Point[] = [];
  for (const [key, v] of entries) {
    if (v.type === 'front_wheel') continue;
    let id = slug(key);
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);
    idByKey.set(key, id);
    const fixed = v.type === 'ground' || v.type === 'bottom_bracket';
    points.push({ id, name: v.name ?? key, x: tx(v.pos), y: ty(v.pos), fixed });
  }

  // The shock link is the driver, not a rigid member.
  const shockLink = file.links[file.shock];
  if (!shockLink) throw new Error(`BiKinematics shock link "${file.shock}" not found`);
  const shockA = idByKey.get(shockLink.a);
  const shockB = idByKey.get(shockLink.b);
  if (!shockA || !shockB) throw new Error('BiKinematics shock link references an unknown point');
  // Orient the shock so `frame` is the frame-fixed end where possible.
  const aFixed = points.find((p) => p.id === shockA)?.fixed;
  const frame = aFixed ? shockA : shockB;
  const link = aFixed ? shockB : shockA;

  // Rigid links: everything except the shock, skipping any link touching a point
  // we dropped (e.g. the front wheel).
  const links: Link[] = [];
  for (const [key, l] of Object.entries(file.links)) {
    if (key === file.shock) continue;
    const a = idByKey.get(l.a);
    const b = idByKey.get(l.b);
    if (!a || !b) continue;
    links.push({ id: slug(key), a, b });
  }

  // Wheelbase: prefer the stated value, else the rear→front wheel span.
  let wheelbase = num(params.wheelbase, 0);
  if (!(wheelbase > 0) && front) {
    wheelbase = Math.abs(front[1].pos[0] - axle[1].pos[0]) * p2mm;
  }
  if (!(wheelbase > 0)) wheelbase = 1240;

  const design: Design = {
    version: 1,
    name: String(params.name ?? 'Imported bike'),
    note: 'Imported from a BiKinematics trace — a reverse-engineered estimate, not official geometry. Set the shock stroke to match the real bike.',
    points,
    links,
    // eyeToEye is filled from the drawn distance below; stroke is unknown in the
    // file, so we default to a typical value the rider can adjust.
    shock: { frame, link, eyeToEye: 0, stroke: 62.5 },
    axleId: idByKey.get(axle[0])!,
    bbId: idByKey.get(bb[0])!,
    metrics: {
      chainringTeeth: Math.round(num(params.chainring_teeth, 32)),
      cogTeeth: Math.round(num(params.cassette_teeth, 32)),
      cogHeight: num(params.cog_height, 1050),
      wheelbase: Math.round(wheelbase),
      rearTyreRadius: tyreR,
      frontTyreRadius: tyreR,
      touched: true,
    },
  };

  // The drawn geometry is the home configuration → eyeToEye is the drawn shock
  // length (full precision, so the first solve reproduces the drawing exactly).
  design.shock.eyeToEye = distance(getPoint(design, frame), getPoint(design, link));

  // Referential validation, same as any loaded design.
  return validateDesign(design);
}

/**
 * Parse a loaded file as either a native Kinematix design or a BiKinematics
 * trace, whichever it is. Throws a helpful error if it is neither.
 */
export function parseAnyDesign(json: string): Design {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON');
  }
  if (isBiKinematics(obj)) return fromBiKinematics(obj);
  return validateDesign(obj);
}
