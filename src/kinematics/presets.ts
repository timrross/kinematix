/**
 * Starter linkages so a first-time user lands on a working, moving bike rather
 * than a blank canvas. These are generic educational illustrations of layout
 * types — NOT models of specific branded bikes — to keep things accurate and
 * trademark-clean.
 *
 * Coordinates are millimetres, ground at y = 0, bottom bracket near x = 0, rear
 * wheel toward +x. See model.ts for the full convention. The drawn geometry is
 * always the fully-extended (topped-out) state; `finalize()` snaps the shock's
 * eye-to-eye length to the drawn distance so the home configuration is exactly
 * consistent with the solver's starting point.
 *
 * The geometries were found with a numerical search (see git history / the
 * tuning harness) so that each one converges across its entire travel and lands
 * on realistic trail-bike numbers (~120–145 mm travel, leverage ~2.0–2.6).
 */

import { distance, getPoint, type Design, type Link, type MetricInputs, type Point } from './model';

function pt(id: string, name: string, x: number, y: number, fixed: boolean): Point {
  return { id, name, x, y, fixed };
}

function link(id: string, a: string, b: string): Link {
  return { id, a, b };
}

/** Sensible defaults for the pedalling/braking inputs (a 29er trail bike). */
function defaultMetrics(): MetricInputs {
  return {
    chainringTeeth: 32,
    cogTeeth: 32,
    cogHeight: 1050,
    wheelbase: 1240,
    rearTyreRadius: 367,
    frontTyreRadius: 367,
    touched: false,
  };
}

/**
 * The drawn geometry IS the fully-extended (topped-out) configuration, so the
 * shock's installed eye-to-eye length must equal the distance between its two
 * mount points as drawn. This snaps `eyeToEye` to that distance, guaranteeing
 * the first solve reproduces the drawing exactly. `stroke` is kept as given.
 */
function finalize(design: Design): Design {
  // Keep full precision so the home configuration is exactly consistent with the
  // solver's first step (the UI rounds for display).
  const eyeToEye = distance(getPoint(design, design.shock.frame), getPoint(design, design.shock.link));
  return { ...design, shock: { ...design.shock, eyeToEye } };
}

/**
 * Single pivot. The whole swingarm is one rigid body (pivot + axle + shock
 * mount, triangulated), rotating about a single main pivot fixed to the front
 * triangle. The axle therefore traces a circular arc — the simplest possible
 * rear suspension. ~140 mm travel.
 */
export function singlePivot(): Design {
  return finalize({
    version: 1,
    name: 'Single pivot',
    points: [
      pt('bb', 'Bottom bracket', 0, 340, true),
      pt('pivot', 'Main pivot', 15, 370, true),
      pt('shockFrame', 'Shock frame mount', -20, 660, true),
      pt('axle', 'Rear axle', 445, 365, false),
      pt('shockMount', 'Shock link mount', 120, 520, false),
    ],
    links: [
      link('l-pivot-axle', 'pivot', 'axle'),
      link('l-pivot-sm', 'pivot', 'shockMount'),
      link('l-axle-sm', 'axle', 'shockMount'),
    ],
    shock: { frame: 'shockFrame', link: 'shockMount', eyeToEye: 0, stroke: 55 },
    axleId: 'axle',
    bbId: 'bb',
    metrics: defaultMetrics(),
  });
}

/**
 * Horst-link style four-bar. The rear axle sits on the seatstay (the coupler),
 * carried between the Horst pivot (rear of the chainstay) and the seatstay top,
 * with a short rocker driving the shock through a rocker arm. A genuine
 * four-bar: the axle follows a coupler curve, not a simple arc. ~143 mm travel,
 * gently progressive (~20%).
 */
export function horstLink(): Design {
  return finalize({
    version: 1,
    name: 'Horst-link four-bar',
    points: [
      pt('bb', 'Bottom bracket', 0, 340, true),
      pt('mainPivot', 'Main pivot', 10, 400, true),
      pt('rockerPivot', 'Rocker pivot', 250, 545, true),
      pt('shockFrame', 'Shock frame mount', 135, 616, true),
      // Moving pivots.
      pt('horst', 'Horst pivot', 440, 346, false), // rear of chainstay
      pt('rockerEnd', 'Seatstay top', 237, 478, false),
      pt('rockerArm', 'Rocker arm', 223, 449, false), // shock mount on the rocker
      pt('axle', 'Rear axle', 465, 365, false), // on the seatstay coupler
    ],
    links: [
      // Chainstay crank: main pivot -> Horst pivot.
      link('l-main-horst', 'mainPivot', 'horst'),
      // Rocker crank: rocker pivot -> seatstay top.
      link('l-rocker', 'rockerPivot', 'rockerEnd'),
      // Seatstay (coupler): Horst pivot -> seatstay top.
      link('l-seatstay', 'horst', 'rockerEnd'),
      // Axle rigidly fixed to the seatstay body (triangulated).
      link('l-axle-horst', 'axle', 'horst'),
      link('l-axle-rocker', 'axle', 'rockerEnd'),
      // Rocker arm rigid with the rocker body.
      link('l-rockerarm-pivot', 'rockerPivot', 'rockerArm'),
      link('l-rockerarm-end', 'rockerEnd', 'rockerArm'),
    ],
    shock: { frame: 'shockFrame', link: 'rockerArm', eyeToEye: 0, stroke: 59 },
    axleId: 'axle',
    bbId: 'bb',
    metrics: defaultMetrics(),
  });
}

/**
 * Short-link, counter-rotating "VPP-style" four-bar: two short links connect the
 * front triangle to a one-piece rear swingarm that carries the axle and the
 * shock mount. The links rotate in opposite directions, which gives these
 * layouts their characteristic curvy axle path. ~120 mm travel. (This generic
 * example runs a falling-rate — leverage rises into travel — which is a great
 * thing to fix by dragging the shock mount.) Generic illustration only.
 */
export function shortLink(): Design {
  return finalize({
    version: 1,
    name: 'Short-link four-bar (VPP-style)',
    points: [
      pt('bb', 'Bottom bracket', 0, 340, true),
      pt('lowerPivot', 'Lower link frame pivot', 7, 316, true),
      pt('upperPivot', 'Upper link frame pivot', 42, 442, true),
      pt('shockFrame', 'Shock frame mount', 118, 622, true),
      // Rear swingarm body: lower-link end, upper-link end, axle, shock mount.
      pt('lowerEnd', 'Lower link end', 89, 285, false),
      pt('upperEnd', 'Upper link end', 135, 453, false),
      pt('axle', 'Rear axle', 457, 362, false),
      pt('shockMount', 'Shock link mount', 132, 433, false),
    ],
    links: [
      // Two short links from the front triangle.
      link('l-lower', 'lowerPivot', 'lowerEnd'),
      link('l-upper', 'upperPivot', 'upperEnd'),
      // Rear swingarm: a rigid body wiring lowerEnd, upperEnd, axle, shockMount.
      link('l-body-1', 'lowerEnd', 'upperEnd'),
      link('l-body-2', 'upperEnd', 'axle'),
      link('l-body-3', 'axle', 'lowerEnd'),
      link('l-body-4', 'upperEnd', 'shockMount'),
      link('l-body-5', 'lowerEnd', 'shockMount'),
    ],
    shock: { frame: 'shockFrame', link: 'shockMount', eyeToEye: 0, stroke: 58 },
    axleId: 'axle',
    bbId: 'bb',
    metrics: defaultMetrics(),
  });
}

export interface PresetEntry {
  id: string;
  label: string;
  build: () => Design;
}

export const PRESETS: PresetEntry[] = [
  { id: 'single-pivot', label: 'Single pivot', build: singlePivot },
  { id: 'horst-link', label: 'Horst-link four-bar', build: horstLink },
  { id: 'short-link', label: 'Short-link (VPP-style)', build: shortLink },
];

export function defaultDesign(): Design {
  return horstLink();
}
