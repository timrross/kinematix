/**
 * The metrics panel: featured curve with selectable tabs, a one-line plain
 * English explainer, the live readout, and the summary stat strip. Plots update
 * in lockstep with the linkage view via `highlightIndex`.
 */

import type { Metrics } from '../kinematics/metrics';
import type { Design } from '../kinematics/model';
import Plot from './Plot';
import { METRICS, metaFor } from './metricMeta';
import type { MetricKey } from '../state/store';

interface Props {
  metrics: Metrics | null;
  design: Design;
  activeMetric: MetricKey;
  highlightIndex: number;
  onSelectMetric: (m: MetricKey) => void;
}

export default function MetricsPanel({ metrics, design, activeMetric, highlightIndex, onSelectMetric }: Props) {
  const meta = metaFor(activeMetric);

  if (!metrics) {
    return (
      <div className="metrics-panel">
        <p className="empty">The linkage can't be solved right now — adjust a pivot to get a valid mechanism.</p>
      </div>
    );
  }

  const data = meta.build(metrics);
  const hi = Math.min(highlightIndex, data.length - 1);
  const estimated = !design.metrics.touched && (activeMetric === 'antiSquat' || activeMetric === 'antiRise');

  return (
    <div className="metrics-panel">
      <div className="metric-tabs" role="tablist">
        {METRICS.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={m.key === activeMetric}
            className={`metric-tab ${m.key === activeMetric ? 'active' : ''}`}
            style={{ ['--tab-color' as string]: m.color }}
            onClick={() => onSelectMetric(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="featured">
        <div className="featured-head">
          <h2 style={{ color: meta.color }}>{meta.label}</h2>
          {estimated && <span className="estimate-badge" title="Uses default rider/bike estimates — adjust the inputs below.">estimate</span>}
        </div>
        <Plot
          data={data}
          xLabel={meta.xLabel}
          yLabel={meta.yLabel}
          highlightIndex={hi}
          referenceY={meta.referenceY}
          referenceLabel={meta.referenceLabel}
          equalAspect={meta.equalAspect}
          format={meta.format}
          color={meta.color}
          height={230}
        />
        <p className="explainer">{meta.explainer}</p>
      </div>

      <StatStrip metrics={metrics} />

      {design.note && <p className="provenance">ⓘ {design.note}</p>}
    </div>
  );
}

function StatStrip({ metrics }: { metrics: Metrics }) {
  const lr0 = metrics.leverage[0]?.lr ?? 0;
  const lrN = metrics.leverage[metrics.leverage.length - 1]?.lr ?? 0;
  const as = metrics.antiSquatAtSag;
  const kickMax = metrics.kickback[metrics.kickback.length - 1]?.degrees ?? 0;
  return (
    <div className="stat-strip">
      <Stat label="Travel" value={`${metrics.totalTravel.toFixed(0)} mm`} />
      <Stat label="Leverage" value={`${lr0.toFixed(2)} → ${lrN.toFixed(2)}`} />
      <Stat label="Progressive" value={`${metrics.progressivity.toFixed(0)}%`} hint="how much firmer it gets deep in travel" />
      <Stat label="Anti-squat @ sag" value={as === null ? '—' : `${as.toFixed(0)}%`} />
      <Stat label="Max kickback" value={`${Math.abs(kickMax).toFixed(1)}°`} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
