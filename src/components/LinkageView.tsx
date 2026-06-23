/**
 * The live, draggable side-on linkage view. This is the heart of the product:
 * drag any pivot and the mechanism re-solves and everything re-plots live.
 *
 * Dragging always edits the home (fully-extended) geometry, so when a drag
 * begins we snap the animation back to the top of the travel — the pivot you
 * grab is then exactly where it lives in the design you are editing.
 */

import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Design } from '../kinematics/model';
import type { SweepResult } from '../kinematics/sweep';
import type { XY } from '../kinematics/solver';
import type { Metrics } from '../kinematics/metrics';
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
  onMovePoint: (id: string, x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onGrabStart: () => void;
  onGrabEnd: () => void;
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

export default function LinkageView({
  design,
  sweep,
  metrics,
  frameIndex,
  selectedId,
  snap,
  gridSize,
  showInstantCentre,
  onMovePoint,
  onSelect,
  onGrabStart,
  onGrabEnd,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  // The pivot currently being dragged. Dragging only begins on an *already
  // selected* pivot, and only once the pointer has actually moved past a small
  // threshold — so a click selects without ever nudging the geometry.
  const dragRef = useRef<string | null>(null);
  const pendingRef = useRef<{ id: string; x: number; y: number } | null>(null);

  const valid = sweep.structurallyValid && sweep.frames.length > 0;
  const lastValid = sweep.validTo >= 0 ? sweep.validTo : 0;
  const fi = valid ? Math.min(frameIndex, lastValid) : 0;
  const frame = valid ? sweep.frames[fi] : null;

  const homeById = useMemo(
    () => Object.fromEntries(design.points.map((p) => [p.id, { x: p.x, y: p.y }])),
    [design],
  );
  const pos = (id: string): XY => (frame ? frame.positions[id] : homeById[id]);

  const homeAxle = homeById[design.axleId];
  const frontAxle: XY = {
    x: homeAxle.x - design.metrics.wheelbase,
    y: design.metrics.frontTyreRadius,
  };

  // Transform fitted to a stable bounding box (all travel + both wheels + ground).
  const transform: Transform = useMemo(() => {
    const samples: XY[] = [];
    for (const p of design.points) samples.push({ x: p.x, y: p.y });
    // Axle through full travel.
    if (metrics) {
      for (const ap of metrics.axlePath) samples.push({ x: homeAxle.x + ap.rearward, y: homeAxle.y + ap.vertical });
    }
    // Wheel extents and ground.
    const rR = design.metrics.rearTyreRadius;
    const fR = design.metrics.frontTyreRadius;
    samples.push({ x: homeAxle.x + rR, y: 0 }, { x: homeAxle.x - rR, y: homeAxle.y + rR });
    samples.push({ x: frontAxle.x + fR, y: 0 }, { x: frontAxle.x - fR, y: frontAxle.y + fR });
    samples.push({ x: homeAxle.x, y: 0 }, { x: frontAxle.x, y: 0 });
    return fitTransform(unionBounds(samples, 40), VIEW_W, VIEW_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, metrics]);

  const S = (p: XY) => worldToScreen(transform, p);

  function pointerToWorld(e: ReactPointerEvent): XY {
    const rect = svgRef.current!.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * VIEW_W;
    const vy = ((e.clientY - rect.top) / rect.height) * VIEW_H;
    return screenToWorld(transform, { x: vx, y: vy });
  }

  /** Move pixels before a press on a selected pivot is treated as a drag. */
  const DRAG_THRESHOLD = 4;

  function applyMove(e: ReactPointerEvent, id: string) {
    let w = pointerToWorld(e);
    if (snap) {
      w = { x: Math.round(w.x / gridSize) * gridSize, y: Math.round(w.y / gridSize) * gridSize };
    } else {
      w = { x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10 };
    }
    onMovePoint(id, w.x, w.y);
  }

  function handlePivotDown(e: ReactPointerEvent, id: string) {
    e.preventDefault();
    if (id !== selectedId) {
      // First touch: just select it. No drag is armed, so the layout can't move.
      onSelect(id);
      return;
    }
    // Already selected: arm a drag that commits once the pointer actually moves.
    // Pointer capture keeps move events flowing if the finger leaves the handle.
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pendingRef.current = { id, x: e.clientX, y: e.clientY };
  }

  function handleMove(e: ReactPointerEvent) {
    if (dragRef.current) {
      applyMove(e, dragRef.current);
      return;
    }
    const pending = pendingRef.current;
    if (pending) {
      const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (moved > DRAG_THRESHOLD) {
        // Crossed the threshold — this is a real drag now.
        dragRef.current = pending.id;
        pendingRef.current = null;
        onGrabStart();
        applyMove(e, pending.id);
      }
    }
  }

  function handleUp(e: ReactPointerEvent) {
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
  const hull = convexHull([...fixedPts, frontAxle, { x: homeAxle.x - design.metrics.wheelbase * 0.0, y: 0 }]);
  const hullPath = hull.map((p) => S(p)).map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ' Z';

  const axlePathD = metrics
    ? metrics.axlePath
        .map((ap) => S({ x: homeAxle.x + ap.rearward, y: homeAxle.y + ap.vertical }))
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(' ')
    : '';

  // Instant centre overlay (current frame). The construction lines run from the
  // IC to the two carrier reference points (the axle + a co-moving carrier
  // point) — the points whose motion actually defines the instant centre.
  const ic = valid && metrics ? metrics.instantCentre[fi]?.ic ?? null : null;
  const carrierRefs = metrics?.carrierRefs ?? null;

  // Number of distinct frame-fixed points used as link pivots: 1 ⇒ single pivot,
  // ≥2 ⇒ four-bar. (The shock mount is the driver, not a link, so it's excluded.)
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

  return (
    <svg
      ref={svgRef}
      className="linkage"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      role="application"
      aria-label="Draggable suspension linkage"
    >
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
            return (
              <line
                key={id}
                x1={a.x}
                y1={a.y}
                x2={icS.x}
                y2={icS.y}
                className={`ic-line ${id === design.axleId ? 'ic-line-axle' : ''}`}
              />
            );
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

      {/* shock */}
      <Shock a={S(pos(design.shock.frame))} b={S(pos(design.shock.link))} valid={valid} />

      {/* pivots */}
      {design.points.map((p) => {
        const s = S(pos(p.id));
        const selected = p.id === selectedId;
        const cls = ['pivot', p.fixed ? 'pivot-fixed' : 'pivot-free', selected ? 'pivot-selected' : ''].join(' ');
        return (
          <g key={p.id}>
            {/* large invisible hit target for touch */}
            <circle
              cx={s.x}
              cy={s.y}
              r={20}
              className={`pivot-hit ${selected ? 'pivot-hit-selected' : ''}`}
              onPointerDown={(e) => handlePivotDown(e, p.id)}
            />
            <circle cx={s.x} cy={s.y} r={selected ? 9 : 7} className={cls} />
            {selected && (
              <text x={s.x + 12} y={s.y - 12} className="pivot-label">{p.name}</text>
            )}
          </g>
        );
      })}

      {/* live travel dimension (drafting style) — appears once compressed */}
      <TravelDimension
        home={S(homeAxle)}
        now={S(pos(design.axleId))}
        tyreR={rR}
        worldTravel={pos(design.axleId).y - homeAxle.y}
      />

      {/* title block (drafting corner) */}
      <TitleBlock
        name={design.name}
        travel={metrics ? `${metrics.totalTravel.toFixed(0)} mm` : '—'}
        mechanism={groundPivotCount <= 1 ? 'Single pivot' : 'Four-bar · 1 DOF'}
        viewH={VIEW_H}
      />

      {/* invalid / binding banners */}
      {!valid && (
        <text x={VIEW_W / 2} y={40} className="banner banner-invalid" textAnchor="middle">
          {sweep.structuralMessage ?? 'Linkage cannot be solved'}
        </text>
      )}
      {bindsEarly && valid && (
        <text x={VIEW_W / 2} y={40} className="banner banner-warn" textAnchor="middle">
          Binds before full travel — only {Math.round((sweep.validTo / (sweep.frames.length - 1)) * 100)}% of stroke is valid
        </text>
      )}
    </svg>
  );
}

/** Drafting-style vertical dimension line showing live wheel travel. */
function TravelDimension({ home, now, tyreR, worldTravel }: { home: XY; now: XY; tyreR: number; worldTravel: number }) {
  if (Math.abs(worldTravel) < 2) return null; // hidden at full extension
  const x = now.x + tyreR + 16;
  const top = Math.min(home.y, now.y);
  const bot = Math.max(home.y, now.y);
  const mid = (top + bot) / 2;
  return (
    <g>
      {/* extension lines from the axle (home + now) out to the dimension */}
      <line x1={home.x} y1={home.y} x2={x + 6} y2={home.y} className="dim-tick" />
      <line x1={now.x} y1={now.y} x2={x + 6} y2={now.y} className="dim-tick" />
      {/* the dimension itself with arrow ticks */}
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
  // A simple body + coil hint along the a→b axis.
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
