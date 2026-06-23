/**
 * Drive the mechanism through its full travel and record the solved geometry at
 * each step. Everything the UI plots is derived from this sweep.
 *
 * The driver is the shock length, swept from full extension (`eyeToEye`) down to
 * full compression (`eyeToEye - stroke`). Each step is seeded from the previous
 * step's converged solution (continuation), which keeps the linkage on the
 * correct assembly branch.
 *
 * Steps that fail to converge (a binding or over-centre linkage) are flagged
 * rather than emitting garbage — an invalid linkage is a normal thing for a
 * user to draw while playing.
 */

import type { Design } from './model';
import {
  buildSystem,
  homeSeed,
  solveStep,
  type KinematicSystem,
  type XY,
} from './solver';

export interface SweepFrame {
  /** Prescribed shock length at this step, mm. */
  shockLength: number;
  /** Shock travel consumed from full extension, mm (0 … stroke). */
  shockTravel: number;
  /** Solved positions of every point, keyed by id. */
  positions: Record<string, XY>;
  converged: boolean;
}

export interface SweepResult {
  system: KinematicSystem;
  frames: SweepFrame[];
  /** True if the mechanism is a well-formed, fully-driven 1-DOF system. */
  structurallyValid: boolean;
  /** Human-readable reason when structurallyValid is false. */
  structuralMessage?: string;
  /** True if every step across the requested travel converged. */
  fullyConverged: boolean;
  /** Indices of the contiguous converged span starting from full extension. */
  validFrom: number;
  validTo: number;
}

export const DEFAULT_STEPS = 150;

export function solveSweep(design: Design, steps = DEFAULT_STEPS): SweepResult {
  const system = buildSystem(design);

  if (system.mobility !== 0) {
    const word = system.mobility > 0 ? 'under-constrained' : 'over-constrained';
    return {
      system,
      frames: [],
      structurallyValid: false,
      structuralMessage: `Linkage is ${word} (mobility ${system.mobility}). A valid mechanism needs exactly one degree of freedom.`,
      fullyConverged: false,
      validFrom: 0,
      validTo: -1,
    };
  }

  const { eyeToEye, stroke } = design.shock;
  const frames: SweepFrame[] = [];
  let seed = homeSeed(system);

  let fullyConverged = true;
  let validTo = -1;
  let stillContiguous = true;

  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const shockLength = eyeToEye - t * stroke;
    const sol = solveStep(system, shockLength, seed);

    frames.push({
      shockLength,
      shockTravel: eyeToEye - shockLength,
      positions: sol.positions,
      converged: sol.converged,
    });

    if (sol.converged) {
      // Only advance the continuation seed from a good solution, so a single
      // bad step does not poison the rest of the sweep.
      seed = system.freeIds.flatMap((id) => [
        sol.positions[id].x,
        sol.positions[id].y,
      ]);
      if (stillContiguous) validTo = i;
    } else {
      fullyConverged = false;
      stillContiguous = false;
    }
  }

  return {
    system,
    frames,
    structurallyValid: true,
    fullyConverged,
    validFrom: 0,
    validTo,
  };
}
