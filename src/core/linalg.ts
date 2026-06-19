/**
 * linalg.ts — the two pieces of "real" linear algebra the pipeline needs, both
 * on 3×3 matrices, delegated to ml-matrix so we don't hand-roll an SVD:
 *
 *   • kabsch        — best PROPER rigid motion (rotation det +1, translation)
 *                     mapping ordered point set A onto B. Port of mating.kabsch,
 *                     which used numpy's `svd` + `det`.
 *   • principalAxis — the in-plane longest axis of a face, from the eigenvector
 *                     of the largest eigenvalue of a symmetric 3×3 scatter
 *                     matrix. Port of the `np.linalg.eigh` call in face_frame.
 *
 * A Mat3 is a row-major number[3][3]. We keep our own tiny 3×3 helpers (matmul,
 * transpose, det, matVec) rather than routing every multiply through ml-matrix:
 * the inputs are fixed 3×3, so this is clearer and allocation-light, and it
 * matches the Python which did these by hand around the numpy SVD.
 */
import { Matrix, SingularValueDecomposition, EigenvalueDecomposition } from 'ml-matrix';
import type { Vec3 } from './vec3.ts';
import { sub, add, dist } from './vec3.ts';

export type Mat3 = [Vec3, Vec3, Vec3];

export const matVec = (M: Mat3, v: Vec3): Vec3 => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];

const transpose = (M: Mat3): Mat3 => [
  [M[0][0], M[1][0], M[2][0]],
  [M[0][1], M[1][1], M[2][1]],
  [M[0][2], M[1][2], M[2][2]],
];

const matmul = (A: Mat3, B: Mat3): Mat3 => {
  const C: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
  return C;
};

// det of a 3×3 given as rows.
const det3 = (M: Mat3): number =>
  M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
  M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
  M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

const to2D = (m: Matrix): Mat3 => m.to2DArray() as unknown as Mat3;

export interface Rigid {
  R: Mat3;
  t: Vec3;
  rmsd: number;
}

/**
 * Best PROPER rigid motion (R det +1, t) mapping ordered A onto B. RMSD is the
 * root-mean-square per-point residual after the fit. Mirrors mating.kabsch:
 *
 *   H = Σ (a_k − ā)(b_k − b̄)ᵀ          (3×3 cross-covariance)
 *   U S Vᵀ = svd(H)
 *   d = sign(det(V Uᵀ))                  (reflection guard → proper rotation)
 *   R = V diag(1,1,d) Uᵀ,  t = b̄ − R ā
 *
 * numpy's `svd(H)` returns (U, S, Vt) with H = U·diag(S)·Vt, so numpy's `Vt.T`
 * is ml-matrix's right singular vectors V; we use V and U directly.
 */
export function kabsch(A: readonly Vec3[], B: readonly Vec3[]): Rigid {
  const n = A.length;
  const ca = mean3(A);
  const cb = mean3(B);
  const H: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < n; k++) {
    const a = sub(A[k], ca);
    const b = sub(B[k], cb);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) H[i][j] += a[i] * b[j];
  }
  const svd = new SingularValueDecomposition(new Matrix(H), { autoTranspose: false });
  const U = to2D(svd.leftSingularVectors);
  const V = to2D(svd.rightSingularVectors);
  const d = Math.sign(det3(matmul(V, transpose(U)))) || 1;
  const D: Mat3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, d],
  ];
  const R = matmul(matmul(V, D), transpose(U));
  const t = sub(cb, matVec(R, ca));
  let s = 0;
  for (let k = 0; k < n; k++) {
    const p = add(matVec(R, A[k]), t);
    const dd = dist(p, B[k]);
    s += dd * dd;
  }
  return { R, t, rmsd: Math.sqrt(s / n) };
}

/**
 * Principal (largest-eigenvalue) eigenvector of a symmetric 3×3 matrix S.
 * Port of `w, V = np.linalg.eigh(QᵀQ); u = V[:, argmax(w)]`.
 *
 * Sign is arbitrary (eigenvectors are defined up to ±1); callers that care
 * (dual-magnet placement) re-derive the partner slot symmetrically, so the sign
 * choice cancels.
 */
export function principalAxis(S: Mat3): Vec3 {
  const evd = new EigenvalueDecomposition(new Matrix(S), { assumeSymmetric: true });
  const w = evd.realEigenvalues;
  const Vmat = evd.eigenvectorMatrix; // columns are eigenvectors
  let best = 0;
  for (let i = 1; i < w.length; i++) if (w[i] > w[best]) best = i;
  return [Vmat.get(0, best), Vmat.get(1, best), Vmat.get(2, best)];
}

const mean3 = (pts: readonly Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const n = pts.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
};
