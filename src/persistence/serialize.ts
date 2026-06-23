/**
 * Save / load / share. A design is plain JSON, so:
 *  - download/upload is just a Blob of that JSON;
 *  - sharing is the same JSON, compressed into the URL hash (no backend);
 *  - localStorage auto-restores the last session.
 *
 * The encoding is intentionally simple and dependency-free. We URI-encode the
 * JSON and base64 it for the hash so links survive copy/paste.
 */

import type { Design } from '../kinematics/model';

export const STORAGE_KEY = 'kinematix:lastDesign';
const HASH_PREFIX = '#d=';

/** Round-trip-safe pretty JSON for file download. */
export function designToJson(design: Design): string {
  return JSON.stringify(design, null, 2);
}

export function jsonToDesign(json: string): Design {
  const obj = JSON.parse(json);
  return validateDesign(obj);
}

/**
 * Structural AND referential validation, so a hand-edited file or a stale share
 * link fails loudly here rather than throwing deep in the solver (which would
 * white-screen the app). Every id referenced by a link, the shock, the axle and
 * the bottom bracket must resolve to a real point.
 */
export function validateDesign(obj: unknown): Design {
  if (!obj || typeof obj !== 'object') throw new Error('Not a design');
  const d = obj as Partial<Design>;
  if (d.version !== 1) throw new Error('Unsupported design version');
  if (!Array.isArray(d.points) || d.points.length < 2) throw new Error('Design has no points');
  if (!Array.isArray(d.links)) throw new Error('Design has no links');
  if (!d.shock || !d.axleId || !d.bbId || !d.metrics) throw new Error('Design is incomplete');

  // Every point needs a usable id and finite coordinates.
  const ids = new Set<string>();
  for (const p of d.points) {
    if (!p || typeof p.id !== 'string' || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error('A point is malformed');
    }
    if (ids.has(p.id)) throw new Error(`Duplicate point id: ${p.id}`);
    ids.add(p.id);
  }

  const requireId = (id: string, what: string) => {
    if (!ids.has(id)) throw new Error(`${what} references a missing point: ${id}`);
  };
  for (const l of d.links) {
    if (!l || typeof l.a !== 'string' || typeof l.b !== 'string') throw new Error('A link is malformed');
    requireId(l.a, 'A link');
    requireId(l.b, 'A link');
  }
  if (typeof d.shock.frame !== 'string' || typeof d.shock.link !== 'string') throw new Error('Shock is malformed');
  requireId(d.shock.frame, 'The shock');
  requireId(d.shock.link, 'The shock');
  requireId(d.axleId, 'The axle');
  requireId(d.bbId, 'The bottom bracket');
  if (!Number.isFinite(d.shock.eyeToEye) || !Number.isFinite(d.shock.stroke) || d.shock.stroke <= 0) {
    throw new Error('Shock length/stroke is invalid');
  }

  return d as Design;
}

// --- URL hash sharing -------------------------------------------------------

/** Base64 (URL-safe) encode a UTF-8 string. */
function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64decode(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function designToHash(design: Design): string {
  return HASH_PREFIX + b64encode(JSON.stringify(design));
}

/** Parse a design out of a location hash, or null if none / invalid. */
export function designFromHash(hash: string): Design | null {
  if (!hash || !hash.startsWith(HASH_PREFIX)) return null;
  try {
    return validateDesign(JSON.parse(b64decode(hash.slice(HASH_PREFIX.length))));
  } catch {
    return null;
  }
}

// --- localStorage -----------------------------------------------------------

export function saveLast(design: Design): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    /* storage may be unavailable (private mode); ignore */
  }
}

export function loadLast(): Design | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validateDesign(JSON.parse(raw));
  } catch {
    return null;
  }
}
