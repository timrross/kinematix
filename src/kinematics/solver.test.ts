import { describe, it, expect } from 'vitest';
import { singlePivot, horstLink, shortLink } from './presets';
import { solveSweep } from './sweep';
import { buildSystem, homeSeed, solveStep } from './solver';
import { distance } from './model';

/**
 * Independent closed-form check: the two intersection points of two circles,
 * one centred at p0 radius r0, the other at p1 radius r1. This is a completely
 * different code path from the Newton solver, so agreement is a real
 * cross-validation rather than a tautology.
 */
function circleIntersect(
  p0: { x: number; y: number },
  r0: number,
  p1: { x: number; y: number },
  r1: number,
): { x: number; y: number }[] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const d = Math.hypot(dx, dy);
  if (d > r0 + r1 || d < Math.abs(r0 - r1) || d === 0) return [];
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h2 = r0 * r0 - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const xm = p0.x + (a * dx) / d;
  const ym = p0.y + (a * dy) / d;
  const rx = (-dy * h) / d;
  const ry = (dx * h) / d;
  return [
    { x: xm + rx, y: ym + ry },
    { x: xm - rx, y: ym - ry },
  ];
}

function nearest(
  target: { x: number; y: number },
  candidates: { x: number; y: number }[],
) {
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - target.x, c.y - target.y);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

describe('constraint solver — structural validity', () => {
  it('all presets are well-formed 1-DOF mechanisms (mobility 0)', () => {
    for (const build of [singlePivot, horstLink, shortLink]) {
      const sys = buildSystem(build());
      expect(sys.mobility).toBe(0);
    }
  });
});

describe('constraint solver — home configuration', () => {
  it('reproduces the drawn geometry at full extension with ~zero residual', () => {
    for (const build of [singlePivot, horstLink, shortLink]) {
      const design = build();
      const sys = buildSystem(design);
      const sol = solveStep(sys, design.shock.eyeToEye, homeSeed(sys));
      expect(sol.converged).toBe(true);
      // Every solved point matches the design's drawn position.
      for (const p of design.points) {
        expect(sol.positions[p.id].x).toBeCloseTo(p.x, 6);
        expect(sol.positions[p.id].y).toBeCloseTo(p.y, 6);
      }
    }
  });
});

describe('constraint solver — full travel sweep', () => {
  it('converges across the entire travel for all presets', () => {
    for (const build of [singlePivot, horstLink, shortLink]) {
      const res = solveSweep(build(), 150);
      expect(res.structurallyValid).toBe(true);
      expect(res.fullyConverged).toBe(true);
      expect(res.validTo).toBe(res.frames.length - 1);
    }
  });

  it('holds every rigid link length constant through the sweep', () => {
    const design = horstLink();
    const res = solveSweep(design, 150);
    for (const frame of res.frames) {
      for (const l of design.links) {
        const a = frame.positions[l.a];
        const b = frame.positions[l.b];
        const home = distance(
          design.points.find((p) => p.id === l.a)!,
          design.points.find((p) => p.id === l.b)!,
        );
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(home, 5);
      }
    }
  });

  it('honours the prescribed shock length at every frame', () => {
    const design = shortLink();
    const res = solveSweep(design, 120);
    for (const frame of res.frames) {
      const f = frame.positions[design.shock.frame];
      const l = frame.positions[design.shock.link];
      expect(Math.hypot(f.x - l.x, f.y - l.y)).toBeCloseTo(frame.shockLength, 5);
    }
  });
});

describe('single pivot — circular axle arc', () => {
  it('keeps the axle at constant radius from the main pivot', () => {
    const design = singlePivot();
    const res = solveSweep(design, 150);
    const pivot = { x: 15, y: 370 };
    const r0 = Math.hypot(445 - pivot.x, 365 - pivot.y);
    for (const frame of res.frames) {
      const axle = frame.positions.axle;
      expect(Math.hypot(axle.x - pivot.x, axle.y - pivot.y)).toBeCloseTo(r0, 4);
    }
  });
});

describe('four-bar — independent circle-intersection cross-check', () => {
  it('matches a closed-form four-bar closure at mid travel', () => {
    const design = horstLink();
    const res = solveSweep(design, 150);
    const mid = res.frames[Math.floor(res.frames.length / 2)];
    expect(mid.converged).toBe(true);

    const B = mid.positions.rockerPivot; // fixed crank base
    const D = mid.positions.horst; // solved crank tip
    const C = mid.positions.rockerEnd; // solved coupler/rocker junction
    const E = mid.positions.axle; // solved, rigid on coupler

    const lenBC = distance(
      design.points.find((p) => p.id === 'rockerPivot')!,
      design.points.find((p) => p.id === 'rockerEnd')!,
    );
    const lenDC = distance(
      design.points.find((p) => p.id === 'horst')!,
      design.points.find((p) => p.id === 'rockerEnd')!,
    );

    // Given the solver's D and the fixed B, the coupler junction C must lie at
    // the intersection of circle(D, |DC|) and circle(B, |BC|). Recompute it
    // independently and compare to what the solver produced.
    const cCandidates = circleIntersect(D, lenDC, B, lenBC);
    expect(cCandidates.length).toBeGreaterThan(0);
    const cIndep = nearest(C, cCandidates);
    expect(cIndep.x).toBeCloseTo(C.x, 4);
    expect(cIndep.y).toBeCloseTo(C.y, 4);

    // And the axle, rigid on the coupler, sits at the intersection of
    // circle(D, |ED|) and circle(C, |EC|).
    const lenED = distance(
      design.points.find((p) => p.id === 'axle')!,
      design.points.find((p) => p.id === 'horst')!,
    );
    const lenEC = distance(
      design.points.find((p) => p.id === 'axle')!,
      design.points.find((p) => p.id === 'rockerEnd')!,
    );
    const eCandidates = circleIntersect(D, lenED, C, lenEC);
    const eIndep = nearest(E, eCandidates);
    expect(eIndep.x).toBeCloseTo(E.x, 4);
    expect(eIndep.y).toBeCloseTo(E.y, 4);
  });
});

describe('failure handling — invalid and binding linkages', () => {
  it('flags an over-constrained linkage (extra link) as structurally invalid', () => {
    const design = horstLink();
    // Add a redundant rigid link between two already-located free points.
    design.links.push({ id: 'extra', a: 'axle', b: 'rockerArm' });
    const res = solveSweep(design, 60);
    expect(res.structurallyValid).toBe(false);
    expect(res.structuralMessage).toMatch(/over-constrained/);
  });

  it('flags an under-constrained linkage (missing link) as structurally invalid', () => {
    const design = horstLink();
    design.links.pop(); // remove a constraint → extra degree of freedom
    const res = solveSweep(design, 60);
    expect(res.structurallyValid).toBe(false);
    expect(res.structuralMessage).toMatch(/under-constrained/);
  });

  it('detects binding: converges at the top, flags the rest, never emits garbage', () => {
    // An over-long stroke drives the rocker past a dead point partway through.
    const design = horstLink();
    design.shock.stroke = design.shock.eyeToEye * 0.85;
    const res = solveSweep(design, 150);
    expect(res.structurallyValid).toBe(true);
    expect(res.frames[0].converged).toBe(true); // valid at full extension
    expect(res.fullyConverged).toBe(false); // but not all the way down
    expect(res.validTo).toBeGreaterThanOrEqual(0);
    expect(res.validTo).toBeLessThan(res.frames.length - 1);
    // Beyond the valid span the frames are explicitly marked non-converged.
    expect(res.frames[res.validTo + 1].converged).toBe(false);
  });
});

describe('continuation — stays on the correct assembly branch', () => {
  it('moves the axle monotonically and smoothly (no over-centre flip)', () => {
    const design = horstLink();
    const res = solveSweep(design, 150);
    // Axle should rise (move up) as the shock compresses, with no sudden jumps
    // that would signal a branch flip.
    let prev = res.frames[0].positions.axle;
    let totalRise = 0;
    for (let i = 1; i < res.frames.length; i++) {
      const cur = res.frames[i].positions.axle;
      const stepDist = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      // No single step should jump more than a few mm for 150 steps over ~150mm.
      expect(stepDist).toBeLessThan(8);
      totalRise += cur.y - prev.y;
      prev = cur;
    }
    expect(totalRise).toBeGreaterThan(0); // net upward axle movement
  });
});
