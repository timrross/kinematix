/**
 * The side-on linkage view. Two modes share this canvas:
 *  - **Tune**: the live, draggable mechanism — drag a pivot and everything
 *    re-solves and re-plots. Dragging edits the home (fully-extended) geometry.
 *  - **Build**: a topology editor — an explicit tool (Select / Add / Link /
 *    Delete) drives the canvas, optionally over a traced bike photo.
 */

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Design } from '../kinematics/model';
import type { SweepResult } from '../kinematics/sweep';
import type { XY } from '../kinematics/solver';
import type { Metrics } from '../kinematics/metrics';
import type { Mode, Tool, TraceImage } from '../state/store';
import {
  fitTransform,
  screenToWorld,
  unionBounds,
  worldToScreen,
  type Transform,
} from '../geometry/transform';

const VIEW_W = 1000;
const VIEW_H = 640;

interface Props {
  design: Design;
  sweep: SweepResult;
  metrics: Metrics | null;
  frameIndex: number;
  selectedId: string | null;
  snap: boolean;
  gridSize: number;
  showInstantCentre: boolean;
  // build mode
  mode: Mode;
  tool: Tool;
  linkAnchor: string | null;
  trace: TraceImage | null;
  calibrating: boolean;
  calibrationFirst: XY | null;
  onMovePoint: (id: string, x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onGrabStart: () => void;
  onGrabEnd: () => void;
  onAddPivot: (x: number, y: number) => void;
  onLinkPivots: (a: string, b: string) => void;
  onDeletePivot: (id: string) => void;
  onDeleteLink: (id: string) => void;
  onSetLinkAnchor: (id: string | null) => void;
  onCalibrationClick: (world: XY) => void;
}

/** Andrew's monotone-chain convex hull, for the front-triangle silhouette. */
function convexHull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: XY, a: XY, b: XY) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: XY[] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: XY[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop();
    upper.push(pt);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export default function LinkageView(props: Props) {
  const {
    design, sweep, metrics, frameIndex, selectedId, snap, gridSize, showInstantCentre,
    mode, tool, linkAnchor, trace, calibrating, calibrationFirst,
    onMovePoint, onSelect, onGrabStart, onGrabEnd,
    onAddPivot, onLinkPivots, onDeletePivot, onDeleteLink, onSetLinkAnchor, onCalibrationClick,
  } = props;

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<string | null>(null);
  const pendingRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const [rubber, setRubber] = useState<XY | null>(null); // viewBox coords of the link rubber-band end

  const buildMode = mode === 'build';
  const valid = sweep.structurallyValid && sweep.frames.length > 0;
  const lastValid = sweep.validTo >= 0 ? sweep.validTo : 0;
  // Build mode edits and shows the home (drawn) geometry.
  const fi = buildMode ? 0 : valid ? Math.min(frameIndex, lastValid) : 0;
  const frame = buildMode ? null : valid ? sweep.frames[fi] : null;

  const homeById = useMemo(
    () => Object.fromEntries(design.points.map((p) => [p.id, { x: p.x, y: p.y }])),
    [design],
  );
  const pos = (id: string): XY => (frame ? frame.positions[id] : homeById[id]);

  const homeAxle = homeById[design.axleId] ?? { x: 0, y: 0 };
  const frontAxle: XY = {
    x: homeAxle.x - design.metrics.wheelbase,
    y: design.metrics.frontTyreRadius,
  };

  const transform: Transform = useMemo(() => {
    const samples: XY[] = [];
    for (const p of design.points) samples.push({ x: p.x, y: p.y });
    if (metrics) {
      for (const ap of metrics.axlePath) samples.push({ x: homeAxle.x + ap.rearward, y: homeAxle.y + ap.vertical });
    }
    const rR = design.metrics.rearTyreRadius;
    const fR = design.metrics.frontTyreRadius;
    samples.push({ x: homeAxle.x + rR, y: 0 }, { x: homeAxle.x - rR, y: homeAxle.y + rR });
    samples.push({ x: frontAxle.x + fR, y: 0 }, { x: frontAxle.x - fR, y: frontAxle.y + fR });
    samples.push({ x: homeAxle.x, y: 0 }, { x: frontAxle.x, y: 0 });
    // Keep a traced photo framed.
    if (trace) {
      const w = trace.imgW * trace.worldScale;
      const h = trace.imgH * trace.worldScale;
      samples.push(
        { x: trace.originX, y: trace.originY },
        { x: trace.originX + w, y: trace.originY },
        { x: trace.originX, y: trace.originY - h },
        { x: trace.originX + w, y: trace.originY - h },
      );
    }
    return fitTransform(unionBounds(samples, 40), VIEW_W, VIEW_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, metrics, trace]);

  const S = (p: XY) => worldToScreen(transform, p);

  function pointerToView(e: ReactPointerEvent): XY {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * VIEW_W, y: ((e.clientY - rect.top) / rect.height) * VIEW_H };
  }
  function pointerToWorld(e: ReactPointerEvent): XY {
    return screenToWorld(transform, pointerToView(e));
  }
  function snapWorld(w: XY): XY {
    return snap
      ? { x: Math.round(w.x / gridSize) * gridSize, y: Math.round(w.y / gridSize) * gridSize }
      : { x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10 };
  }

  /** Hit-test for the pivot nearest the pointer (used when linking). */
  function pivotAt(e: ReactPointerEvent): string | null {
    const v = pointerToView(e);
    let best: string | null = null;
    let bestD = 22;
    for (const p of design.points) {
      const s = S(pos(p.id));
      const d = Math.hypot(s.x - v.x, s.y - v.y);
      if (d < bestD) { bestD = d; best = p.id; }
    }
    return best;
  }

  // --- tune-mode select + drag (also the Select tool in build mode) ---
  const DRAG_THRESHOLD = 4;
  function applyMove(e: ReactPointerEvent, id: string) {
    const w = snapWorld(pointerToWorld(e));
    onMovePoint(id, w.x, w.y);
  }
  function selectDown(e: ReactPointerEvent, id: string) {
    e.preventDefault();
    if (id !== selectedId) { onSelect(id); return; }
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pendingRef.current = { id, x: e.clientX, y: e.clientY };
  }

  // --- unified pointer dispatch ---
  function onPivotDown(e: ReactPointerEvent, id: string) {
    e.preventDefault();
    if (calibrating) { onCalibrationClick(pointerToWorld(e)); return; }
    if (buildMode) {
      if (tool === 'delete') { onDeletePivot(id); return; }
      if (tool === 'add') { onSelect(id); return; }
      if (tool === 'link') {
        if (!linkAnchor) { onSetLinkAnchor(id); setRubber(S(pos(id))); }
        else if (id !== linkAnchor) { onLinkPivots(linkAnchor, id); setRubber(null); }
        else { onSetLinkAnchor(null); setRubber(null); }
        return;
      }
    }
    selectDown(e, id); // select tool / tune
  }

  function onBgDown(e: ReactPointerEvent) {
    if (calibrating) { onCalibrationClick(pointerToWorld(e)); return; }
    if (!buildMode) return;
    if (tool === 'add') { const w = snapWorld(pointerToWorld(e)); onAddPivot(w.x, w.y); return; }
    if (tool === 'link') { onSetLinkAnchor(null); setRubber(null); return; }
    if (tool === 'select') onSelect(null);
  }

  function onMove(e: ReactPointerEvent) {
    if (buildMode && tool === 'link' && linkAnchor) { setRubber(pointerToView(e)); return; }
    if (dragRef.current) { applyMove(e, dragRef.current); return; }
    const pending = pendingRef.current;
    if (pending) {
      const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (moved > DRAG_THRESHOLD) {
        dragRef.current = pending.id;
        pendingRef.current = null;
        onGrabStart();
        applyMove(e, pending.id);
      }
    }
  }
  function onUp(e: ReactPointerEvent) {
    // Linking also completes on release over a different pivot (press-drag).
    if (buildMode && tool === 'link' && linkAnchor) {
      const id = pivotAt(e);
      if (id && id !== linkAnchor) { onLinkPivots(linkAnchor, id); setRubber(null); }
    }
    const wasDragging = dragRef.current !== null;
    if (dragRef.current || pendingRef.current) {
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    dragRef.current = null;
    pendingRef.current = null;
    if (wasDragging) onGrabEnd();
  }

  // --- geometry to draw ---
  const groundY = S({ x: 0, y: 0 }).y;
  const rearAxleS = S(pos(design.axleId));
  const frontAxleS = S(frontAxle);
  const rR = design.metrics.rearTyreRadius * transform.scale;
  const fR = design.metrics.frontTyreRadius * transform.scale;

  const fixedPts = design.points.filter((p) => p.fixed).map((p) => ({ x: p.x, y: p.y }));
  const hull = convexHull([...fixedPts, frontAxle, { x: homeAxle.x, y: 0 }]);
  const hullPath = hull.map((p) => S(p)).map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

  const axlePathD = metrics
    ? metrics.axlePath
        .map((ap) => S({ x: homeAxle.x + ap.rearward, y: homeAxle.y + ap.vertical }))
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ')
    : '';

  const ic = valid && metrics ? metrics.instantCentre[fi]?.ic ?? null : null;
  const carrierRefs = metrics?.carrierRefs ?? null;

  const groundPivotCount = useMemo(() => {
    const fixedIds = new Set(design.points.filter((p) => p.fixed).map((p) => p.id));
    const used = new Set<string>();
    for (const l of design.links) {
      if (fixedIds.has(l.a)) used.add(l.a);
      if (fixedIds.has(l.b)) used.add(l.b);
    }
    return used.size;
  }, [design]);

  const bindsEarly = valid && sweep.validTo < sweep.frames.length - 1;

  const roleOf = (id: string): string | null => {
    if (id === design.axleId) return 'AXLE';
    if (id === design.bbId) return 'BB';
    if (id === design.shock.frame) return 'FRAME';
    if (id === design.shock.link) return 'SHOCK';
    return null;
  };

  // Image backdrop screen rect — the bounding box of the world rect's corners,
  // so it sits correctly (and un-mirrored) regardless of the x-flip.
  const traceRect = trace
    ? (() => {
        const wW = trace.imgW * trace.worldScale;
        const wH = trace.imgH * trace.worldScale;
        // World x decreases across the photo (px0 = left = rear at the higher x).
        const c1 = S({ x: trace.originX, y: trace.originY });
        const c2 = S({ x: trace.originX - wW, y: trace.originY - wH });
        return { x: Math.min(c1.x, c2.x), y: Math.min(c1.y, c2.y), w: Math.abs(c2.x - c1.x), h: Math.abs(c2.y - c1.y) };
      })()
    : null;

  return (
    <svg
      ref={svgRef}
      className={`linkage ${buildMode ? 'build' : ''}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="application"
      aria-label={buildMode ? 'Topology editor canvas' : 'Draggable suspension linkage'}
    >
      {/* background tap target (build mode) — captures empty-canvas clicks */}
      {(buildMode || calibrating) && (
        <rect x={0} y={0} width={VIEW_W} height={VIEW_H} style={{ pointerEvents: 'auto', fill: 'transparent' }} onPointerDown={onBgDown} />
      )}

      {/* traced photo backdrop (build mode only) */}
      {buildMode && trace && traceRect && (
        <image
          href={trace.src}
          x={traceRect.x}
          y={traceRect.y}
          width={traceRect.w}
          height={traceRect.h}
          opacity={trace.opacity}
          preserveAspectRatio="none"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* ground line + drafting "fixed" hatching */}
      <line x1={0} y1={groundY} x2={VIEW_W} y2={groundY} className="ground" />
      {Array.from({ length: Math.ceil(VIEW_W / 26) + 1 }, (_, i) => {
        const x = i * 26;
        return <line key={`h${i}`} x1={x} y1={groundY} x2={x - 11} y2={groundY + 11} className="ground-hatch" />;
      })}

      {/* front triangle hint */}
      <path d={hullPath} className="frame-hull" />

      {/* wheels */}
      <circle cx={frontAxleS.x} cy={frontAxleS.y} r={fR} className="tyre" />
      <circle cx={frontAxleS.x} cy={frontAxleS.y} r={3} className="hub" />
      <circle cx={rearAxleS.x} cy={rearAxleS.y} r={rR} className={`tyre ${valid ? '' : 'tyre-invalid'}`} />
      <circle cx={rearAxleS.x} cy={rearAxleS.y} r={3} className="hub" />

      {/* axle path trace */}
      {axlePathD && <path d={axlePathD} className="axle-path" />}

      {/* instant-centre construction */}
      {showInstantCentre && ic && Number.isFinite(ic.x) && Number.isFinite(ic.y) && (
        <g className="ic-group">
          {(carrierRefs ?? [design.axleId]).map((id) => {
            const a = S(pos(id));
            const icS = S(ic);
            return <line key={id} x1={a.x} y1={a.y} x2={icS.x} y2={icS.y} className={`ic-line ${id === design.axleId ? 'ic-line-axle' : ''}`} />;
          })}
          <g transform={`translate(${S(ic).x.toFixed(1)},${S(ic).y.toFixed(1)})`}>
            <circle r={6} className="ic-dot" />
            <line x1={-10} y1={0} x2={10} y2={0} className="ic-cross" />
            <line x1={0} y1={-10} x2={0} y2={10} className="ic-cross" />
            <text x={12} y={-8} className="ic-label">IC</text>
          </g>
        </g>
      )}

      {/* links */}
      {design.links.map((l) => {
        const a = S(pos(l.a));
        const b = S(pos(l.b));
        return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`link ${valid ? '' : 'link-invalid'}`} />;
      })}

      {/* link delete hit-lines (build mode, delete tool) */}
      {buildMode && tool === 'delete' && design.links.map((l) => {
        const a = S(pos(l.a));
        const b = S(pos(l.b));
        return (
          <line
            key={`hit-${l.id}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="transparent" strokeWidth={16}
            style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
            onPointerDown={(e) => { e.preventDefault(); onDeleteLink(l.id); }}
          />
        );
      })}

      {/* rubber-band while linking */}
      {buildMode && tool === 'link' && linkAnchor && rubber && (
        <line x1={S(pos(linkAnchor)).x} y1={S(pos(linkAnchor)).y} x2={rubber.x} y2={rubber.y} className="rubber-band" />
      )}

      {/* shock */}
      <Shock a={S(pos(design.shock.frame))} b={S(pos(design.shock.link))} valid={valid} />

      {/* pivots */}
      {design.points.map((p) => {
        const s = S(pos(p.id));
        const selected = p.id === selectedId;
        const anchored = p.id === linkAnchor;
        const cls = ['pivot', p.fixed ? 'pivot-fixed' : 'pivot-free', selected ? 'pivot-selected' : '', anchored ? 'pivot-anchored' : ''].join(' ');
        const role = buildMode ? roleOf(p.id) : null;
        const cursor = buildMode && (tool === 'delete') ? 'pointer' : buildMode && tool === 'link' ? 'crosshair' : undefined;
        return (
          <g key={p.id}>
            <circle
              cx={s.x} cy={s.y} r={20}
              className={`pivot-hit ${selected ? 'pivot-hit-selected' : ''}`}
              style={cursor ? { cursor } : undefined}
              onPointerDown={(e) => onPivotDown(e, p.id)}
            />
            <circle cx={s.x} cy={s.y} r={selected || anchored ? 9 : 7} className={cls} />
            {(selected || buildMode) && (
              <text x={s.x + 12} y={s.y - 11} className="pivot-label">{p.name}</text>
            )}
            {role && <text x={s.x + 12} y={s.y + 3} className="role-badge">{role}</text>}
          </g>
        );
      })}

      {/* calibration markers */}
      {calibrating && calibrationFirst && (
        <g>
          <circle cx={S(calibrationFirst).x} cy={S(calibrationFirst).y} r={6} className="calib-dot" />
          <text x={S(calibrationFirst).x + 10} y={S(calibrationFirst).y - 8} className="calib-label">1</text>
        </g>
      )}

      {/* live travel dimension (tune mode) */}
      {!buildMode && (
        <TravelDimension home={S(homeAxle)} now={S(pos(design.axleId))} tyreR={rR} worldTravel={pos(design.axleId).y - homeAxle.y} />
      )}

      {/* title block (drafting corner) */}
      <TitleBlock
        name={design.name}
        travel={metrics ? `${metrics.totalTravel.toFixed(0)} mm` : '—'}
        mechanism={groundPivotCount <= 1 ? 'Single pivot' : 'Four-bar · 1 DOF'}
        viewH={VIEW_H}
      />

      {/* invalid / binding banners */}
      {!valid && !buildMode && (
        <text x={VIEW_W / 2} y={40} className="banner banner-invalid" textAnchor="middle">
          {sweep.structuralMessage ?? 'Linkage cannot be solved'}
        </text>
      )}
      {bindsEarly && valid && !buildMode && (
        <text x={VIEW_W / 2} y={40} className="banner banner-warn" textAnchor="middle">
          Binds before full travel — only {Math.round((sweep.validTo / (sweep.frames.length - 1)) * 100)}% of stroke is valid
        </text>
      )}
    </svg>
  );
}

/** Drafting-style vertical dimension line showing live wheel travel. */
function TravelDimension({ home, now, tyreR, worldTravel }: { home: XY; now: XY; tyreR: number; worldTravel: number }) {
  if (Math.abs(worldTravel) < 2) return null;
  const x = now.x + tyreR + 16;
  const top = Math.min(home.y, now.y);
  const bot = Math.max(home.y, now.y);
  const mid = (top + bot) / 2;
  return (
    <g>
      <line x1={home.x} y1={home.y} x2={x + 6} y2={home.y} className="dim-tick" />
      <line x1={now.x} y1={now.y} x2={x + 6} y2={now.y} className="dim-tick" />
      <line x1={x} y1={top} x2={x} y2={bot} className="dim-line" />
      <path d={`M${x - 4},${top + 7} L${x},${top} L${x + 4},${top + 7}`} fill="none" className="dim-line" />
      <path d={`M${x - 4},${bot - 7} L${x},${bot} L${x + 4},${bot - 7}`} fill="none" className="dim-line" />
      <text x={x + 9} y={mid + 4} className="dim-label">{Math.abs(worldTravel).toFixed(0)} mm</text>
    </g>
  );
}

/** Drafting-style title block in the lower-left corner. */
function TitleBlock({ name, travel, mechanism, viewH }: { name: string; travel: string; mechanism: string; viewH: number }) {
  const x = 12;
  const w = 232;
  const h = 60;
  const y = viewH - h - 12;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} className="titleblock" rx={3} />
      <line x1={x} y1={y + 22} x2={x + w} y2={y + 22} className="titleblock" />
      <line x1={x + w * 0.62} y1={y + 22} x2={x + w * 0.62} y2={y + h} className="titleblock" />
      <text x={x + 10} y={y + 15} className="titleblock-val">{name}</text>
      <text x={x + 10} y={y + 36} className="titleblock-key">MECHANISM</text>
      <text x={x + 10} y={y + 51} className="titleblock-val" style={{ fontSize: 11 }}>{mechanism}</text>
      <text x={x + w * 0.62 + 10} y={y + 36} className="titleblock-key">TRAVEL</text>
      <text x={x + w * 0.62 + 10} y={y + 51} className="titleblock-val">{travel}</text>
    </g>
  );
}

function Shock({ a, b, valid }: { a: XY; b: XY; valid: boolean }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const coils = 6;
  const bodyStart = 0.28;
  const bodyEnd = 0.72;
  const amp = 7;
  const pts: string[] = [];
  for (let i = 0; i <= coils; i++) {
    const t = bodyStart + (i / coils) * (bodyEnd - bodyStart);
    const side = i % 2 === 0 ? 1 : -1;
    const px = a.x + ux * len * t + nx * amp * side;
    const py = a.y + uy * len * t + ny * amp * side;
    pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
  }
  return (
    <g className={`shock ${valid ? '' : 'shock-invalid'}`}>
      <line x1={a.x} y1={a.y} x2={a.x + ux * len * bodyStart} y2={a.y + uy * len * bodyStart} className="shock-rod" />
      <polyline points={pts.join(' ')} className="shock-coil" />
      <line x1={a.x + ux * len * bodyEnd} y1={a.y + uy * len * bodyEnd} x2={b.x} y2={b.y} className="shock-rod" />
    </g>
  );
}
