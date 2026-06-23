/**
 * The pedalling/braking metric inputs: gears, wheel size, CoG height, wheelbase
 * and tyre radii. Sensible defaults, with a gentle reminder that anti-squat and
 * anti-rise rely on these estimates until you touch them.
 */

import type { Design, MetricInputs } from '../kinematics/model';

interface Props {
  design: Design;
  onChange: (patch: Partial<MetricInputs>) => void;
}

const WHEELS = [
  { id: '275', label: '27.5"', r: 350 },
  { id: '29', label: '29"', r: 367 },
  { id: 'mx', label: 'Mixed (MX)', rFront: 367, rRear: 350 },
] as const;

export default function InputsPanel({ design, onChange }: Props) {
  const m = design.metrics;

  function setWheel(id: string) {
    const w = WHEELS.find((x) => x.id === id)!;
    if ('r' in w) onChange({ frontTyreRadius: w.r, rearTyreRadius: w.r });
    else onChange({ frontTyreRadius: w.rFront, rearTyreRadius: w.rRear });
  }

  const wheelId =
    m.frontTyreRadius === m.rearTyreRadius
      ? m.frontTyreRadius >= 360 ? '29' : '275'
      : 'mx';

  return (
    <details className="inputs">
      <summary>
        Pedalling &amp; braking inputs
        {!m.touched && <span className="estimate-badge">estimates</span>}
      </summary>

      <div className="inputs-grid">
        <NumField label="Chainring teeth" value={m.chainringTeeth} min={26} max={40} onChange={(v) => onChange({ chainringTeeth: v })} />
        <NumField label="Cog teeth" value={m.cogTeeth} min={9} max={52} onChange={(v) => onChange({ cogTeeth: v })} />

        <label className="field">
          <span>Wheel size</span>
          <select value={wheelId} onChange={(e) => setWheel(e.target.value)}>
            {WHEELS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
          </select>
        </label>

        <NumField label="CoG height (mm)" value={m.cogHeight} min={800} max={1300} step={5} onChange={(v) => onChange({ cogHeight: v })} />
        <NumField label="Wheelbase (mm)" value={m.wheelbase} min={1050} max={1350} step={5} onChange={(v) => onChange({ wheelbase: v })} />
      </div>
      <p className="inputs-note">
        Anti-squat and anti-rise depend on where the rider's weight sits and how long the bike is.
        The defaults are reasonable trail-bike estimates — tweak them for your own numbers.
      </p>
    </details>
  );
}

function NumField({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}
