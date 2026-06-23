/**
 * A small, dependency-free SVG line plot. Used for every curve (leverage, axle
 * path, anti-squat, anti-rise, kickback) so the styling stays consistent with
 * the linkage view and the bundle stays tiny.
 */

import { useMemo } from 'react';

export interface PlotPoint {
  x: number;
  y: number | null;
}

interface Props {
  data: PlotPoint[];
  xLabel: string;
  yLabel: string;
  /** Index of the point to highlight (the live travel position). */
  highlightIndex?: number;
  /** Optional horizontal reference line (e.g. 100% anti-squat). */
  referenceY?: number;
  referenceLabel?: string;
  /** Format a y value for the readout. */
  format?: (y: number) => string;
  color?: string;
  /** Keep equal scale on both axes (for the spatial axle path). */
  equalAspect?: boolean;
  height?: number;
}

const W = 340;

function niceDomain(min: number, max: number): [number, number] {
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.08;
  return [min - pad, max + pad];
}

export default function Plot({
  data,
  xLabel,
  yLabel,
  highlightIndex,
  referenceY,
  referenceLabel,
  format = (y) => y.toFixed(2),
  color = 'var(--accent)',
  equalAspect = false,
  height = 210,
}: Props) {
  const H = height;
  const padL = 44;
  const padR = 14;
  const padT = 14;
  const padB = 34;

  const { path, xDom, yDom, hx, hy } = useMemo(() => {
    const valid = data.filter(
      (d): d is { x: number; y: number } => d.y !== null && Number.isFinite(d.y),
    );
    if (valid.length === 0) {
      return { path: '', xDom: [0, 1] as [number, number], yDom: [0, 1] as [number, number], hx: null as number | null, hy: null as number | null };
    }
    let xmin = Math.min(...valid.map((d) => d.x));
    let xmax = Math.max(...valid.map((d) => d.x));
    let ymin = Math.min(...valid.map((d) => d.y));
    let ymax = Math.max(...valid.map((d) => d.y));
    if (referenceY !== undefined) {
      ymin = Math.min(ymin, referenceY);
      ymax = Math.max(ymax, referenceY);
    }
    let xd = niceDomain(xmin, xmax);
    let yd = niceDomain(ymin, ymax);

    // Travel-style axes (all x ≥ 0) read more naturally anchored at zero rather
    // than padded into negative numbers.
    if (!equalAspect && xmin >= 0) xd[0] = 0;

    if (equalAspect) {
      // Match mm-per-pixel on both axes so the path isn't distorted.
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;
      const xr = xd[1] - xd[0];
      const yr = yd[1] - yd[0];
      const sx = plotW / xr;
      const sy = plotH / yr;
      const s = Math.min(sx, sy);
      const cx = (xd[0] + xd[1]) / 2;
      const cy = (yd[0] + yd[1]) / 2;
      xd = [cx - plotW / s / 2, cx + plotW / s / 2];
      yd = [cy - plotH / s / 2, cy + plotH / s / 2];
    }

    const sx = (x: number) => padL + ((x - xd[0]) / (xd[1] - xd[0])) * (W - padL - padR);
    const sy = (y: number) => padT + (1 - (y - yd[0]) / (yd[1] - yd[0])) * (H - padT - padB);

    const path = valid.map((d, i) => `${i === 0 ? 'M' : 'L'}${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)}`).join(' ');

    let hx: number | null = null;
    let hy: number | null = null;
    if (highlightIndex !== undefined && data[highlightIndex] && Number.isFinite(data[highlightIndex].y)) {
      hx = sx(data[highlightIndex].x);
      hy = sy(data[highlightIndex].y as number);
    }

    return { path, xDom: xd, yDom: yd, hx, hy };
  }, [data, referenceY, equalAspect, highlightIndex, H]);

  const sx = (x: number) => padL + ((x - xDom[0]) / (xDom[1] - xDom[0])) * (W - padL - padR);
  const sy = (y: number) => padT + (1 - (y - yDom[0]) / (yDom[1] - yDom[0])) * (H - padT - padB);

  const xticks = [xDom[0], (xDom[0] + xDom[1]) / 2, xDom[1]];
  const yticks = [yDom[0], (yDom[0] + yDom[1]) / 2, yDom[1]];

  const highlightVal =
    highlightIndex !== undefined && data[highlightIndex] && Number.isFinite(data[highlightIndex].y)
      ? format(data[highlightIndex].y as number)
      : null;

  return (
    <svg className="plot" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} versus ${xLabel}`}>
      {/* graph-paper grid at the tick lines */}
      {xticks.map((t, i) => (
        <line key={`gx${i}`} x1={sx(t)} y1={padT} x2={sx(t)} y2={H - padB} className="plot-grid" />
      ))}
      {yticks.map((t, i) => (
        <line key={`gy${i}`} x1={padL} y1={sy(t)} x2={W - padR} y2={sy(t)} className="plot-grid" />
      ))}

      {/* axes */}
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} className="axis" />
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} className="axis" />

      {/* zero/baseline if in range */}
      {yDom[0] < 0 && yDom[1] > 0 && (
        <line x1={padL} y1={sy(0)} x2={W - padR} y2={sy(0)} className="axis-zero" />
      )}

      {/* reference line */}
      {referenceY !== undefined && (
        <>
          <line x1={padL} y1={sy(referenceY)} x2={W - padR} y2={sy(referenceY)} className="axis-ref" />
          {referenceLabel && (
            <text x={W - padR} y={sy(referenceY) - 4} textAnchor="end" className="tick ref-label">{referenceLabel}</text>
          )}
        </>
      )}

      {/* ticks */}
      {xticks.map((t, i) => (
        <text key={`x${i}`} x={sx(t)} y={H - padB + 16} textAnchor="middle" className="tick">{Math.round(t)}</text>
      ))}
      {yticks.map((t, i) => (
        <text key={`y${i}`} x={padL - 6} y={sy(t) + 4} textAnchor="end" className="tick">{formatTick(t)}</text>
      ))}

      {/* the curve */}
      {path && <path d={path} className="plot-line" style={{ stroke: color }} />}

      {/* highlight */}
      {hx !== null && hy !== null && (
        <>
          <line x1={hx} y1={padT} x2={hx} y2={H - padB} className="plot-cursor" style={{ stroke: color }} />
          <circle cx={hx} cy={hy} r={4.5} className="plot-dot" style={{ fill: color }} />
        </>
      )}

      {/* labels */}
      <text x={(padL + W - padR) / 2} y={H - 4} textAnchor="middle" className="axis-label">{xLabel}</text>
      <text x={12} y={padT + 2} className="axis-label axis-label-y" transform={`rotate(-90 12 ${(padT + H - padB) / 2})`}>{yLabel}</text>

      {highlightVal !== null && (
        <text x={W - padR} y={padT + 10} textAnchor="end" className="plot-readout" style={{ fill: color }}>{highlightVal}</text>
      )}
    </svg>
  );
}

function formatTick(t: number): string {
  if (Math.abs(t) >= 100) return Math.round(t).toString();
  return (Math.round(t * 10) / 10).toString();
}
