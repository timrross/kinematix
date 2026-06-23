import { describe, it, expect } from 'vitest';
import { fromBiKinematics, isBiKinematics, parseAnyDesign } from './bikinematics';
import { designToJson } from './serialize';
import { buildSystem } from '../kinematics/solver';
import { solveSweep } from '../kinematics/sweep';
import { computeMetrics } from '../kinematics/metrics';
import { getPoint } from '../kinematics/model';
import { horstLink } from '../kinematics/presets';

// The real Vitus Sommet trace, in BiKinematics' on-disk shape (pixels + p2mm).
const sommet = {
  points: {
    Upper_Pivot: { name: 'Upper_Pivot', type: 'ground', pos: [636.0, 510.0] },
    Seatstay: { name: 'Seatstay', type: 'linkage', pos: [557.0, 518.57] },
    Rear_Wheel: { name: 'Rear_Wheel', type: 'rear_wheel', pos: [283.0, 339.4] },
    Horst_Pivot: { name: 'Horst_Pivot', type: 'linkage', pos: [330.0, 333.12] },
    Main_Pivot: { name: 'Main_Pivot', type: 'ground', pos: [610.0, 357.97] },
    Shock_Frame: { name: 'Shock_Frame', type: 'ground', pos: [655.0, 391.0] },
    Front_Wheel: { name: 'Front_Wheel', type: 'front_wheel', pos: [1221.0, 344.0] },
    Bottom_Bracket: { name: 'Bottom_Bracket', type: 'bottom_bracket', pos: [616.0, 323.0] },
    Shock_Rocker: { name: 'Shock_Rocker', type: 'linkage', pos: [671.0, 544.0] },
  },
  links: {
    Upper_Pivot_Seatstay: { a: 'Upper_Pivot', b: 'Seatstay' },
    Seatstay_Rear_Wheel: { a: 'Seatstay', b: 'Rear_Wheel' },
    Horst_Pivot_Rear_Wheel: { a: 'Horst_Pivot', b: 'Rear_Wheel' },
    Seatstay_Horst_Pivot: { a: 'Seatstay', b: 'Horst_Pivot' },
    Horst_Pivot_Main_Pivot: { a: 'Horst_Pivot', b: 'Main_Pivot' },
    Shock_Rocker_Seatstay: { a: 'Shock_Rocker', b: 'Seatstay' },
    Upper_Pivot_Shock_Rocker: { a: 'Upper_Pivot', b: 'Shock_Rocker' },
    'Shock Eye-Eye': { a: 'Shock_Frame', b: 'Shock_Rocker' },
  },
  shock: 'Shock Eye-Eye',
  params: {
    wheelbase: '1255',
    chainring_teeth: '30',
    cassette_teeth: '52',
    wheel_size: '29',
    p2mm: 1.3379530916844349,
    cog_height: '1100',
  },
};

describe('BiKinematics import — detection', () => {
  it('recognises a BiKinematics file and rejects a native design', () => {
    expect(isBiKinematics(sommet)).toBe(true);
    expect(isBiKinematics(horstLink())).toBe(false);
    expect(isBiKinematics(null)).toBe(false);
  });
});

describe('BiKinematics import — conversion', () => {
  const design = fromBiKinematics(sommet);

  it('maps params into metric inputs', () => {
    expect(design.metrics.chainringTeeth).toBe(30);
    expect(design.metrics.cogTeeth).toBe(52);
    expect(design.metrics.wheelbase).toBe(1255);
    expect(design.metrics.rearTyreRadius).toBe(367);
    expect(design.bbId).toBeTruthy();
    expect(design.axleId).toBeTruthy();
  });

  it('converts to our coordinate convention (BB at origin, axle at tyre radius, rear +x)', () => {
    const bb = getPoint(design, design.bbId);
    const axle = getPoint(design, design.axleId);
    expect(bb.x).toBeCloseTo(0, 1);
    expect(axle.y).toBeCloseTo(367, 1); // grounded at 29" radius
    expect(axle.x).toBeGreaterThan(400); // rear wheel is rearward (+x)
    expect(axle.x).toBeLessThan(480);
  });

  it('drops the front-wheel marker and treats the shock link as the driver', () => {
    expect(design.points.find((p) => p.name === 'Front_Wheel')).toBeUndefined();
    // The shock endpoints are not among the rigid links.
    const isShockLink = (l: { a: string; b: string }) =>
      (l.a === design.shock.frame && l.b === design.shock.link) ||
      (l.b === design.shock.frame && l.a === design.shock.link);
    expect(design.links.some(isShockLink)).toBe(false);
  });

  it('produces a well-formed 1-DOF mechanism that converges across full travel', () => {
    expect(buildSystem(design).mobility).toBe(0);
    const res = solveSweep(design, 150);
    expect(res.structurallyValid).toBe(true);
    expect(res.fullyConverged).toBe(true);
  });

  it('yields realistic enduro numbers (a real-world cross-check)', () => {
    const m = computeMetrics(solveSweep(design, 150), design);
    expect(m.totalTravel).toBeGreaterThan(140);
    expect(m.totalTravel).toBeLessThan(200);
    expect(m.antiSquatAtSag!).toBeGreaterThan(60);
    expect(m.antiSquatAtSag!).toBeLessThan(120);
  });

  it('flags the design as a reverse-engineered estimate', () => {
    expect(design.note).toMatch(/estimate/i);
  });
});

describe('parseAnyDesign', () => {
  it('round-trips a native Kinematix design', () => {
    const d = horstLink();
    expect(parseAnyDesign(designToJson(d))).toEqual(d);
  });

  it('imports a BiKinematics file', () => {
    const d = parseAnyDesign(JSON.stringify(sommet));
    expect(d.version).toBe(1);
    expect(buildSystem(d).mobility).toBe(0);
  });

  it('throws a helpful error on non-JSON', () => {
    expect(() => parseAnyDesign('<<not json>>')).toThrow(/not valid JSON/);
  });
});
