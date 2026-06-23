import { describe, it, expect } from 'vitest';
import { singlePivot, horstLink, shortLink } from './presets';
import { solveSweep } from './sweep';
import { computeMetrics, lineIntersection, carrierRefIds, derivative } from './metrics';
import { distance } from './model';

describe('metrics — wheel travel & leverage', () => {
  it('produces sensible trail-bike travel and leverage for the presets', () => {
    for (const build of [singlePivot, horstLink]) {
      const design = build();
      const m = computeMetrics(solveSweep(design, 150), design);
      // Travel between 100 and 170 mm.
      expect(m.totalTravel).toBeGreaterThan(100);
      expect(m.totalTravel).toBeLessThan(170);
      // Leverage ratio in a believable band the whole way.
      for (const p of m.leverage) {
        expect(p.lr).toBeGreaterThan(1.2);
        expect(p.lr).toBeLessThan(4);
      }
    }
  });

  it('travel increases monotonically from zero at full extension', () => {
    const design = horstLink();
    const m = computeMetrics(solveSweep(design, 150), design);
    expect(m.travel[0]).toBeCloseTo(0, 6);
    for (let i = 1; i < m.travel.length; i++) {
      expect(m.travel[i]).toBeGreaterThan(m.travel[i - 1] - 1e-6);
    }
  });

  it('leverage ratio equals the slope of travel vs shock stroke', () => {
    // Independent finite-difference check of LR against the metric output.
    const design = horstLink();
    const sweep = solveSweep(design, 150);
    const m = computeMetrics(sweep, design);
    const i = 75; // mid travel
    const dTravel = m.travel[i + 1] - m.travel[i - 1];
    const dStroke = m.leverage[i + 1].shockTravel - m.leverage[i - 1].shockTravel;
    expect(m.leverage[i].lr).toBeCloseTo(dTravel / dStroke, 6);
  });
});

describe('metrics — progressivity', () => {
  it('is defined as (LR_initial - LR_final)/LR_initial in percent', () => {
    const design = horstLink();
    const m = computeMetrics(solveSweep(design, 150), design);
    const lr0 = m.leverage[0].lr;
    const lrN = m.leverage[m.leverage.length - 1].lr;
    expect(m.progressivity).toBeCloseTo(((lr0 - lrN) / lr0) * 100, 6);
  });
});

describe('metrics — axle path', () => {
  it('starts at the origin and rises into travel', () => {
    const design = horstLink();
    const m = computeMetrics(solveSweep(design, 150), design);
    expect(m.axlePath[0].rearward).toBeCloseTo(0, 6);
    expect(m.axlePath[0].vertical).toBeCloseTo(0, 6);
    expect(m.axlePath[m.axlePath.length - 1].vertical).toBeGreaterThan(50);
  });
});

describe('metrics — pedal kickback', () => {
  it('starts at zero and grows monotonically (chain growth) for a single pivot', () => {
    // A single pivot above the BB grows the chain as it compresses, so kickback
    // is a clean monotonic curve.
    const design = singlePivot();
    const m = computeMetrics(solveSweep(design, 150), design);
    expect(m.kickback[0].degrees).toBeCloseTo(0, 6);
    const last = m.kickback[m.kickback.length - 1].degrees;
    expect(Math.abs(last)).toBeGreaterThan(0);
    // Magnitude stays in a believable range (a few to tens of degrees).
    expect(Math.abs(last)).toBeLessThan(60);
  });

  it('matches an independent chain-growth calculation (equal sprockets)', () => {
    // With equal chainring/cog the taut top run reduces exactly to the BB→axle
    // centre distance, so we can re-derive kickback without the tangent formula.
    const design = singlePivot();
    design.metrics.chainringTeeth = 30;
    design.metrics.cogTeeth = 30;
    const sweep = solveSweep(design, 150);
    const m = computeMetrics(sweep, design);

    const bb = sweep.frames[0].positions[design.bbId];
    const ringRadius = (30 * 12.7) / (2 * Math.PI);
    const home = sweep.frames[0].positions[design.axleId];
    for (const idx of [40, 90, 140]) {
      const axle = sweep.frames[idx].positions[design.axleId];
      const growth = distance(bb as any, axle as any) - distance(bb as any, home as any);
      const expectedDeg = (growth / ringRadius) * (180 / Math.PI);
      expect(m.kickback[idx].degrees).toBeCloseTo(expectedDeg, 6);
    }
  });
});

describe('metrics — derivative helper', () => {
  it('reproduces an analytic slope on an irregular grid', () => {
    // y = 2x + 1 on a non-uniform grid: derivative must be 2 everywhere.
    const x = [0, 0.4, 1.1, 2.0, 3.5, 5.0];
    const y = x.map((v) => 2 * v + 1);
    for (const d of derivative(x, y)) expect(d).toBeCloseTo(2, 9);
  });

  it('approximates a quadratic slope (central difference)', () => {
    // y = x²; central difference at interior nodes equals 2x exactly on a grid.
    const x = Array.from({ length: 11 }, (_, i) => i * 0.5);
    const y = x.map((v) => v * v);
    const d = derivative(x, y);
    for (let i = 1; i < x.length - 1; i++) expect(d[i]).toBeCloseTo(2 * x[i], 9);
  });
});

describe('metrics — instant centre', () => {
  it('for a single pivot sits on the main pivot through travel', () => {
    const design = singlePivot();
    const m = computeMetrics(solveSweep(design, 150), design);
    // Sampled away from the endpoints (centered difference is most accurate).
    for (const idx of [20, 75, 130]) {
      const ic = m.instantCentre[idx].ic!;
      expect(ic.x).toBeCloseTo(15, 0); // within ~0.5 mm of the pivot (15, 370)
      expect(ic.y).toBeCloseTo(370, 0);
    }
  });

  it('line intersection helper is correct', () => {
    const p = lineIntersection({ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 });
    expect(p!.x).toBeCloseTo(1, 9);
    expect(p!.y).toBeCloseTo(1, 9);
  });

  it('for a four-bar lies off the bike and moves through travel', () => {
    const design = horstLink();
    const m = computeMetrics(solveSweep(design, 150), design);
    const ic0 = m.instantCentre[0].ic!;
    const icN = m.instantCentre[m.instantCentre.length - 1].ic!;
    expect(ic0).not.toBeNull();
    // The instant centre should actually move (that's the whole point of a 4-bar).
    expect(Math.hypot(ic0.x - icN.x, ic0.y - icN.y)).toBeGreaterThan(1);
  });

  it('carrierRefIds returns the axle plus a co-moving carrier point for every preset', () => {
    for (const build of [singlePivot, horstLink, shortLink]) {
      const d = build();
      const refs = carrierRefIds(d);
      expect(refs).not.toBeNull();
      expect(refs![0]).toBe(d.axleId);
      expect(refs![1]).not.toBe(d.axleId);
    }
  });

  it('matches the independent four-bar construction and ignores the rocker arm', () => {
    // The correct Horst-link instant centre is the intersection of the chainstay
    // line (mainPivot→horst) and the rocker line (rockerPivot→rockerEnd). The
    // rocker-arm link (rockerPivot→rockerArm) must NOT influence it — the old
    // "first two ground links" heuristic was only right here by accident.
    const design = horstLink();
    const sweep = solveSweep(design, 150);
    const m = computeMetrics(sweep, design);
    for (const idx of [30, 75, 120]) {
      const p = sweep.frames[idx].positions;
      const independent = lineIntersection(p.mainPivot, p.horst, p.rockerPivot, p.rockerEnd)!;
      const ic = m.instantCentre[idx].ic!;
      // Velocity construction (centered finite difference) matches the exact
      // geometric intersection to well under a millimetre.
      expect(Math.hypot(ic.x - independent.x, ic.y - independent.y)).toBeLessThan(0.5);
    }
  });

  it('instant centre and anti-squat are invariant to link ordering', () => {
    // Reordering links is the exact failure mode the old heuristic was fragile
    // to. The constraint set is unchanged, so every result must be identical.
    const a = horstLink();
    const b = horstLink();
    const order = [5, 2, 0, 6, 1, 3, 4];
    b.links = order.map((i) => a.links[i]);

    const ma = computeMetrics(solveSweep(a, 150), a);
    const mb = computeMetrics(solveSweep(b, 150), b);
    for (const idx of [10, 75, 140]) {
      expect(mb.instantCentre[idx].ic!.x).toBeCloseTo(ma.instantCentre[idx].ic!.x, 6);
      expect(mb.instantCentre[idx].ic!.y).toBeCloseTo(ma.instantCentre[idx].ic!.y, 6);
    }
    expect(mb.antiSquatAtSag!).toBeCloseTo(ma.antiSquatAtSag!, 6);
  });
});

describe('metrics — anti-squat front contact patch', () => {
  it('uses a fixed front-axle x (does not drift with the moving rear axle)', () => {
    // The Horst axle path moves rearward/forward through travel; if the front
    // contact x tracked the rear axle, anti-squat would change when we artificially
    // shift the whole rear-axle x. It must not. We verify the front reference is
    // taken from the home geometry by checking anti-squat is continuous and finite
    // across the whole sweep (a drifting front reference introduced a kink).
    const design = horstLink();
    const m = computeMetrics(solveSweep(design, 150), design);
    const vals = m.antiSquat.map((p) => p.percent).filter((v): v is number => v !== null);
    expect(vals.length).toBe(m.antiSquat.length);
    for (let i = 1; i < vals.length; i++) {
      // No discontinuity: neighbouring frames differ by a small amount.
      expect(Math.abs(vals[i] - vals[i - 1])).toBeLessThan(5);
    }
  });
});
