/**
 * mesh.ts — coplanar-facet extraction, replacing trimesh's `mesh.facets`,
 * `facets_normal`, `facets_area`, and the boundary-loop walk.
 *
 * A "face" of the polyhedron is a maximal set of edge-adjacent coplanar
 * triangles. We:
 *   1. give each triangle a unit normal + area,
 *   2. union-find triangles that share an edge AND have parallel normals
 *      (edge-shared + parallel ⇒ coplanar, since they already share two points),
 *   3. per group, sum areas, take the area-weighted normal, and walk the
 *      boundary edges (those used by exactly one triangle) into one ordered loop.
 *
 * Facet INDEX order is discovery order and need not match trimesh's; the parity
 * test compares faces up to a relabelling, never by raw index (see test/).
 */
import type { Vec3 } from './vec3.ts';
import { sub, cross, len, normalize, add, scale, mean } from './vec3.ts';
import type { Mesh } from './obj.ts';

// edge-adjacent triangles whose unit normals satisfy dot > 1 − this are merged.
const COPLANAR_EPS = 1e-6;

export interface Facet {
  idx: number;
  loop: number[]; // ordered boundary vertex indices
  pts: Vec3[]; // boundary vertices (world coords), same order as loop
  normal: Vec3; // outward unit normal (area-weighted)
  area: number;
}

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

function triNormalArea(mesh: Mesh, tri: [number, number, number]): { n: Vec3; area: number } {
  const [i, j, k] = tri;
  const c = cross(sub(mesh.vertices[j], mesh.vertices[i]), sub(mesh.vertices[k], mesh.vertices[i]));
  const m = len(c);
  return { n: m === 0 ? [0, 0, 0] : (scale(c, 1 / m) as Vec3), area: 0.5 * m };
}

/** Walk the boundary edges of a coplanar facet into a single ordered vertex loop. */
function orderedBoundary(tris: [number, number, number][]): number[] {
  const directed: [number, number][] = [];
  for (const f of tris) {
    directed.push([f[0], f[1]], [f[1], f[2]], [f[2], f[0]]);
  }
  const count = new Map<string, number>();
  for (const [a, b] of directed) count.set(edgeKey(a, b), (count.get(edgeKey(a, b)) ?? 0) + 1);
  const boundary = directed.filter(([a, b]) => count.get(edgeKey(a, b)) === 1);

  const nxt = new Map<number, number>();
  for (const [a, b] of boundary) nxt.set(a, b);
  const start = boundary[0][0];
  const loop = [start];
  let cur = nxt.get(start)!;
  while (cur !== start) {
    loop.push(cur);
    cur = nxt.get(cur)!;
  }
  return loop;
}

export function extractFacets(mesh: Mesh): Facet[] {
  const tn = mesh.tris.map((t) => triNormalArea(mesh, t));

  // union-find over triangles
  const parent = mesh.tris.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  // map each undirected edge to the triangles that use it, then merge adjacent
  // triangles whose normals are parallel (⇒ coplanar)
  const edgeTris = new Map<string, number[]>();
  mesh.tris.forEach((t, ti) => {
    for (const [a, b] of [
      [t[0], t[1]],
      [t[1], t[2]],
      [t[2], t[0]],
    ] as const) {
      const key = edgeKey(a, b);
      (edgeTris.get(key) ?? edgeTris.set(key, []).get(key)!).push(ti);
    }
  });
  for (const tlist of edgeTris.values()) {
    for (let a = 0; a < tlist.length; a++)
      for (let b = a + 1; b < tlist.length; b++) {
        const d =
          tn[tlist[a]].n[0] * tn[tlist[b]].n[0] +
          tn[tlist[a]].n[1] * tn[tlist[b]].n[1] +
          tn[tlist[a]].n[2] * tn[tlist[b]].n[2];
        if (d > 1 - COPLANAR_EPS) union(tlist[a], tlist[b]);
      }
  }

  // gather triangles per facet root, in discovery order
  const groups = new Map<number, number[]>();
  mesh.tris.forEach((_, ti) => {
    const r = find(ti);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(ti);
  });

  const facets: Facet[] = [];
  let idx = 0;
  for (const triIdxs of groups.values()) {
    const tris = triIdxs.map((ti) => mesh.tris[ti]);
    const loop = orderedBoundary(tris);
    const pts = loop.map((vi) => mesh.vertices[vi]);
    let area = 0;
    let nAcc: Vec3 = [0, 0, 0];
    for (const ti of triIdxs) {
      area += tn[ti].area;
      nAcc = add(nAcc, scale(tn[ti].n, tn[ti].area)); // area-weighted
    }
    facets.push({ idx: idx++, loop, pts, normal: normalize(nAcc), area });
  }
  return facets;
}

/** Centroid (mean of boundary vertices) — matches the Python `pts.mean(axis=0)`. */
export const facetCentroid = (f: Facet): Vec3 => mean(f.pts);
