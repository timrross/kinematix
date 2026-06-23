/**
 * Header: title, preset picker, and the save / load / share actions. Sharing
 * serialises the whole design into the URL hash so a rider can send a link with
 * no backend involved.
 */

import { useRef, useState } from 'react';
import type { Design } from '../kinematics/model';
import { PRESETS } from '../kinematics/presets';
import { designToHash, designToJson, jsonToDesign } from '../persistence/serialize';

interface Props {
  design: Design;
  onLoad: (d: Design) => void;
  travelMm: number | null;
  status: 'ok' | 'warn' | 'bad';
  statusLabel: string;
}

export default function TopBar({ design, onLoad, travelMm, status, statusLabel }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  function loadPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (p) onLoad(p.build());
  }

  async function share() {
    const hash = designToHash(design);
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    try {
      await navigator.clipboard.writeText(location.href);
      flash('Share link copied');
    } catch {
      flash('Link is in the address bar');
    }
  }

  function download() {
    const blob = new Blob([designToJson(design)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${design.name.replace(/\s+/g, '-').toLowerCase() || 'design'}.kinematix.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onLoad(jsonToDesign(String(reader.result)));
        flash('Design loaded');
      } catch (err) {
        flash(`Could not load file: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <header className="topbar">
      <div className="brand">
        <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden role="img">
          {/* a four-bar: two ground pivots, two links, a coupler */}
          <line x1="6" y1="24" x2="20" y2="9" stroke="var(--oil)" strokeWidth="2" strokeLinecap="round" />
          <line x1="26" y1="22" x2="20" y2="9" stroke="var(--link)" strokeWidth="2" strokeLinecap="round" />
          <line x1="6" y1="24" x2="26" y2="22" stroke="var(--frame)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 3" />
          <circle cx="6" cy="24" r="2.6" fill="var(--pivot-fixed)" />
          <circle cx="26" cy="22" r="2.6" fill="var(--pivot-fixed)" />
          <circle cx="20" cy="9" r="2.8" fill="var(--pivot-free)" />
        </svg>
        <div>
          <h1>Kinematix</h1>
          <p className="tagline">Drag a pivot. Watch the suspension think.</p>
        </div>
      </div>

      <div className="status-cluster">
        <div className="readout">
          <span className="readout-label">Travel</span>
          <span className="readout-val">{travelMm === null ? '—' : `${travelMm.toFixed(1)} mm`}</span>
        </div>
        <span className="status-led" title="Solver status">
          <span className={`led ${status}`} aria-hidden />
          {statusLabel}
        </span>
      </div>

      <div className="actions">
        <label className="field inline preset-field">
          <span className="sr-only">Preset</span>
          <select
            aria-label="Load a preset linkage"
            value=""
            onChange={(e) => { if (e.target.value) loadPreset(e.target.value); e.currentTarget.value = ''; }}
          >
            <option value="">Presets…</option>
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        <button onClick={share} className="btn btn-primary">Share link</button>
        <button onClick={download} className="btn">Save</button>
        <button onClick={() => fileRef.current?.click()} className="btn">Load</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </header>
  );
}
