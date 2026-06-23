/**
 * World (millimetre, y-up, ground at y=0) ↔ screen (SVG viewBox, y-down)
 * transforms for the linkage view. The fit is computed once per design from a
 * bounding box so the bike sits centred with padding, and stays stable while
 * the suspension animates.
 */

import type { XY } from '../kinematics/solver';

export interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
  viewW: number;
  viewH: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function unionBounds(points: XY[], pad = 0): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function fitTransform(b: Bounds, viewW: number, viewH: number, margin = 0.08): Transform {
  const worldW = Math.max(1, b.maxX - b.minX);
  const worldH = Math.max(1, b.maxY - b.minY);
  const availW = viewW * (1 - 2 * margin);
  const availH = viewH * (1 - 2 * margin);
  const scale = Math.min(availW / worldW, availH / worldH);

  // Centre the world bbox in the view.
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const offsetX = viewW / 2 - cx * scale;
  const offsetY = viewH / 2 + cy * scale; // y is flipped below

  return { scale, offsetX, offsetY, viewW, viewH };
}

export function worldToScreen(t: Transform, p: XY): XY {
  return { x: t.offsetX + p.x * t.scale, y: t.offsetY - p.y * t.scale };
}

export function screenToWorld(t: Transform, p: XY): XY {
  return { x: (p.x - t.offsetX) / t.scale, y: (t.offsetY - p.y) / t.scale };
}
