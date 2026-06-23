import { describe, it, expect } from 'vitest';
import {
  addPoint, removePoint, addLink, removeLink, setFixed, setAxle, setBb,
  setShockEnd, recomputeEyeToEye, computeMobility, isComplete, calibrateScale,
} from './topology';
import { singlePivot, horstLink, shortLink, vitusSommet, newDesign } from './presets';
import { buildSystem } from './solver';
import { solveSweep } from './sweep';
import { distance, getPoint } from './model';

describe('topology — mobility', () => {
  it('matches the solver\'s mobility for every preset', () => {
    for (const build of [singlePivot, horstLink, shortLink, vitusSommet, newDesign]) {
      const d = build();
      expect(computeMobility(d)).toBe(buildSystem(d).mobility);
      expect(computeMobility(d)).toBe(0); // all presets are valid mechanisms
    }
  });

  it('addPoint raises mobility by 2 and gives a unique id', () => {
    const d = horstLink();
    const before = computeMobility(d);
    const { design, id } = addPoint(d, 100, 200);
    expect(computeMobility(design)).toBe(before + 2);
    expect(design.points.some((p) => p.id === id)).toBe(true);
    // unique id even after deletions
    const { design: d2, id: id2 } = addPoint(design, 0, 0);
    expect(id2).not.toBe(id);
    expect(d2.points.length).toBe(d.points.length + 2);
  });

  it('addLink lowers mobility by 1; removeLink raises it by 1', () => {
    const d = horstLink();
    const { design } = addPoint(addPoint(d, 10, 10).design, 20, 20); // +4 mobility
    const m0 = computeMobility(design);
    const a = design.points[design.points.length - 1].id;
    const b = design.points[design.points.length - 2].id;
    const linked = addLink(design, a, b);
    expect(linked.ok).toBe(true);
    expect(computeMobility(linked.design)).toBe(m0 - 1);
    const removed = removeLink(linked.design, linked.design.links[linked.design.links.length - 1].id);
    expect(computeMobility(removed)).toBe(m0);
  });

  it('setFixed flips mobility by ∓2', () => {
    const d = horstLink();
    const freeId = d.points.find((p) => !p.fixed)!.id;
    const fixed = setFixed(d, freeId, true);
    expect(computeMobility(fixed)).toBe(computeMobility(d) - 2);
    const backFree = setFixed(fixed, freeId, false);
    expect(computeMobility(backFree)).toBe(computeMobility(d));
  });
});

describe('topology — links', () => {
  it('rejects self-links and duplicates (order-insensitive)', () => {
    const d = horstLink();
    const a = d.links[0].a;
    const b = d.links[0].b;
    expect(addLink(d, a, a).ok).toBe(false);
    expect(addLink(d, a, b).ok).toBe(false); // already linked a-b
    expect(addLink(d, b, a).ok).toBe(false); // and b-a
  });
});

describe('topology — removePoint', () => {
  it('cascades incident links and leaves no dangling references', () => {
    const d = horstLink();
    // 'horst' is not a role point; it carries links l-main-horst / -seatstay / -axle-horst.
    const res = removePoint(d, 'horst');
    expect(res.ok).toBe(true);
    expect(res.design.points.some((p) => p.id === 'horst')).toBe(false);
    expect(res.design.links.length).toBeLessThan(d.links.length); // links cascaded
    const ids = new Set(res.design.points.map((p) => p.id));
    for (const l of res.design.links) {
      expect(ids.has(l.a)).toBe(true);
      expect(ids.has(l.b)).toBe(true);
    }
  });

  it('refuses to delete a point that fills a role', () => {
    const d = horstLink();
    expect(removePoint(d, d.axleId).ok).toBe(false);
    expect(removePoint(d, d.bbId).ok).toBe(false);
    expect(removePoint(d, d.shock.frame).ok).toBe(false);
    expect(removePoint(d, d.shock.link).ok).toBe(false);
  });
});

describe('topology — roles & shock', () => {
  it('reassigns axle and bb roles', () => {
    const d = horstLink();
    expect(setAxle(d, 'rockerEnd').axleId).toBe('rockerEnd');
    expect(setBb(d, 'mainPivot').bbId).toBe('mainPivot');
  });

  it('setShockEnd rejects collapsing the shock to a point and recomputes eyeToEye', () => {
    const d = horstLink();
    const same = setShockEnd(d, 'frame', d.shock.link);
    expect(same.ok).toBe(false);
    const moved = setShockEnd(d, 'link', 'axle');
    expect(moved.ok).toBe(true);
    expect(moved.design.shock.eyeToEye).toBeCloseTo(
      distance(getPoint(moved.design, moved.design.shock.frame), getPoint(moved.design, 'axle')),
      9,
    );
  });

  it('recomputeEyeToEye equals the drawn shock distance and matches finalize on presets', () => {
    for (const build of [singlePivot, horstLink, shortLink, newDesign]) {
      const d = build();
      const r = recomputeEyeToEye(d);
      expect(r.shock.eyeToEye).toBeCloseTo(
        distance(getPoint(d, d.shock.frame), getPoint(d, d.shock.link)),
        9,
      );
      // Presets are already finalised, so recompute is a no-op.
      expect(r.shock.eyeToEye).toBeCloseTo(d.shock.eyeToEye, 9);
    }
  });
});

describe('topology — completeness gate', () => {
  it('accepts presets and rejects a design with a dangling shock end', () => {
    expect(isComplete(horstLink())).toBe(true);
    const broken = { ...horstLink(), shock: { ...horstLink().shock, link: 'ghost' } };
    expect(isComplete(broken)).toBe(false);
  });
});

describe('topology — calibration math', () => {
  it('returns mm per pixel from two reference points and a real distance', () => {
    // 800 px apart, real wheelbase 1255 mm → 1.56875 mm/px
    expect(calibrateScale({ x: 100, y: 50 }, { x: 900, y: 50 }, 1255)).toBeCloseTo(1255 / 800, 9);
    // diagonal reference
    expect(calibrateScale({ x: 0, y: 0 }, { x: 300, y: 400 }, 500)).toBeCloseTo(1, 9); // dist 500px
    // degenerate
    expect(calibrateScale({ x: 10, y: 10 }, { x: 10, y: 10 }, 500)).toBe(0);
  });
});

describe('topology — build a valid four-bar from a linkless base', () => {
  it('reconstructing the links produces a solvable 1-DOF mechanism', () => {
    // Strip all links from the Horst preset, then add them back via addLink —
    // proving the editing primitives assemble a real, solvable mechanism.
    const target = horstLink();
    let d = { ...target, links: [] as typeof target.links };
    expect(computeMobility(d)).toBeGreaterThan(0); // under-constrained without links

    for (const l of target.links) {
      const r = addLink(d, l.a, l.b);
      expect(r.ok).toBe(true);
      d = r.design;
    }

    expect(computeMobility(d)).toBe(0);
    const res = solveSweep(d, 60);
    expect(res.structurallyValid).toBe(true);
    expect(res.validTo).toBeGreaterThanOrEqual(1);
  });
});
