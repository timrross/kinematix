/**
 * Derived metrics. Everything here is computed from a solved sweep — the solver
 * is the single source of truth, and these are just post-processing.
 *
 * Each metric has a plain-English one-liner (see EXPLAINERS) surfaced in the UI.
 */

import type { Design } from './model';
import type { SweepResult, SweepFrame } from './sweep';
import type { XY } from './solver';
import { antiSquat, antiRise, type ChassisInputs } from './antisquat';

/** Half-inch chain pitch in mm — the standard bicycle chain pitch. */
const CHAIN_PITCH = 12.7;

export interface LeveragePoint {
  /** Wheel (vertical axle) travel at this step, mm. */
  travel: number;
  /** Shock stroke consumed, mm. */
  shockTravel: number;
  /** Leverage ratio = d(travel)/d(shockTravel). */
  lr: number;
}

export interface AxlePoint {
  /** Horizontal axle displacement from the start; +ve is rearward. */
  rearward: number;
  /** Vertical axle displacement from the start; +ve is up (into travel). */
  vertical: number;
  travel: number;
}

export interface KickbackPoint {
  travel: number;
  /** Crank rotation (degrees) caused by chain growth — pedal kickback. */
  degrees: number;
}

export interface PercentPoint {
  travel: number;
  /** Percentage value, or null where the construction degenerates. */
  percent: number | null;
}

export interface InstantCentrePoint {
  travel: number;
  /** Instant centre of the rear wheel carrier relative to the frame. */
  ic: XY | null;
}

export interface Metrics {
  /** Vertical axle travel at every frame, mm. */
  travel: number[];
  /** Leverage ratio curve, sampled at every frame. */
  leverage: LeveragePoint[];
  /** Total usable rear-wheel travel (max vertical axle displacement), mm. */
  totalTravel: number;
  /**
   * Progressivity %: (initial LR − final LR) / initial LR × 100. Positive means
   * the suspension gets firmer (more progressive) deeper into travel.
   */
  progressivity: number;
  axlePath: AxlePoint[];
  kickback: KickbackPoint[];
  /** Instant centre at every frame (four-bars only; single pivot = the pivot). */
  instantCentre: InstantCentrePoint[];
  /** Anti-squat % across travel. */
  antiSquat: PercentPoint[];
  /** Anti-rise % across travel. */
  antiRise: PercentPoint[];
  /** Anti-squat % at the sag point (~30% travel) — the headline single number. */
  antiSquatAtSag: number | null;
  /**
   * The two point ids whose rigid motion defines the instant centre (the axle
   * plus a co-moving carrier point). Used by the UI to draw the construction.
   * Null when the topology has no well-defined wheel carrier.
   */
  carrierRefs: [string, string] | null;
}

/** Central-difference derivative of y w.r.t. x on an irregular-but-monotonic grid. */
export function derivative(x: number[], y: number[]): number[] {
  const n = x.length;
  const d = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      d[i] = (y[1] - y[0]) / (x[1] - x[0]);
    } else if (i === n - 1) {
      d[i] = (y[n - 1] - y[n - 2]) / (x[n - 1] - x[n - 2]);
    } else {
      d[i] = (y[i + 1] - y[i - 1]) / (x[i + 1] - x[i - 1]);
    }
  }
  return d;
}

function axleAt(frame: SweepFrame, axleId: string): XY {
  return frame.positions[axleId];
}

export function computeMetrics(sweep: SweepResult, design: Design): Metrics {
  // Only use the contiguous converged span starting at full extension; beyond
  // it the geometry is invalid and metrics would be garbage.
  const frames = sweep.frames.slice(0, Math.max(1, sweep.validTo + 1));
  const axle0 = axleAt(frames[0], design.axleId);

  const travel: number[] = [];
  const shockTravel: number[] = [];
  for (const f of frames) {
    const a = axleAt(f, design.axleId);
    travel.push(a.y - axle0.y); // +ve up = into compression
    shockTravel.push(f.shockTravel);
  }

  // Leverage ratio = d(wheel travel)/d(shock stroke), off the solved curve.
  const dTravel = derivative(shockTravel, travel);
  const leverage: LeveragePoint[] = frames.map((_, i) => ({
    travel: travel[i],
    shockTravel: shockTravel[i],
    lr: dTravel[i],
  }));

  const totalTravel = travel[travel.length - 1];
  const lrStart = leverage[0].lr;
  const lrEnd = leverage[leverage.length - 1].lr;
  const progressivity = lrStart !== 0 ? ((lrStart - lrEnd) / lrStart) * 100 : 0;

  const axlePath: AxlePoint[] = frames.map((f, i) => {
    const a = axleAt(f, design.axleId);
    return { rearward: a.x - axle0.x, vertical: a.y - axle0.y, travel: travel[i] };
  });

  const kickback = computeKickback(frames, design, travel);

  // Instant centre, computed kinematically from the actual motion of two points
  // rigidly attached to the wheel carrier (see carrierRefIds / velocityInstantCentre).
  // This is robust to topology — it does not guess which links are "ground links".
  const carrierRefs = carrierRefIds(design);
  const instantCentre: InstantCentrePoint[] = frames.map((_, i) => ({
    travel: travel[i],
    ic: carrierRefs ? velocityInstantCentre(frames, i, carrierRefs[0], carrierRefs[1]) : null,
  }));

  // The front wheel is fixed to the front triangle, so its contact patch x is
  // constant — taken from the home (fully-extended) rear-axle position, NOT the
  // moving per-frame axle.
  const frontContactX = axle0.x - design.metrics.wheelbase;

  // Anti-squat / anti-rise reuse the per-frame instant centre.
  const antiSquatCurve: PercentPoint[] = [];
  const antiRiseCurve: PercentPoint[] = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const chassis: ChassisInputs = {
      bb: f.positions[design.bbId],
      rearAxle: f.positions[design.axleId],
      ic: instantCentre[i].ic,
      frontContactX,
      cogHeight: design.metrics.cogHeight,
      chainringTeeth: design.metrics.chainringTeeth,
      cogTeeth: design.metrics.cogTeeth,
    };
    antiSquatCurve.push({ travel: travel[i], percent: antiSquat(chassis) });
    antiRiseCurve.push({ travel: travel[i], percent: antiRise(chassis) });
  }

  // Headline anti-squat is taken at ~30% travel (typical sag).
  const sagIndex = sagIndexFor(travel, totalTravel);
  const antiSquatAtSag = antiSquatCurve[sagIndex]?.percent ?? null;

  return {
    travel,
    leverage,
    totalTravel,
    progressivity,
    axlePath,
    kickback,
    instantCentre,
    antiSquat: antiSquatCurve,
    antiRise: antiRiseCurve,
    antiSquatAtSag,
    carrierRefs,
  };
}

/** Index of the frame nearest 30% of total travel (typical sag point). */
function sagIndexFor(travel: number[], total: number): number {
  const target = 0.3 * total;
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < travel.length; i++) {
    const err = Math.abs(travel[i] - target);
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

/**
 * Pedal kickback: as the suspension compresses, the straight-line distance from
 * the chainring (bottom bracket) to the rear cog (axle) changes — "chain
 * growth". A taut chain converts that length change into crank rotation. We
 * report the rotation relative to the fully-extended state, in degrees.
 *
 * Crank rotation = chain growth / chainring pitch radius. The chainring pitch
 * radius is set by its tooth count and the chain pitch.
 */
function computeKickback(
  frames: SweepFrame[],
  design: Design,
  travel: number[],
): KickbackPoint[] {
  const bb = frames[0].positions[design.bbId];
  const cogRadius = (design.metrics.cogTeeth * CHAIN_PITCH) / (2 * Math.PI);
  const ringRadius = (design.metrics.chainringTeeth * CHAIN_PITCH) / (2 * Math.PI);

  // Effective chain length engaged ≈ centre distance minus the wrap geometry.
  // For kickback we care about the *change* in the taut top run, which to first
  // order equals the change in centre-to-centre distance corrected for the
  // sprocket radii. Using the chord between the tangent points keeps it stable.
  function topRun(axle: XY): number {
    const cx = axle.x - bb.x;
    const cy = axle.y - bb.y;
    const c = Math.hypot(cx, cy);
    // Length of the external-tangent segment between two circles (top run).
    const dr = ringRadius - cogRadius;
    const seg = Math.sqrt(Math.max(0, c * c - dr * dr));
    return seg;
  }

  const run0 = topRun(frames[0].positions[design.axleId]);
  return frames.map((f, i) => {
    const growth = topRun(f.positions[design.axleId]) - run0;
    const degrees = (growth / ringRadius) * (180 / Math.PI);
    return { travel: travel[i], degrees };
  });
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Pick two reference points whose rigid motion defines the wheel carrier: the
 * rear axle, plus a *moving* neighbour that is rigidly fixed to it.
 *
 * A neighbour N (directly linked to the axle) is rigidly co-moving with the
 * axle when the axle and N share a third common neighbour M, so that the
 * triangle axle–N–M is rigid (no relative rotation). Picking the axle plus such
 * an N lets us read the carrier's instant centre straight off the solved motion,
 * with no need to guess which links are "ground links" — that guess is exactly
 * what made the old construction fragile when a rocker arm added extra links.
 *
 * Returns null when the axle is not rigidly located (e.g. hangs off a single
 * link), in which case the instant centre is left undefined.
 */
export function carrierRefIds(design: Design): [string, string] | null {
  const axle = design.axleId;
  const fixedIds = new Set(design.points.filter((p) => p.fixed).map((p) => p.id));
  const linkSet = new Set(design.links.map((l) => linkKey(l.a, l.b)));

  const neighbours: string[] = [];
  for (const l of design.links) {
    if (l.a === axle) neighbours.push(l.b);
    else if (l.b === axle) neighbours.push(l.a);
  }

  for (const n of neighbours) {
    if (fixedIds.has(n)) continue; // need a moving point for a velocity
    for (const m of neighbours) {
      if (m === n) continue;
      if (linkSet.has(linkKey(n, m))) return [axle, n]; // triangle axle–n–m is rigid
    }
  }
  return null;
}

/**
 * Instant centre of the wheel carrier relative to the front triangle, read from
 * the actual motion: each carrier point's velocity is perpendicular to the line
 * joining it to the instant centre, so the IC is where the two perpendiculars
 * meet. Velocities come from finite differences between adjacent solved frames.
 *
 * This is the kinematic definition of the instant centre and is identical to the
 * classic four-bar "extend the two links until they cross" construction, but it
 * is robust to any topology (single pivot, four-bar, rocker-driven, etc.).
 * Returns null when the body is momentarily not rotating or the perpendiculars
 * are parallel (instant centre at infinity, e.g. a parallelogram linkage).
 */
export function velocityInstantCentre(
  frames: SweepFrame[],
  i: number,
  refA: string,
  refB: string,
): XY | null {
  // Centered difference where possible (second-order accurate, so the secant
  // direction matches the tangent to O(step²)); one-sided at the ends.
  const lo = i > 0 ? i - 1 : i;
  const hi = i < frames.length - 1 ? i + 1 : i;
  if (lo === hi) return null;
  const a0 = frames[i].positions[refA];
  const b0 = frames[i].positions[refB];
  const va = { x: frames[hi].positions[refA].x - frames[lo].positions[refA].x, y: frames[hi].positions[refA].y - frames[lo].positions[refA].y };
  const vb = { x: frames[hi].positions[refB].x - frames[lo].positions[refB].x, y: frames[hi].positions[refB].y - frames[lo].positions[refB].y };
  if (Math.hypot(va.x, va.y) < 1e-9 || Math.hypot(vb.x, vb.y) < 1e-9) return null;
  // The IC lies along the line through each point perpendicular to its velocity.
  const perpA = { x: a0.x - va.y, y: a0.y + va.x };
  const perpB = { x: b0.x - vb.y, y: b0.y + vb.x };
  return lineIntersection(a0, perpA, b0, perpB);
}

/** Intersection of line p1→p2 and line p3→p4 (infinite lines). Null if parallel. */
export function lineIntersection(p1: XY, p2: XY, p3: XY, p4: XY): XY | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;
  const a = p1.x * p2.y - p1.y * p2.x;
  const b = p3.x * p4.y - p3.y * p4.x;
  return {
    x: (a * (p3.x - p4.x) - (p1.x - p2.x) * b) / d,
    y: (a * (p3.y - p4.y) - (p1.y - p2.y) * b) / d,
  };
}

export const EXPLAINERS = {
  leverage:
    'How far the wheel moves for each millimetre the shock moves. Higher = the shock feels softer; lower = firmer.',
  progressivity:
    'How much firmer the suspension gets deeper into its travel. More progressive resists bottoming out on big hits.',
  axlePath:
    'The route the rear axle takes as it moves up. A rearward path soaks up square-edged bumps more smoothly.',
  antiSquat:
    'How much the chain and linkage resist the bike squatting down when you pedal. Around 100% stays level under power.',
  antiRise:
    'How much the linkage resists the rear lifting (or settling) when you grab the brakes.',
  kickback:
    'How much the pedals get tugged backwards as the suspension compresses, because the chain has to stretch around the moving axle.',
  instantCentre:
    'The invisible point the whole rear end momentarily pivots about. Watching it move explains why four-bars behave differently from single pivots.',
} as const;
