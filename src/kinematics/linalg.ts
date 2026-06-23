/**
 * Tiny dense linear algebra helpers for the constraint solver.
 *
 * The mechanisms we solve have only a handful of unknowns (typically 4–8), so a
 * plain Gaussian-elimination solve with partial pivoting is more than fast
 * enough and keeps the dependency footprint at zero. No React, no libraries.
 */

export type Vec = number[];
export type Mat = number[][]; // row-major, square

/**
 * Solve the dense linear system `A x = b` for `x` using Gaussian elimination
 * with partial pivoting. `A` is modified in place (a copy is taken internally),
 * `b` is not mutated.
 *
 * Returns `null` if the matrix is singular (or numerically close to it), which
 * the caller treats as a failed Newton step.
 */
export function solveLinear(A: Mat, b: Vec): Vec | null {
  const n = b.length;
  // Work on copies so callers can reuse their buffers.
  const m: Mat = A.map((row) => row.slice());
  const x = b.slice();

  for (let col = 0; col < n; col++) {
    // Partial pivot: find the row with the largest magnitude in this column.
    let pivotRow = col;
    let pivotMag = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const mag = Math.abs(m[r][col]);
      if (mag > pivotMag) {
        pivotMag = mag;
        pivotRow = r;
      }
    }
    if (pivotMag < 1e-12) {
      return null; // singular / under-determined
    }
    if (pivotRow !== col) {
      [m[col], m[pivotRow]] = [m[pivotRow], m[col]];
      [x[col], x[pivotRow]] = [x[pivotRow], x[col]];
    }

    // Eliminate below.
    const pivot = m[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = m[r][col] / pivot;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) {
        m[r][c] -= factor * m[col][c];
      }
      x[r] -= factor * x[col];
    }
  }

  // Back-substitution.
  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row];
    for (let c = row + 1; c < n; c++) {
      sum -= m[row][c] * x[c];
    }
    x[row] = sum / m[row][row];
  }

  return x;
}

/** Euclidean norm of a vector. */
export function norm(v: Vec): number {
  let s = 0;
  for (const value of v) s += value * value;
  return Math.sqrt(s);
}
