/**
 * Recompute the sweep and metrics whenever the design changes. Kept out of the
 * Zustand store so it only runs when `design` actually changes identity (every
 * edit clones the design, so the memo key is the object reference).
 */

import { useMemo } from 'react';
import type { Design } from '../kinematics/model';
import { solveSweep, type SweepResult, DEFAULT_STEPS } from '../kinematics/sweep';
import { computeMetrics, type Metrics } from '../kinematics/metrics';

export interface Derived {
  sweep: SweepResult;
  metrics: Metrics | null;
}

export function useDerived(design: Design, steps = DEFAULT_STEPS): Derived {
  return useMemo(() => {
    const sweep = solveSweep(design, steps);
    const metrics =
      sweep.structurallyValid && sweep.validTo >= 1
        ? computeMetrics(sweep, design)
        : null;
    return { sweep, metrics };
  }, [design, steps]);
}

/** Map a 0..1 animation position to the nearest valid frame index. */
export function frameIndexFor(sweep: SweepResult, t: number): number {
  const last = sweep.validTo >= 0 ? sweep.validTo : sweep.frames.length - 1;
  return Math.round(t * last);
}
