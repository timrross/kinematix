import { describe, it, expect } from 'vitest';
import {
  designToJson,
  jsonToDesign,
  designToHash,
  designFromHash,
  validateDesign,
} from './serialize';
import { horstLink } from '../kinematics/presets';
import { cloneDesign } from '../kinematics/model';

describe('persistence — round trips', () => {
  it('survives a JSON round trip exactly', () => {
    const d = horstLink();
    expect(jsonToDesign(designToJson(d))).toEqual(d);
  });

  it('survives a URL-hash round trip exactly', () => {
    const d = horstLink();
    const restored = designFromHash(designToHash(d));
    expect(restored).toEqual(d);
  });

  it('returns null for a hash that is missing or not ours', () => {
    expect(designFromHash('')).toBeNull();
    expect(designFromHash('#something-else')).toBeNull();
    expect(designFromHash('#d=not-valid-base64!!')).toBeNull();
  });
});

describe('persistence — validation rejects malformed designs', () => {
  it('accepts a valid preset', () => {
    expect(() => validateDesign(horstLink())).not.toThrow();
  });

  const bad: [string, (d: ReturnType<typeof horstLink>) => unknown][] = [
    ['not an object', () => 42],
    ['wrong version', (d) => ({ ...d, version: 2 })],
    ['too few points', (d) => ({ ...d, points: d.points.slice(0, 1) })],
    ['missing links array', (d) => ({ ...d, links: undefined })],
    ['missing shock', (d) => ({ ...d, shock: undefined })],
    ['link references a missing point', (d) => {
      const c = cloneDesign(d);
      c.links[0].a = 'ghost';
      return c;
    }],
    ['shock references a missing point', (d) => {
      const c = cloneDesign(d);
      c.shock.link = 'ghost';
      return c;
    }],
    ['axle references a missing point', (d) => ({ ...cloneDesign(d), axleId: 'ghost' })],
    ['bb references a missing point', (d) => ({ ...cloneDesign(d), bbId: 'ghost' })],
    ['duplicate point id', (d) => {
      const c = cloneDesign(d);
      c.points[1].id = c.points[0].id;
      return c;
    }],
    ['point with non-finite coordinate', (d) => {
      const c = cloneDesign(d);
      c.points[2].x = NaN;
      return c;
    }],
    ['non-positive shock stroke', (d) => {
      const c = cloneDesign(d);
      c.shock.stroke = 0;
      return c;
    }],
  ];

  for (const [name, mutate] of bad) {
    it(`rejects: ${name}`, () => {
      expect(() => validateDesign(mutate(horstLink()))).toThrow();
    });
  }

  it('a bad-reference design is caught before it can reach the solver', () => {
    // This is the exact crash path: structurally shaped right, but a link points
    // at a non-existent id. It must throw at validation, not in the solver.
    const c = cloneDesign(horstLink());
    c.links[2].b = 'ghost';
    expect(() => validateDesign(c)).toThrow(/missing point/);
  });
});
