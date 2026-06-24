/**
 * Top-level app: restores a design (from a share link, then localStorage, then a
 * preset), runs the travel animation loop, and lays out the linkage stage beside
 * the live metrics (Tune mode) or the topology editor (Build mode). Everything
 * recomputes from the single source of truth — the design.
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
import BuildToolbar from './components/BuildToolbar';
import TopologyPanel from './components/TopologyPanel';

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
  const zoom = useStore((s) => s.zoom);
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const linkAnchor = useStore((s) => s.linkAnchor);
  const trace = useStore((s) => s.trace);
  const calibrating = useStore((s) => s.calibrating);
  const calibrationFirst = useStore((s) => s.calibrationFirst);

  const {
    setDesign, updatePoint, dragRearAxle, setShockStroke, setMetricInputs, selectPoint,
    setSnap, setGridSize, setPlaying, setAnimPos, setActiveMetric, setShowInstantCentre,
    setDragging, addPivot, addLinkBetween, removePivot, removeLinkById, setLinkAnchor,
    addCalibrationClick, undo, redo, zoomBy, fitView,
  } = useStore.getState();

  const buildMode = mode === 'build';

  // Restore a design once, on mount: share link wins, then last session.
  useEffect(() => {
    if (location.hash.startsWith('#d=')) {
      const fromHash = designFromHash(location.hash);
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

  // Undo/redo keyboard shortcuts (Build mode).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'z') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

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
    <div className={`app ${buildMode ? 'build' : ''}`}>
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
            <BuildToolbar />
            <div className="stage-toolbar-right">
              {!buildMode && (
                <label className="check">
                  <input type="checkbox" checked={showIC} onChange={(e) => setShowInstantCentre(e.target.checked)} />
                  Instant centre
                </label>
              )}
              <div className="zoom-controls" role="group" aria-label="Zoom">
                <button className="zoom-btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">−</button>
                <button className="zoom-btn fit" onClick={fitView} title="Fit everything in view">Fit</button>
                <button className="zoom-btn" onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">+</button>
              </div>
            </div>
          </div>
          <LinkageView
            design={design}
            sweep={sweep}
            metrics={metrics}
            frameIndex={frameIndex}
            selectedId={selectedId}
            snap={snap}
            gridSize={gridSize}
            showInstantCentre={showIC && !buildMode}
            zoom={zoom}
            mode={mode}
            tool={tool}
            linkAnchor={linkAnchor}
            trace={trace}
            calibrating={calibrating}
            calibrationFirst={calibrationFirst}
            onMovePoint={updatePoint}
            onDragRearAxle={dragRearAxle}
            onSelect={selectPoint}
            onGrabStart={() => { setPlaying(false); setAnimPos(0); setDragging(true); }}
            onGrabEnd={() => setDragging(false)}
            onAddPivot={addPivot}
            onLinkPivots={addLinkBetween}
            onDeletePivot={removePivot}
            onDeleteLink={removeLinkById}
            onSetLinkAnchor={setLinkAnchor}
            onCalibrationClick={addCalibrationClick}
          />
          {!buildMode && (
            <AnimationBar
              playing={playing}
              animPos={animPos}
              travelMm={travelMm}
              totalTravelMm={totalTravel}
              onPlayToggle={() => setPlaying(!playing)}
              onScrub={(t) => { setPlaying(false); setAnimPos(t); }}
            />
          )}
        </section>

        <aside className="panel">
          {buildMode ? (
            <>
              <span className="eyebrow" style={{ padding: '0 2px' }}>Build</span>
              <TopologyPanel design={design} sweep={sweep} />
            </>
          ) : (
            <>
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
            </>
          )}
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
