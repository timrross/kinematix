import { describe, it, expect } from 'vitest';
import { antiSquat, antiRise, chainLine, type ChassisInputs } from './antisquat';
import { horstLink, singlePivot, shortLink } from './presets';
import { solveSweep } from './sweep';
import { computeMetrics } from './metrics';

const CHAIN_PITCH = 12.7;
const pitchRadius = (teeth: number) => (teeth * CHAIN_PITCH) / (2 * Math.PI);

/**
 * A deliberately simple single-pivot test rig with level, equal-sized sprockets,
 * so the chain's upper run is an exactly horizontal line and the whole anti-squat
 * construction can be re-derived by hand. This lets us validate the code against
 * an *independent* arithmetic of the documented construction, anchored to the
 * canonical 100% definition.
 *
 *   bb   = (0, 300)        chainring centre
 *   axle = (400, 300)      rear axle (level with the bb)
 *   ic   = (100, 400)      single-pivot instant centre (the main pivot)
 *   equal gears (22/22)    => upper chain run is horizontal at y = 300 + r
 */
const R = pitchRadius(22);
const rig = (cogHeight: number, wheelbase: number): ChassisInputs => ({
  bb: { x: 0, y: 300 },
  rearAxle: { x: 400, y: 300 },
  ic: { x: 100, y: 400 },
  frontContactX: 400 - wheelbase,
  cogHeight,
  chainringTeeth: 22,
  cogTeeth: 22,
});

/** Independent re-derivation of anti-squat for the rig above. */
function expectedRigAntiSquat(cogHeight: number, wheelbase: number): number {
  const chainY = 300 + R; // horizontal upper chain run
  // Construction point P: where the axle→IC force line meets the chain line.
  // Force line param from axle (400,300) toward ic (100,400): (400-300s, 300+100s).
  const s = R / 100; // 300 + 100s = 300 + R
  const P = { x: 400 - 300 * s, y: chainY };
  const rcp = { x: 400, y: 0 };
  const frontAxleX = 400 - wheelbase;
  const t = (frontAxleX - rcp.x) / (P.x - rcp.x);
  const H = rcp.y + t * (P.y - rcp.y);
  return (H / cogHeight) * 100;
}

describe('anti-squat — chain line construction', () => {
  it('upper chain run of equal sprockets is the horizontal top tangent', () => {
    const line = chainLine({ x: 0, y: 300 }, { x: 400, y: 300 }, R, R)!;
    expect(line.p.y).toBeCloseTo(300 + R, 9);
    expect(line.q.y).toBeCloseTo(300 + R, 9);
  });

  it('chain line for unequal sprockets tilts and stays above both centres', () => {
    const ring = pitchRadius(34);
    const cog = pitchRadius(20);
    const line = chainLine({ x: 0, y: 300 }, { x: 400, y: 360 }, ring, cog)!;
    // Tangent points sit one radius above each centre, along the line normal.
    expect(line.p.y).toBeGreaterThan(300);
    expect(line.q.y).toBeGreaterThan(360);
  });
});

describe('anti-squat — validated against the documented construction', () => {
  it('matches an independent hand re-derivation to floating-point precision', () => {
    const as = antiSquat(rig(1000, 1200))!;
    expect(as).toBeCloseTo(expectedRigAntiSquat(1000, 1200), 6);
  });

  it('is exactly 100% when the anti-squat line passes through CoG height above the front axle', () => {
    // The canonical definition: choose the CoG height equal to the height the
    // anti-squat line reaches at the front-axle vertical => anti-squat = 100%.
    const wheelbase = 1200;
    const anchorHeight = (expectedRigAntiSquat(1000, wheelbase) / 100) * 1000;
    const as = antiSquat(rig(anchorHeight, wheelbase))!;
    expect(as).toBeCloseTo(100, 6);
  });

  it('scales inversely with CoG height (a documented property)', () => {
    const a1 = antiSquat(rig(1000, 1200))!;
    const a2 = antiSquat(rig(2000, 1200))!;
    expect(a2).toBeCloseTo(a1 / 2, 6);
  });
});

describe('anti-rise — braking construction', () => {
  it('matches an independent hand re-derivation (line from contact patch through IC)', () => {
    const c = rig(1000, 1200);
    const rcp = { x: 400, y: 0 };
    const frontAxleX = 400 - 1200;
    const t = (frontAxleX - rcp.x) / (c.ic!.x - rcp.x);
    const H = rcp.y + t * (c.ic!.y - rcp.y);
    const expected = (H / 1000) * 100;
    expect(antiRise(c)!).toBeCloseTo(expected, 6);
  });
});

describe('anti-squat — preset sanity (documented tolerance)', () => {
  // The construction itself is validated to floating-point precision by the
  // anchor tests above (exact 100% definition, inverse-CoG scaling, independent
  // re-derivation). Here we only sanity-check that the presets produce finite
  // values inside the broad band real bikes occupy (low-pivot layouts sit low,
  // ~15–60%; higher pivots approach and exceed 100%). Stated tolerance: a plaus
  // ible 0–200% at sag, not an exact branded figure (whose pivot coordinates are
  // not public). Riders raise anti-squat live by dragging the main pivot up.
  it('all presets produce finite, plausible anti-squat at sag', () => {
    for (const build of [singlePivot, horstLink, shortLink]) {
      const design = build();
      design.metrics.chainringTeeth = 32;
      design.metrics.cogTeeth = 24;
      const m = computeMetrics(solveSweep(design, 150), design);
      expect(m.antiSquatAtSag).not.toBeNull();
      expect(m.antiSquatAtSag!).toBeGreaterThan(0);
      expect(m.antiSquatAtSag!).toBeLessThan(200);
    }
  });

  it('anti-rise for the presets is a finite, plausible percentage', () => {
    const design = horstLink();
    const m = computeMetrics(solveSweep(design, 150), design);
    const ar = m.antiRise[Math.floor(m.antiRise.length * 0.3)].percent!;
    expect(Number.isFinite(ar)).toBe(true);
    expect(ar).toBeGreaterThan(-50);
    expect(ar).toBeLessThan(200);
  });
});
