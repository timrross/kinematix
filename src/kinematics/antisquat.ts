/**
 * Anti-squat and anti-rise via the standard instant-force-centre geometric
 * construction. These are the metrics most sensitive to error, so the
 * construction here follows a documented reference rather than an invented
 * formula, and is validated against the canonical 100% definition in
 * antisquat.test.ts.
 *
 * Reference construction (as described in the Pinkbike "Behind the Numbers" /
 * "What is Anti-Squat" methodology and in US patent literature on bicycle
 * suspension, e.g. US 7,909,347):
 *
 *   1. Find the instant centre (IC) of the rear-wheel-carrying body relative to
 *      the front triangle.
 *   2. Draw the "force line" through the rear axle and the IC.
 *   3. Draw the "chain force line": the line of the upper (tensioned) chain run,
 *      i.e. the common external tangent across the tops of the chainring and the
 *      rear cog.
 *   4. Let P be the intersection of the force line and the chain force line.
 *   5. Draw the "anti-squat line" from the rear-wheel contact patch through P.
 *   6. Measure the height H at which that line crosses the vertical through the
 *      front axle.
 *   7. Anti-squat % = H / (centre-of-gravity height) × 100.
 *      It is exactly 100% when the anti-squat line passes through the point one
 *      CoG-height directly above the front axle.
 *
 * Anti-rise is the same construction family for braking. Because the brake
 * caliper is fixed to the rear-wheel-carrying body, the braking force line runs
 * straight from the rear contact patch through the IC (there is no chain to
 * modify it). Anti-rise % is then the height of that line at the front-axle
 * vertical, divided by the CoG height.
 *
 * Coordinates: ground at y = 0, +x rearward. See model.ts.
 */

import type { XY } from './solver';

/** Half-inch chain pitch in mm. */
const CHAIN_PITCH = 12.7;

export interface ChassisInputs {
  /** Chainring centre (bottom bracket), solved position. */
  bb: XY;
  /** Rear axle, solved position (the rear contact patch sits at (x, 0) below it). */
  rearAxle: XY;
  /** Instant centre of the rear carrier relative to the frame at this frame. */
  ic: XY | null;
  /**
   * Horizontal position of the front-axle vertical, in world mm. The front wheel
   * is fixed to the front triangle, so this is constant across travel — it is
   * the home rear-axle x minus the wheelbase, NOT the moving per-frame axle.
   */
  frontContactX: number;
  cogHeight: number;
  chainringTeeth: number;
  cogTeeth: number;
}

// Note: tyre radii do not enter this construction. The rear contact patch is the
// ground point directly below the (solved) axle, and the anti-squat line height
// is sampled at the front-axle *x* and divided by CoG height; the front wheel's
// radius never appears. Tyre radii are used only for drawing the wheels.

function pitchRadius(teeth: number): number {
  return (teeth * CHAIN_PITCH) / (2 * Math.PI);
}

/** Intersection of line p1→p2 and line p3→p4 (infinite lines). Null if parallel. */
function intersect(p1: XY, p2: XY, p3: XY, p4: XY): XY | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;
  const a = p1.x * p2.y - p1.y * p2.x;
  const b = p3.x * p4.y - p3.y * p4.x;
  return {
    x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d,
    y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d,
  };
}

/** Height (y) of the line through a→b evaluated at x = xq. Null if vertical. */
function heightAtX(a: XY, b: XY, xq: number): number | null {
  if (Math.abs(a.x - b.x) < 1e-9) return null;
  const t = (xq - a.x) / (b.x - a.x);
  return a.y + t * (b.y - a.y);
}

/**
 * The upper (tensioned) chain run: the common external tangent across the tops
 * of two circles (chainring at the BB, cog at the axle). Returns two points on
 * that line.
 *
 * We seek a unit normal n=(a,b) pointing up, away from the circle centres, such
 * that each centre sits a radius below the line. The tangent points are then
 * centre + radius·n.
 */
export function chainLine(
  bb: XY,
  axle: XY,
  ringRadius: number,
  cogRadius: number,
): { p: XY; q: XY } | null {
  // Solve for the normal direction. With centres C1 (ring) and C2 (cog) each a
  // radius below the line: n·C1 - c = -r1, n·C2 - c = -r2  =>  n·(C1-C2) = r2-r1.
  const ux = bb.x - axle.x;
  const uy = bb.y - axle.y;
  const ulen = Math.hypot(ux, uy);
  if (ulen < 1e-9) return null;
  const rhs = (cogRadius - ringRadius) / ulen; // = cos(φ - ψ)
  if (Math.abs(rhs) > 1) return null;
  const psi = Math.atan2(uy, ux);
  const delta = Math.acos(rhs);
  // Two external tangents (φ = psi ± delta). Pick the one whose normal points
  // up (b > 0): that is the upper chain run.
  const candidates = [psi + delta, psi - delta];
  let best: { p: XY; q: XY } | null = null;
  let bestB = -Infinity;
  for (const phi of candidates) {
    const a = Math.cos(phi);
    const b = Math.sin(phi);
    // Tangent points: centre + radius · n.
    const p = { x: bb.x + ringRadius * a, y: bb.y + ringRadius * b };
    const q = { x: axle.x + cogRadius * a, y: axle.y + cogRadius * b };
    if (b > bestB) {
      bestB = b;
      best = { p, q };
    }
  }
  return best;
}

/**
 * Anti-squat percentage at one solved frame. Returns null if the construction
 * degenerates (e.g. parallel lines at an instant-centre-at-infinity layout) or
 * the inputs are non-physical (non-positive CoG height).
 */
export function antiSquat(c: ChassisInputs): number | null {
  if (!c.ic || !(c.cogHeight > 0)) return null;
  const rcp: XY = { x: c.rearAxle.x, y: 0 }; // rear contact patch on the ground
  const ring = pitchRadius(c.chainringTeeth);
  const cog = pitchRadius(c.cogTeeth);
  const chain = chainLine(c.bb, c.rearAxle, ring, cog);
  if (!chain) return null;

  // P = (axle–IC force line) ∩ (chain force line).
  const p = intersect(c.rearAxle, c.ic, chain.p, chain.q);
  if (!p) return null;

  // Anti-squat line from the rear contact patch through P, sampled at the front
  // axle vertical.
  const h = heightAtX(rcp, p, c.frontContactX);
  if (h === null) return null;
  return (h / c.cogHeight) * 100;
}

/**
 * Anti-rise percentage at one solved frame. Braking force line runs from the
 * rear contact patch through the instant centre (the caliper is on the rear
 * carrier), sampled at the front-axle vertical.
 */
export function antiRise(c: ChassisInputs): number | null {
  if (!c.ic || !(c.cogHeight > 0)) return null;
  const rcp: XY = { x: c.rearAxle.x, y: 0 };
  const h = heightAtX(rcp, c.ic, c.frontContactX);
  if (h === null) return null;
  return (h / c.cogHeight) * 100;
}
