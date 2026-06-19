/**
 * Vec3 — a point/vector in ℝ³ as a plain 3-tuple `[x, y, z]`. The one extrinsic
 * 3D coordinate type at the bottom of the core stack; everything above
 * (mesh facets, mating transforms, magnet placement) shares it.
 *
 * Ported from the numpy-based Python pipeline: where the Python leaned on
 * `np.linalg.norm`, broadcasting, and `np.mean(axis=0)`, we spell those out as
 * tuple ops here so the geometry stays allocation-explicit and dependency-free
 * (linear algebra heavier than this — SVD, eigendecomposition — goes through
 * ml-matrix in `linalg.ts`).
 */
export type Vec3 = [number, number, number];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Unit vector in a's direction; a zero vector returns itself (length floored to 1). */
export const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Centroid of a point set = the mean used for the Python `pts.mean(axis=0)`. */
export const mean = (pts: readonly Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of pts) {
    c[0] += p[0];
    c[1] += p[1];
    c[2] += p[2];
  }
  const n = pts.length || 1;
  return [c[0] / n, c[1] / n, c[2] / n];
};
