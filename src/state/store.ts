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
  calibrationRefMm: number;
  calibrationFirst: XY | null;

  // tune-mode design edits
  setDesign: (d: Design, opts?: { persist?: boolean }) => void;
  updatePoint: (id: string, x: number, y: number) => void;
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
  startCalibration: (refMm: number) => void;
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
    calibrationRefMm: 0,
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
      set({ design: d });
      persist(d);
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
      // roughly the wheelbase, sitting above the ground; calibration refines it.
      const { metrics, axleId, points } = get().design;
      const axle = points.find((p) => p.id === axleId);
      const worldW = metrics.wheelbase || 1240;
      const worldScale = worldW / imgW;
      const worldH = imgH * worldScale;
      const originX = (axle ? axle.x : 0) + worldW * 0.05; // px0 (rear) just behind the rear axle
      set({ trace: { src, imgW, imgH, worldScale, originX, originY: worldH, opacity: 0.55 } });
    },
    setTraceOpacity: (o) => {
      const t = get().trace;
      if (t) set({ trace: { ...t, opacity: Math.min(1, Math.max(0, o)) } });
    },
    clearTrace: () => set({ trace: null, calibrating: false, calibrationFirst: null }),

    startCalibration: (refMm) =>
      set({ calibrating: true, calibrationRefMm: refMm, calibrationFirst: null, tool: 'select' }),
    addCalibrationClick: (world) => {
      const { calibrating, calibrationFirst, calibrationRefMm, trace } = get();
      if (!calibrating || !trace) return;
      if (!calibrationFirst) {
        set({ calibrationFirst: world });
        return;
      }
      // Second click → rescale the image about the first reference point.
      const a = calibrationFirst;
      const b = world;
      // World x decreases with pixel column (see loadTraceImage), so px = (originX - x)/scale.
      const toPx = (w: XY): XY => ({ x: (trace.originX - w.x) / trace.worldScale, y: (trace.originY - w.y) / trace.worldScale });
      const pxA = toPx(a);
      const pxB = toPx(b);
      const newScale = calibrateScale(pxA, pxB, calibrationRefMm);
      if (newScale <= 0) { set({ calibrating: false, calibrationFirst: null }); return; }
      // Keep reference point A fixed in world: originX = a.x + pxA.x·scale, originY = a.y + pxA.y·scale.
      set({
        trace: { ...trace, worldScale: newScale, originX: a.x + pxA.x * newScale, originY: a.y + pxA.y * newScale },
        calibrating: false,
        calibrationFirst: null,
        notice: null,
      });
    },
    cancelCalibration: () => set({ calibrating: false, calibrationFirst: null }),
  };
});
