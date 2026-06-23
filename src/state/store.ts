/**
 * Application state (Zustand). Holds the editable design plus UI state
 * (selection, animation, snap-to-grid). Derived kinematics (the sweep and
 * metrics) are computed separately in useDerived so they recompute only when the
 * design actually changes.
 */

import { create } from 'zustand';
import { cloneDesign, type Design } from '../kinematics/model';
import { defaultDesign } from '../kinematics/presets';
import { saveLast } from '../persistence/serialize';

export type MetricKey =
  | 'leverage'
  | 'axlePath'
  | 'antiSquat'
  | 'antiRise'
  | 'kickback';

interface AppState {
  design: Design;
  /** Currently selected pivot id (for the numeric editor / highlight). */
  selectedId: string | null;
  /** Snap dragged pivots to a grid. */
  snap: boolean;
  gridSize: number; // mm
  /** Animation: playing flag and normalised travel position 0..1. */
  playing: boolean;
  animPos: number;
  /** Which metric curve is featured large. */
  activeMetric: MetricKey;
  /** Whether the instant-centre construction overlay is shown. */
  showInstantCentre: boolean;
  /** True while a pivot is being dragged (drives a coarser, faster live solve). */
  dragging: boolean;

  setDesign: (d: Design, opts?: { persist?: boolean }) => void;
  updatePoint: (id: string, x: number, y: number) => void;
  setShockStroke: (stroke: number) => void;
  setMetricInputs: (patch: Partial<Design['metrics']>) => void;
  selectPoint: (id: string | null) => void;
  setSnap: (on: boolean) => void;
  setGridSize: (mm: number) => void;
  setPlaying: (p: boolean) => void;
  setAnimPos: (t: number) => void;
  setActiveMetric: (m: MetricKey) => void;
  setShowInstantCentre: (s: boolean) => void;
  setDragging: (d: boolean) => void;
}

export const useStore = create<AppState>((set, get) => ({
  design: defaultDesign(),
  selectedId: null,
  snap: false,
  gridSize: 5,
  playing: false,
  animPos: 0,
  activeMetric: 'leverage',
  showInstantCentre: true,
  dragging: false,

  setDesign: (d, opts = { persist: true }) => {
    set({ design: d });
    if (opts.persist !== false) saveLast(d);
  },

  updatePoint: (id, x, y) => {
    const d = cloneDesign(get().design);
    const p = d.points.find((pt) => pt.id === id);
    if (!p) return;
    p.x = x;
    p.y = y;
    set({ design: d });
    saveLast(d);
  },

  setShockStroke: (stroke) => {
    const d = cloneDesign(get().design);
    d.shock.stroke = Math.max(5, stroke);
    set({ design: d });
    saveLast(d);
  },

  setMetricInputs: (patch) => {
    const d = cloneDesign(get().design);
    const m = { ...d.metrics, ...patch, touched: true };
    // Floor everything at a small positive value: this stops an emptied field
    // (which arrives as 0) from producing a divide-by-zero in anti-squat or a
    // degenerate chain radius, without fighting normal typing toward real values.
    m.cogHeight = Math.max(1, m.cogHeight);
    m.wheelbase = Math.max(1, m.wheelbase);
    m.chainringTeeth = Math.max(1, m.chainringTeeth);
    m.cogTeeth = Math.max(1, m.cogTeeth);
    m.rearTyreRadius = Math.max(1, m.rearTyreRadius);
    m.frontTyreRadius = Math.max(1, m.frontTyreRadius);
    d.metrics = m;
    set({ design: d });
    saveLast(d);
  },

  selectPoint: (id) => set({ selectedId: id }),
  setSnap: (on) => set({ snap: on }),
  setGridSize: (mm) => set({ gridSize: Math.max(1, mm) }),
  setPlaying: (p) => set({ playing: p }),
  setAnimPos: (t) => set({ animPos: Math.min(1, Math.max(0, t)) }),
  setActiveMetric: (m) => set({ activeMetric: m }),
  setShowInstantCentre: (s) => set({ showInstantCentre: s }),
  setDragging: (dragging) => set({ dragging }),
}));
