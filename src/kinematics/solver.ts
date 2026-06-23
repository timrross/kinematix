/**
 * The constraint solver.
 *
 * The mechanism is a set of points joined by rigid links plus one shock. We
 * drive the mechanism by *prescribing the shock length* and solving the
 * loop-closure constraints F(q) = 0 for the free point positions with
 * Newton–Raphson:
 *
 *     q <- q - J(q)^-1 F(q)
 *
 * Each rigid link contributes one constraint — the squared distance between its
 * endpoints equals its (constant) rest length squared. The shock contributes
 * the same kind of constraint, but its target length is the swept driver. For a
 * one-degree-of-freedom mechanism the number of constraints equals the number
 * of unknowns (2 per free point), so the Jacobian is square and we can do a
 * dense linear solve each iteration.
 *
 * The Jacobian is assembled analytically (the derivatives of a squared distance
 * are trivial), which is faster and more accurate than finite differences.
 *
 * Continuation: each step of a sweep is seeded with the previous step's
 * solution, which keeps the mechanism on the correct assembly branch and stops
 * it flipping over-centre mid-travel.
 */

import { solveLinear, norm } from './linalg';
import type { Design, Point } from './model';

export interface XY {
  x: number;
  y: number;
}

/** Pre-compiled mechanism: stable ordering, rest lengths, index maps. */
export interface KinematicSystem {
  design: Design;
  /** Ids of free (solved-for) points, in solve order. */
  freeIds: string[];
  /** point id -> index into the free list (or undefined if fixed). */
  freeIndex: Map<string, number>;
  /** Fixed point coordinates, constant during a solve. */
  fixed: Map<string, XY>;
  /** Link constraints as endpoint id pairs with constant rest length. */
  links: { a: string; b: string; restLen: number }[];
  shock: { frame: string; link: string };
  /** Installed (home) shock length = full extension. */
  homeShockLength: number;
  /**
   * Mechanism mobility: 2*freePoints - (links + 1 shock). Zero means a properly
   * driven 1-DOF mechanism. Non-zero means the drawing is structurally
   * over/under-constrained and cannot be solved as a square system.
   */
  mobility: number;
}

export interface StepSolution {
  converged: boolean;
  iterations: number;
  residualNorm: number;
  /** All point positions (fixed + solved free), keyed by id. */
  positions: Record<string, XY>;
}

export function buildSystem(design: Design): KinematicSystem {
  const freeIds: string[] = [];
  const freeIndex = new Map<string, number>();
  const fixed = new Map<string, XY>();

  for (const p of design.points) {
    if (p.fixed) {
      fixed.set(p.id, { x: p.x, y: p.y });
    } else {
      freeIndex.set(p.id, freeIds.length);
      freeIds.push(p.id);
    }
  }

  const pointById = new Map<string, Point>(design.points.map((p) => [p.id, p]));
  const links = design.links.map((l) => {
    const a = pointById.get(l.a);
    const b = pointById.get(l.b);
    if (!a || !b) throw new Error(`Link ${l.id} references a missing point`);
    return { a: l.a, b: l.b, restLen: Math.hypot(a.x - b.x, a.y - b.y) };
  });

  const mobility = 2 * freeIds.length - (links.length + 1);

  return {
    design,
    freeIds,
    freeIndex,
    fixed,
    links,
    shock: { frame: design.shock.frame, link: design.shock.link },
    homeShockLength: design.shock.eyeToEye,
    mobility,
  };
}

/** Read a point's coordinates from either the unknown vector or the fixed map. */
function coord(
  sys: KinematicSystem,
  q: number[],
  id: string,
): XY {
  const idx = sys.freeIndex.get(id);
  if (idx === undefined) {
    return sys.fixed.get(id)!;
  }
  return { x: q[2 * idx], y: q[2 * idx + 1] };
}

const MAX_ITERS = 60;

/**
 * Solve for the free-point positions given a prescribed shock length, seeded
 * from `seed` (the previous step's solution, for continuation).
 */
export function solveStep(
  sys: KinematicSystem,
  shockLength: number,
  seed: number[],
): StepSolution {
  const n = sys.freeIds.length * 2;
  const q = seed.slice();

  // Tolerance is scaled to the geometry: residuals are in mm², so we compare
  // against a small fraction of the home shock length squared.
  const scale = Math.max(1, sys.homeShockLength * sys.homeShockLength);
  const tol = 1e-10 * scale;

  // Constraints: one per link plus the shock. For a 1-DOF mechanism this equals
  // the number of unknowns.
  const constraints: { a: string; b: string; targetLen: number }[] = [
    ...sys.links.map((l) => ({ a: l.a, b: l.b, targetLen: l.restLen })),
    { a: sys.shock.frame, b: sys.shock.link, targetLen: shockLength },
  ];

  let residualNorm = Infinity;
  let iter = 0;

  // Residual vector and Jacobian, allocated once and reused each iteration.
  const F: number[] = new Array(constraints.length).fill(0);
  const J: number[][] = Array.from({ length: constraints.length }, () => new Array(n).fill(0));

  for (; iter < MAX_ITERS; iter++) {
    for (let k = 0; k < constraints.length; k++) {
      const c = constraints[k];
      const pa = coord(sys, q, c.a);
      const pb = coord(sys, q, c.b);
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      F[k] = dx * dx + dy * dy - c.targetLen * c.targetLen;

      // Jacobian row k: zero it, then set the (up to four) non-zero columns for
      // this constraint's free endpoints. d(dx²+dy²)/d(coords).
      const row = J[k];
      row.fill(0);
      const ia = sys.freeIndex.get(c.a);
      if (ia !== undefined) {
        row[2 * ia] = 2 * dx;
        row[2 * ia + 1] = 2 * dy;
      }
      const ib = sys.freeIndex.get(c.b);
      if (ib !== undefined) {
        row[2 * ib] = -2 * dx;
        row[2 * ib + 1] = -2 * dy;
      }
    }

    residualNorm = norm(F);
    if (residualNorm < tol) break;
    // Fast bail-out: a diverging / NaN iterate means the mechanism has been
    // driven past a binding or over-centre point. No sense iterating to the cap.
    if (!Number.isFinite(residualNorm) || residualNorm > 1e7 * scale) {
      return {
        converged: false,
        iterations: iter,
        residualNorm,
        positions: positionsFrom(sys, q),
      };
    }

    // Solve J · dq = F, then q <- q - dq. (Square system when mobility == 0.)
    if (J.length !== n) {
      // Not a square system — cannot Newton-solve. Bail as non-converged.
      return {
        converged: false,
        iterations: iter,
        residualNorm,
        positions: positionsFrom(sys, q),
      };
    }
    const dq = solveLinear(J, F);
    if (!dq) {
      // Singular Jacobian — the mechanism is at a binding/branch point.
      return {
        converged: false,
        iterations: iter,
        residualNorm,
        positions: positionsFrom(sys, q),
      };
    }
    for (let i = 0; i < n; i++) q[i] -= dq[i];
  }

  const converged = residualNorm < tol;
  return {
    converged,
    iterations: iter,
    residualNorm,
    positions: positionsFrom(sys, q),
  };
}

function positionsFrom(sys: KinematicSystem, q: number[]): Record<string, XY> {
  const out: Record<string, XY> = {};
  for (const [id, xy] of sys.fixed) out[id] = { x: xy.x, y: xy.y };
  for (let i = 0; i < sys.freeIds.length; i++) {
    out[sys.freeIds[i]] = { x: q[2 * i], y: q[2 * i + 1] };
  }
  return out;
}

/** Build the initial unknown vector from the design's home positions. */
export function homeSeed(sys: KinematicSystem): number[] {
  const pointById = new Map(sys.design.points.map((p) => [p.id, p]));
  const seed: number[] = [];
  for (const id of sys.freeIds) {
    const p = pointById.get(id)!;
    seed.push(p.x, p.y);
  }
  return seed;
}
