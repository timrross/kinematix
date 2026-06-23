/**
 * Per-metric presentation config: label, colour, plain-English explainer, and
 * how to turn the computed Metrics into plot points. Keeps MetricsPanel simple
 * and the metric list in one place.
 */

import type { Metrics } from '../kinematics/metrics';
import { EXPLAINERS } from '../kinematics/metrics';
import type { PlotPoint } from './Plot';
import type { MetricKey } from '../state/store';

export interface MetricMeta {
  key: MetricKey;
  label: string;
  color: string;
  explainer: string;
  xLabel: string;
  yLabel: string;
  referenceY?: number;
  referenceLabel?: string;
  equalAspect?: boolean;
  format: (y: number) => string;
  build: (m: Metrics) => PlotPoint[];
}

export const METRICS: MetricMeta[] = [
  {
    key: 'leverage',
    label: 'Leverage ratio',
    color: 'var(--c-leverage)',
    explainer: EXPLAINERS.leverage,
    xLabel: 'wheel travel (mm)',
    yLabel: 'leverage',
    format: (y) => y.toFixed(2),
    build: (m) => m.leverage.map((p) => ({ x: p.travel, y: p.lr })),
  },
  {
    key: 'axlePath',
    label: 'Axle path',
    color: 'var(--c-axle)',
    explainer: EXPLAINERS.axlePath,
    xLabel: 'rearward (mm) →',
    yLabel: 'up (mm)',
    equalAspect: true,
    format: (y) => `${y.toFixed(0)} mm`,
    build: (m) => m.axlePath.map((p) => ({ x: p.rearward, y: p.vertical })),
  },
  {
    key: 'antiSquat',
    label: 'Anti-squat',
    color: 'var(--c-as)',
    explainer: EXPLAINERS.antiSquat,
    xLabel: 'wheel travel (mm)',
    yLabel: 'anti-squat (%)',
    referenceY: 100,
    referenceLabel: '100%',
    format: (y) => `${y.toFixed(0)}%`,
    build: (m) => m.antiSquat.map((p) => ({ x: p.travel, y: p.percent })),
  },
  {
    key: 'antiRise',
    label: 'Anti-rise',
    color: 'var(--c-ar)',
    explainer: EXPLAINERS.antiRise,
    xLabel: 'wheel travel (mm)',
    yLabel: 'anti-rise (%)',
    referenceY: 100,
    referenceLabel: '100%',
    format: (y) => `${y.toFixed(0)}%`,
    build: (m) => m.antiRise.map((p) => ({ x: p.travel, y: p.percent })),
  },
  {
    key: 'kickback',
    label: 'Pedal kickback',
    color: 'var(--c-kick)',
    explainer: EXPLAINERS.kickback,
    xLabel: 'wheel travel (mm)',
    yLabel: 'kickback (°)',
    format: (y) => `${y.toFixed(1)}°`,
    build: (m) => m.kickback.map((p) => ({ x: p.travel, y: p.degrees })),
  },
];

export function metaFor(key: MetricKey): MetricMeta {
  return METRICS.find((m) => m.key === key)!;
}
