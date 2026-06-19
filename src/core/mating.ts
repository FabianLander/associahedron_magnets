/**
 * mating.ts — which faces can be glued face-to-face on an IDENTICAL copy, and
 * the rigid transform that performs the join. Port of mating.py.
 *
 * Congruence is necessary but NOT sufficient: a flush joint needs the two faces
 * to meet with outward normals OPPOSED, i.e. one polygon must coincide with the
 * mirror image of the other. So a chiral face related to its partner only by a
 * rotation cannot mate (the mirror-shaped face does not exist on an identical
 * copy). We detect this numerically: reverse one face's vertex order (opposing
 * normals flip orientation), search cyclic correspondences with a proper Kabsch
 * fit, and accept a mate only when rmsd ≈ 0 AND the normals end up anti-parallel.
 */
import { dot } from './vec3.ts';
import type { Vec3 } from './vec3.ts';
import { kabsch, matVec, type Rigid } from './linalg.ts';
import type { Face } from './geometry.ts';

export interface Mate extends Rigid {
  nd: number; // normal·normal after the fit; a clean mate has nd ≈ −1
}

// np.roll(arr, s): result[i] = arr[(i − s) mod n]
const roll = <T>(arr: readonly T[], s: number): T[] => {
  const n = arr.length;
  return arr.map((_, i) => arr[((i - s) % n + n) % n]);
};

/**
 * Proper rigid motion laying `faceJ` flush onto `faceI` (centroids coincide,
 * normals opposed, outlines aligned). Returns the best correspondence, or null
 * if vertex counts differ.
 */
export function mateTransform(faceJ: Face, faceI: Face): Mate | null {
  const A0 = faceJ.pts.slice().reverse(); // reverse: opposing normals flip orientation
  const B = faceI.pts;
  if (A0.length !== B.length) return null;
  let best: Mate | null = null;
  for (let s = 0; s < B.length; s++) {
    const fit = kabsch(roll(A0, s), B);
    if (best === null || fit.rmsd < best.rmsd) {
      const nd = dot(matVec(fit.R, faceJ.normal) as Vec3, faceI.normal);
      best = { ...fit, nd };
    }
  }
  return best;
}

export type MateGraph = Map<number, number[]>;

/** For every face, the sorted list of faces it can be glued flush against. */
export function flushMateGraph(faces: Face[], rmsdTol = 1e-2): MateGraph {
  const byIdx = new Map(faces.map((f) => [f.idx, f]));
  const graph: MateGraph = new Map();
  for (const i of faces) {
    const mates: number[] = [];
    for (const j of faces) {
      const res = mateTransform(byIdx.get(j.idx)!, byIdx.get(i.idx)!);
      if (res && res.rmsd < rmsdTol && res.nd < -0.99) mates.push(j.idx);
    }
    graph.set(
      i.idx,
      mates.sort((a, b) => a - b),
    );
  }
  return graph;
}

export interface Connections {
  connections: [number, number][];
  unusable: number[];
}

/**
 * Turn the mate graph into connections + unusable faces:
 *   • empty mate list      → unusable
 *   • component of size 1   → self-connection (i, i)
 *   • congruent pair {a, b} → connection (a, b)
 *   • larger components chained pairwise
 * Port of derive_connections.
 */
export function deriveConnections(graph: MateGraph): Connections {
  const unusable = [...graph.entries()]
    .filter(([, m]) => m.length === 0)
    .map(([i]) => i)
    .sort((a, b) => a - b);

  const remaining = new Set([...graph.entries()].filter(([, m]) => m.length > 0).map(([i]) => i));
  const comps: number[][] = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number;
    const stack = [seed];
    const comp = new Set<number>();
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (comp.has(x)) continue;
      comp.add(x);
      for (const y of graph.get(x)!) if (remaining.has(y) && !comp.has(y)) stack.push(y);
    }
    for (const x of comp) remaining.delete(x);
    comps.push([...comp].sort((a, b) => a - b));
  }

  const connections: [number, number][] = [];
  for (const comp of comps) {
    if (comp.length === 1) connections.push([comp[0], comp[0]]);
    else if (comp.length === 2) connections.push([comp[0], comp[1]]);
    else for (let k = 0; k + 1 < comp.length; k += 2) connections.push([comp[k], comp[k + 1]]);
  }
  return { connections, unusable };
}
