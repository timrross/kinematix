/**
 * Application state (Zustand). Holds the editable design plus UI state — including
 * the two app modes:
 *   - **Tune**: drag pivots, animate, read metrics (the original app).
 *   - **Build**: a topology editor — add/remove pivots and links, assign roles,
 *     and trace over a bike photo.
 *
 * Every design mutation flows through the private `commit()` helper, which keeps
 * undo history, re-derives the shock's home length, and persists only when the
 * design is complete enough to reload. Derived kinematics (sweep/metrics) live in
 * useDerived so they recompute only when the design identity changes.
 */

import { create } from 'zustand';
import { cloneDesign, type Design } from '../kinematics/model';
import { defaultDesign } from '../kinematics/presets';
import {
  addPoint, removePoint, addLink, removeLink, setFixed, setAxle, setBb,
  setShockEnd, recomputeEyeToEye, isComplete, calibrateScale,
} from '../kinematics/topology';
import type { XY } from '../kinematics/solver';
import { saveLast } from '../persistence/serialize';

export type MetricKey =
  | 'leverage'
  | 'axlePath'
  | 'antiSquat'
  | 'antiRise'
  | 'kickback';

export type Mode = 'tune' | 'build';
export type Tool = 'select' | 'add' | 'link' | 'delete';

/** A bike photo used purely as a tracing aid — never saved with the design. */
export interface TraceImage {
  src: string;
  imgW: number;
  imgH: number;
  /** mm per image pixel. */
  worldScale: number;
  /** World position of the image's top-left corner. */
  originX: number;
  originY: number;
  opacity: number;
}

const HISTORY_CAP = 50;

interface AppState {
  design: Design;
  selectedId: string | null;
  snap: boolean;
  gridSize: number;
  playing: boolean;
  animPos: number;
  activeMetric: MetricKey;
  showInstantCentre: boolean;
  dragging: boolean;

  // --- build mode ---
  mode: Mode;
  tool: Tool;
  /** First pivot picked while drawing a link (the rubber-band anchor). */
  linkAnchor: string | null;
  /** Transient message (e.g. why a delete was refused). */
  notice: string | null;
  past: Design[];
  future: Design[];

  // --- photo tracing ---
  trace: TraceImage | null;
  calibrating: boolean;
  calibrationFirst: XY | null;

  // tune-mode design edits
  setDesign: (d: Design, opts?: { persist?: boolean }) => void;
  updatePoint: (id: string, x: number, y: number) => void;
  /** Build-mode rear-axle move: x sets the wheelbase (front stays put), y is
   * locked to the rear tyre radius so the rear wheel always touches the ground. */
  dragRearAxle: (x: number) => void;
  setShockStroke: (stroke: number) => void;
  setMetricInputs: (patch: Partial<Design['metrics']>) => void;

  // ui
  selectPoint: (id: string | null) => void;
  setSnap: (on: boolean) => void;
  setGridSize: (mm: number) => void;
  setPlaying: (p: boolean) => void;
  setAnimPos: (t: number) => void;
  setActiveMetric: (m: MetricKey) => void;
  setShowInstantCentre: (s: boolean) => void;
  setDragging: (d: boolean) => void;

  // build mode
  setMode: (m: Mode) => void;
  setTool: (t: Tool) => void;
  setLinkAnchor: (id: string | null) => void;
  setNotice: (n: string | null) => void;
  undo: () => void;
  redo: () => void;
  addPivot: (x: number, y: number) => void;
  removePivot: (id: string) => void;
  addLinkBetween: (a: string, b: string) => void;
  removeLinkById: (id: string) => void;
  togglePointFixed: (id: string) => void;
  assignAxle: (id: string) => void;
  assignBb: (id: string) => void;
  assignShockEnd: (which: 'frame' | 'link', id: string) => void;

  // tracing
  loadTraceImage: (src: string, imgW: number, imgH: number) => void;
  setTraceOpacity: (o: number) => void;
  clearTrace: () => void;
  startCalibration: () => void;
  addCalibrationClick: (world: XY) => void;
  cancelCalibration: () => void;
}

export const useStore = create<AppState>((set, get) => {
  /** Persist only designs that can actually be reloaded (validateDesign-clean). */
  const persist = (d: Design) => {
    if (isComplete(d)) saveLast(d);
  };

  /** Apply a design mutation: snapshot for undo, re-derive eyeToEye, persist. */
  const commit = (next: Design) => {
    const past = [...get().past, get().design].slice(-HISTORY_CAP);
    const d = recomputeEyeToEye(next);
    set({ past, future: [], design: d, notice: null });
    persist(d);
  };

  return {
    design: defaultDesign(),
    selectedId: null,
    snap: false,
    gridSize: 5,
    playing: false,
    animPos: 0,
    activeMetric: 'leverage',
    showInstantCentre: true,
    dragging: false,

    mode: 'tune',
    tool: 'select',
    linkAnchor: null,
    notice: null,
    past: [],
    future: [],

    trace: null,
    calibrating: false,
    calibrationFirst: null,

    setDesign: (d, opts = { persist: true }) => {
      set({ design: d, past: [], future: [], selectedId: null });
      if (opts.persist !== false) persist(d);
    },

    updatePoint: (id, x, y) => {
      const cur = get().design;
      const d0 = cloneDesign(cur);
      const p = d0.points.find((pt) => pt.id === id);
      if (!p) return;
      p.x = x;
      p.y = y;
      const d = recomputeEyeToEye(d0); // keep the shock's home length consistent
      // One undo entry per drag (captured on grab start); numeric edits each
      // get their own entry.
      if (!get().dragging) {
        set({ past: [...get().past, cur].slice(-HISTORY_CAP), future: [] });
      }
      set({ design: d });
      persist(d);
    },

    dragRearAxle: (x) => {
      const cur = get().design;
      const axle = cur.points.find((p) => p.id === cur.axleId);
      if (!axle) return;
      const delta = x - axle.x;
      const d = cloneDesign(cur);
      const a = d.points.find((p) => p.id === d.axleId)!;
      a.x = x;
      a.y = d.metrics.rearTyreRadius; // rear wheel sits on the ground
      // Keep the (calibrated) front axle fixed: front x = axle.x − wheelbase, so
      // moving the axle by delta moves the wheelbase by the same delta.
      d.metrics = { ...d.metrics, wheelbase: Math.max(1, d.metrics.wheelbase + delta), touched: true };
      const d2 = recomputeEyeToEye(d);
      if (!get().dragging) set({ past: [...get().past, cur].slice(-HISTORY_CAP), future: [] });
      set({ design: d2 });
      persist(d2);
    },

    setShockStroke: (stroke) => {
      const d = cloneDesign(get().design);
      d.shock.stroke = Math.max(5, stroke);
      set({ design: d });
      persist(d);
    },

    setMetricInputs: (patch) => {
      const d = cloneDesign(get().design);
      const m = { ...d.metrics, ...patch, touched: true };
      m.cogHeight = Math.max(1, m.cogHeight);
      m.wheelbase = Math.max(1, m.wheelbase);
      m.chainringTeeth = Math.max(1, m.chainringTeeth);
      m.cogTeeth = Math.max(1, m.cogTeeth);
      m.rearTyreRadius = Math.max(1, m.rearTyreRadius);
      m.frontTyreRadius = Math.max(1, m.frontTyreRadius);
      d.metrics = m;
      // The rear axle sits one tyre-radius above the ground, so a wheel-size
      // change re-grounds it (keeps the rear wheel touching the ground line).
      if (patch.rearTyreRadius !== undefined) {
        const a = d.points.find((p) => p.id === d.axleId);
        if (a) a.y = m.rearTyreRadius;
      }
      const d2 = recomputeEyeToEye(d);
      set({ design: d2 });
      persist(d2);
    },

    selectPoint: (id) => set({ selectedId: id }),
    setSnap: (on) => set({ snap: on }),
    setGridSize: (mm) => set({ gridSize: Math.max(1, mm) }),
    setPlaying: (p) => set({ playing: p }),
    setAnimPos: (t) => set({ animPos: Math.min(1, Math.max(0, t)) }),
    setActiveMetric: (m) => set({ activeMetric: m }),
    setShowInstantCentre: (s) => set({ showInstantCentre: s }),
    setDragging: (d) => {
      // Snapshot the pre-drag design once, so a whole drag is a single undo.
      if (d && !get().dragging) {
        set({ past: [...get().past, get().design].slice(-HISTORY_CAP), future: [] });
      }
      set({ dragging: d });
    },

    // --- build mode ---
    setMode: (m) => set({ mode: m, tool: 'select', linkAnchor: null, notice: null, playing: false }),
    setTool: (t) => set({ tool: t, linkAnchor: null, notice: null, calibrating: false, calibrationFirst: null }),
    setLinkAnchor: (id) => set({ linkAnchor: id }),
    setNotice: (n) => set({ notice: n }),

    undo: () => {
      const { past, future, design } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ past: past.slice(0, -1), future: [design, ...future], design: prev, selectedId: null, notice: null });
      persist(prev);
    },
    redo: () => {
      const { past, future, design } = get();
      if (!future.length) return;
      const next = future[0];
      set({ future: future.slice(1), past: [...past, design], design: next, selectedId: null, notice: null });
      persist(next);
    },

    addPivot: (x, y) => {
      const { design, id } = addPoint(get().design, x, y);
      commit(design);
      set({ selectedId: id });
    },
    removePivot: (id) => {
      const r = removePoint(get().design, id);
      if (!r.ok) { set({ notice: r.reason ?? 'Cannot delete that point.' }); return; }
      commit(r.design);
      if (get().selectedId === id) set({ selectedId: null });
    },
    addLinkBetween: (a, b) => {
      const r = addLink(get().design, a, b);
      if (!r.ok) { set({ notice: r.reason ?? 'Cannot link those pivots.', linkAnchor: null }); return; }
      commit(r.design);
      set({ linkAnchor: null });
    },
    removeLinkById: (id) => commit(removeLink(get().design, id)),
    togglePointFixed: (id) => {
      const p = get().design.points.find((pt) => pt.id === id);
      if (!p) return;
      commit(setFixed(get().design, id, !p.fixed));
    },
    assignAxle: (id) => commit(setAxle(get().design, id)),
    assignBb: (id) => commit(setBb(get().design, id)),
    assignShockEnd: (which, id) => {
      const r = setShockEnd(get().design, which, id);
      if (!r.ok) { set({ notice: r.reason ?? 'Cannot assign the shock there.' }); return; }
      commit(r.design);
    },

    // --- tracing ---
    loadTraceImage: (src, imgW, imgH) => {
      // Drive-side photos read rear-on-the-left, which is the higher world x, so
      // the photo's left edge (pixel column 0) maps to the HIGHER world x and
      // world x decreases as the pixel column increases. Place it spanning
      // roughly the wheelbase to start, then IMMEDIATELY begin front-wheel
      // calibration — the first step is always positioning the photo.
      const { metrics, axleId, points } = get().design;
      const axle = points.find((p) => p.id === axleId);
      const worldW = metrics.wheelbase || 1240;
      const worldScale = worldW / imgW;
      const worldH = imgH * worldScale;
      const originX = (axle ? axle.x : 0) + worldW * 0.05;
      set({
        trace: { src, imgW, imgH, worldScale, originX, originY: worldH, opacity: 0.55 },
        calibrating: true,
        calibrationFirst: null,
      });
    },
    setTraceOpacity: (o) => {
      const t = get().trace;
      if (t) set({ trace: { ...t, opacity: Math.min(1, Math.max(0, o)) } });
    },
    clearTrace: () => set({ trace: null, calibrating: false, calibrationFirst: null }),

    /** Begin (or restart) front-wheel calibration: click the front axle, then the contact patch. */
    startCalibration: () => set({ calibrating: true, calibrationFirst: null, tool: 'select' }),
    addCalibrationClick: (world) => {
      const { calibrating, calibrationFirst, trace } = get();
      if (!calibrating || !trace) return;
      if (!calibrationFirst) {
        set({ calibrationFirst: world }); // first click = the front axle
        return;
      }
      // Second click = the front tyre's contact patch. The two are one tyre
      // radius apart, which sets the scale; and we reposition the photo so its
      // front axle lands exactly on the model's front axle.
      const toPx = (w: XY): XY => ({ x: (trace.originX - w.x) / trace.worldScale, y: (trace.originY - w.y) / trace.worldScale });
      const pxAxle = toPx(calibrationFirst);
      const pxPatch = toPx(world);
      const newScale = calibrateScale(pxAxle, pxPatch, get().design.metrics.frontTyreRadius);
      if (newScale <= 0) { set({ calibrating: false, calibrationFirst: null }); return; }
      const { metrics, points, axleId } = get().design;
      const axle = points.find((p) => p.id === axleId);
      const frontAxleX = (axle ? axle.x : 0) - metrics.wheelbase; // model front-axle world x
      set({
        trace: {
          ...trace,
          worldScale: newScale,
          // Place the photo so pxAxle maps to (frontAxleX, frontTyreRadius).
          originX: frontAxleX + pxAxle.x * newScale,
          originY: metrics.frontTyreRadius + pxAxle.y * newScale,
        },
        calibrating: false,
        calibrationFirst: null,
        notice: null,
      });
    },
    cancelCalibration: () => set({ calibrating: false, calibrationFirst: null }),
  };
});
