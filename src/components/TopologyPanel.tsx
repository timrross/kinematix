/**
 * The Build-mode panel: live degrees-of-freedom status, role assignment for the
 * selected pivot, point/link lists, and the photo-tracing controls. Replaces the
 * metrics + pivot-editor panels while building.
 */

import { useRef } from 'react';
import type { Design } from '../kinematics/model';
import type { SweepResult } from '../kinematics/sweep';
import { computeMobility } from '../kinematics/topology';
import { useStore } from '../state/store';

interface Props {
  design: Design;
  sweep: SweepResult;
}

export default function TopologyPanel({ design, sweep }: Props) {
  const selectedId = useStore((s) => s.selectedId);
  const notice = useStore((s) => s.notice);
  const trace = useStore((s) => s.trace);
  const calibrating = useStore((s) => s.calibrating);
  const calibrationFirst = useStore((s) => s.calibrationFirst);
  const {
    selectPoint, removePivot, togglePointFixed, assignAxle, assignBb, assignShockEnd,
    loadTraceImage, setTraceOpacity, clearTrace, startCalibration, cancelCalibration,
  } = useStore.getState();

  const fileRef = useRef<HTMLInputElement>(null);

  const selected = design.points.find((p) => p.id === selectedId) ?? null;
  const status = dofStatus(design, sweep);

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => loadTraceImage(String(reader.result), img.naturalWidth, img.naturalHeight);
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  return (
    <div className="topology-panel">
      <div className={`dof-badge dof-${status.kind}`}>
        <span className="led" />
        <div>
          <div className="dof-title">{status.title}</div>
          <div className="dof-sub">{status.sub}</div>
        </div>
      </div>

      {notice && <p className="notice">{notice}</p>}

      <section className="topo-section">
        <h3>Selected pivot</h3>
        {!selected ? (
          <p className="muted-note">Tap a pivot to assign its role, fix it to the frame, or delete it.</p>
        ) : (
          <div className="role-controls">
            <div className="role-name">{selected.name} <span className="muted-note">({selected.fixed ? 'frame-fixed' : 'moving'})</span></div>
            <div className="role-grid">
              <button className="btn" onClick={() => togglePointFixed(selected.id)}>{selected.fixed ? 'Make moving' : 'Fix to frame'}</button>
              <button className="btn" onClick={() => assignAxle(selected.id)} disabled={design.axleId === selected.id}>Set as axle</button>
              <button className="btn" onClick={() => assignBb(selected.id)} disabled={design.bbId === selected.id}>Set as bottom bracket</button>
              <button className="btn" onClick={() => assignShockEnd('frame', selected.id)} disabled={design.shock.frame === selected.id}>Shock: frame end</button>
              <button className="btn" onClick={() => assignShockEnd('link', selected.id)} disabled={design.shock.link === selected.id}>Shock: link end</button>
              <button className="btn btn-danger" onClick={() => removePivot(selected.id)}>Delete pivot</button>
            </div>
          </div>
        )}
      </section>

      <section className="topo-section">
        <h3>Trace from photo</h3>
        <p className="muted-note">Photos have perspective error — the result is an estimate. Use a drive-side profile shot (rear wheel on the left).</p>
        {!trace ? (
          <button className="btn" onClick={() => fileRef.current?.click()}>Load bike photo…</button>
        ) : (
          <div className="trace-controls">
            {calibrating ? (
              <div className="calib-active calib-step">
                <strong>Position the photo ({calibrationFirst ? '2 / 2' : '1 / 2'})</strong>
                <span>{calibrationFirst
                  ? 'Now click the front tyre’s contact patch (where it meets the ground).'
                  : 'Click the centre of the front axle on the photo.'}</span>
                <button className="btn" onClick={cancelCalibration}>Cancel</button>
              </div>
            ) : (
              <button className="btn" onClick={startCalibration}>Re-position (front wheel)</button>
            )}
            <label className="field">
              <span>Photo opacity</span>
              <input type="range" min={0.1} max={1} step={0.05} value={trace.opacity} onChange={(e) => setTraceOpacity(parseFloat(e.target.value))} />
            </label>
            <button className="btn" onClick={clearTrace}>Remove photo</button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} />
      </section>

      <section className="topo-section">
        <h3>Pivots <span className="count">{design.points.length}</span></h3>
        <ul className="topo-list">
          {design.points.map((p) => (
            <li key={p.id} className={p.id === selectedId ? 'sel' : ''}>
              <button className="list-name" onClick={() => selectPoint(p.id)}>
                <span className={`dot ${p.fixed ? 'fixed' : 'free'}`} />{p.name}
              </button>
              <span className="list-role">{roleLabel(design, p.id)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="topo-section">
        <h3>Links <span className="count">{design.links.length}</span></h3>
        <ul className="topo-list">
          {design.links.map((l) => (
            <li key={l.id}>
              <span className="list-name">{nameOf(design, l.a)} ↔ {nameOf(design, l.b)}</span>
              <button className="list-del" onClick={() => useStore.getState().removeLinkById(l.id)} aria-label="Delete link">✕</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function nameOf(d: Design, id: string): string {
  return d.points.find((p) => p.id === id)?.name ?? id;
}

function roleLabel(d: Design, id: string): string {
  const roles: string[] = [];
  if (id === d.axleId) roles.push('axle');
  if (id === d.bbId) roles.push('BB');
  if (id === d.shock.frame) roles.push('shock·frame');
  if (id === d.shock.link) roles.push('shock·link');
  return roles.join(' · ');
}

function dofStatus(design: Design, sweep: SweepResult): { kind: 'ok' | 'warn' | 'bad'; title: string; sub: string } {
  const m = computeMobility(design);
  if (m > 0) return { kind: 'warn', title: `Under-constrained · +${m} DOF`, sub: 'Add a link to remove a degree of freedom.' };
  if (m < 0) return { kind: 'bad', title: `Over-constrained · ${m} DOF`, sub: 'Remove a link — the mechanism is locked.' };
  // mobility 0
  if (sweep.structurallyValid && sweep.validTo >= 1) {
    if (sweep.fullyConverged) return { kind: 'ok', title: 'Solvable · 1 DOF', sub: 'Valid mechanism — metrics are live.' };
    const pct = Math.round((sweep.validTo / Math.max(1, sweep.frames.length - 1)) * 100);
    return { kind: 'warn', title: 'Solves, then binds', sub: `Only ${pct}% of the stroke is valid — adjust the geometry.` };
  }
  return { kind: 'warn', title: '1 DOF but binds', sub: 'The geometry locks immediately — nudge the pivots apart.' };
}
