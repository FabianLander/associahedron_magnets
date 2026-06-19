/**
 * geometry.ts — turn coplanar facets into faces carrying a CONGRUENCE
 * FINGERPRINT, and bucket faces by congruence.
 *
 * The fingerprint is the sorted multiset of ALL pairwise vertex distances of
 * the boundary polygon (rounded). Two polygons are congruent iff these
 * multisets match — a complete invariant for a point set up to isometry,
 * including reflection, strictly stronger than comparing areas or edge lengths.
 * Direct port of geometry.extract_faces / congruence_groups.
 */
import type { Vec3 } from './vec3.ts';
import { dist } from './vec3.ts';
import type { Mesh } from './obj.ts';
import { extractFacets, facetCentroid } from './mesh.ts';

export interface Face {
  idx: number;
  loop: number[];
  pts: Vec3[];
  n: number; // number of sides
  area: number;
  normal: Vec3;
  centroid: Vec3;
  edgeLengths: number[]; // around the loop, rounded
  fingerprint: number[]; // sorted pairwise distances, rounded (congruence invariant)
}

const round = (x: number, ndigits: number): number => {
  const f = 10 ** ndigits;
  return Math.round(x * f) / f;
};

export function extractFaces(mesh: Mesh, ndigits = 3): Face[] {
  return extractFacets(mesh).map((f) => {
    const pts = f.pts;
    const n = pts.length;
    const edgeLengths = pts.map((p, i) => round(dist(p, pts[(i + 1) % n]), ndigits));
    const pairwise: number[] = [];
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) pairwise.push(round(dist(pts[a], pts[b]), ndigits));
    pairwise.sort((x, y) => x - y);
    return {
      idx: f.idx,
      loop: f.loop,
      pts,
      n,
      area: f.area,
      normal: f.normal,
      centroid: facetCentroid(f),
      edgeLengths,
      fingerprint: pairwise,
    };
  });
}

/**
 * Group face indices by congruence fingerprint, sorted largest-group-first
 * (ties broken by smallest member index), matching congruence_groups.
 */
export function congruenceGroups(faces: Face[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const f of faces) {
    const key = f.fingerprint.join(',');
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f.idx);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
}
