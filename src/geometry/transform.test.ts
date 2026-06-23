import { describe, it, expect } from 'vitest';
import { fitTransform, worldToScreen, screenToWorld, unionBounds } from './transform';

describe('transform — x flip (drive-side orientation)', () => {
  const bounds = unionBounds([{ x: -800, y: 0 }, { x: 450, y: 700 }]);

  it('maps world +x (rearward) to the LEFT when flipped (default)', () => {
    const t = fitTransform(bounds, 1000, 640); // flipX defaults true
    const rear = worldToScreen(t, { x: 450, y: 367 });
    const front = worldToScreen(t, { x: -800, y: 367 });
    expect(rear.x).toBeLessThan(front.x); // rear on the left
  });

  it('maps world +x to the RIGHT when not flipped', () => {
    const t = fitTransform(bounds, 1000, 640, 0.08, false);
    const rear = worldToScreen(t, { x: 450, y: 367 });
    const front = worldToScreen(t, { x: -800, y: 367 });
    expect(rear.x).toBeGreaterThan(front.x);
  });

  it('round-trips world ↔ screen in both flip modes', () => {
    for (const flip of [true, false]) {
      const t = fitTransform(bounds, 1000, 640, 0.08, flip);
      for (const p of [{ x: 123, y: 456 }, { x: -321, y: 12 }, { x: 0, y: 0 }]) {
        const back = screenToWorld(t, worldToScreen(t, p));
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });
});
