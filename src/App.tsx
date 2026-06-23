/**
 * Top-level app: restores a design (from a share link, then localStorage, then a
 * preset), runs the travel animation loop, and lays out the linkage stage beside
 * the live metrics. Everything recomputes from the single source of truth — the
 * design — so the linkage and every plot stay in lockstep.
 */

import { useEffect, useRef } from 'react';
import { useStore } from './state/store';
import { useDerived, frameIndexFor } from './state/useDerived';
import { DEFAULT_STEPS } from './kinematics/sweep';
import { designFromHash, loadLast } from './persistence/serialize';
import LinkageView from './components/LinkageView';
import AnimationBar from './components/AnimationBar';
import MetricsPanel from './components/MetricsPanel';
import PivotEditor from './components/PivotEditor';
import InputsPanel from './components/InputsPanel';
import TopBar from './components/TopBar';

export default function App() {
  const design = useStore((s) => s.design);
  const selectedId = useStore((s) => s.selectedId);
  const snap = useStore((s) => s.snap);
  const gridSize = useStore((s) => s.gridSize);
  const playing = useStore((s) => s.playing);
  const animPos = useStore((s) => s.animPos);
  const activeMetric = useStore((s) => s.activeMetric);
  const showIC = useStore((s) => s.showInstantCentre);
  const dragging = useStore((s) => s.dragging);

  const {
    setDesign, updatePoint, setShockStroke, setMetricInputs, selectPoint,
    setSnap, setGridSize, setPlaying, setAnimPos, setActiveMetric, setShowInstantCentre,
    setDragging,
  } = useStore.getState();

  // Restore a design once, on mount: share link wins, then last session.
  useEffect(() => {
    if (location.hash.startsWith('#d=')) {
      const fromHash = designFromHash(location.hash);
      // Consume the hash either way: a valid one is persisted to localStorage
      // (so later edits aren't clobbered on reload); an invalid one is dropped so
      // it can't keep shadowing the saved session.
      history.replaceState(null, '', location.pathname + location.search);
      if (fromHash) {
        setDesign(fromHash, { persist: true });
        return;
      }
    }
    const last = loadLast();
    if (last) setDesign(last, { persist: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A coarser sweep keeps live dragging smooth on low-end phones; the full
  // resolution returns the instant the drag ends.
  const { sweep, metrics } = useDerived(design, dragging ? 70 : DEFAULT_STEPS);
  const frameIndex = frameIndexFor(sweep, animPos);

  // Travel animation: ping-pong through the valid travel while playing.
  const raf = useRef<number | null>(null);
  const dir = useRef(1);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      last.current = null;
      return;
    }
    const SECONDS_PER_SWEEP = 2.6;
    const tick = (ts: number) => {
      if (last.current === null) last.current = ts;
      const dt = (ts - last.current) / 1000;
      last.current = ts;
      let next = useStore.getState().animPos + (dir.current * dt) / SECONDS_PER_SWEEP;
      if (next >= 1) { next = 1; dir.current = -1; }
      else if (next <= 0) { next = 0; dir.current = 1; }
      setAnimPos(next);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, setAnimPos]);

  const travelMm = metrics ? metrics.travel[Math.min(frameIndex, metrics.travel.length - 1)] : null;
  const totalTravel = metrics ? metrics.totalTravel : null;

  const status: 'ok' | 'warn' | 'bad' = !sweep.structurallyValid
    ? 'bad'
    : sweep.fullyConverged
      ? 'ok'
      : 'warn';
  const statusLabel = status === 'bad' ? 'Unsolvable' : status === 'warn' ? 'Binds early' : 'Solved';

  return (
    <div className="app">
      <TopBar
        design={design}
        onLoad={(d) => { setDesign(d); setAnimPos(0); setPlaying(false); }}
        travelMm={travelMm}
        status={status}
        statusLabel={statusLabel}
      />

      <main className="layout">
        <section className="stage">
          <div className="stage-toolbar">
            <span className="eyebrow">Specimen · drag any pivot</span>
            <label className="check">
              <input type="checkbox" checked={showIC} onChange={(e) => setShowInstantCentre(e.target.checked)} />
              Instant centre
            </label>
          </div>
          <LinkageView
            design={design}
            sweep={sweep}
            metrics={metrics}
            frameIndex={frameIndex}
            selectedId={selectedId}
            snap={snap}
            gridSize={gridSize}
            showInstantCentre={showIC}
            onMovePoint={updatePoint}
            onSelect={selectPoint}
            onGrabStart={() => { setPlaying(false); setAnimPos(0); setDragging(true); }}
            onGrabEnd={() => setDragging(false)}
          />
          <AnimationBar
            playing={playing}
            animPos={animPos}
            travelMm={travelMm}
            totalTravelMm={totalTravel}
            onPlayToggle={() => setPlaying(!playing)}
            onScrub={(t) => { setPlaying(false); setAnimPos(t); }}
          />
        </section>

        <aside className="panel">
          <span className="eyebrow" style={{ padding: '0 2px' }}>Readout</span>
          <MetricsPanel
            metrics={metrics}
            design={design}
            activeMetric={activeMetric}
            highlightIndex={frameIndex}
            onSelectMetric={setActiveMetric}
          />
          <PivotEditor
            design={design}
            selectedId={selectedId}
            snap={snap}
            gridSize={gridSize}
            onMovePoint={updatePoint}
            onSelect={selectPoint}
            onSnap={setSnap}
            onGridSize={setGridSize}
            onShockStroke={setShockStroke}
          />
          <InputsPanel design={design} onChange={setMetricInputs} />
          <footer className="foot">
            <span>Free · open source · no account · works offline.</span>
            <a href="https://github.com/" target="_blank" rel="noreferrer">Source</a>
          </footer>
        </aside>
      </main>
    </div>
  );
}
