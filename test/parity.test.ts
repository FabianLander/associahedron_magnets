/**
 * parity.test.ts — proves the JS geometry core reproduces the committed Python
 * outputs (data/*.json) at default parameters, WITHOUT assuming the two number
 * faces the same way. trimesh's facet indexing and our coplanar-grouping order
 * need not agree, so every check below is invariant under a relabelling of
 * faces: we compare congruence-class signatures, connection structure, the SET
 * of magnet centres, and the MULTISET of edge clearances — never raw indices.
 *
 * Signature of a face = (#sides, area to 0.1 mm, sorted edge lengths to 0.1 mm).
 * Congruent faces share a signature; it pins a face down up to congruence, which
 * is all the relabelling-free claims need.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { runCore, DEFAULT_PARAMS } from '@core/pipeline.ts';
import type { Vec3 } from '@core/vec3.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const readJson = (rel: string) => JSON.parse(readFileSync(here(rel), 'utf8'));

const objText = readFileSync(here('../input/A31_affine_associahedron.obj'), 'utf8');
const congruence = readJson('../data/congruence.json');
const mateGraph = readJson('../data/mate_graph.json');
const magnetDesign = readJson('../data/magnet_design.json');

const res = runCore(objText, DEFAULT_PARAMS);

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const sig = (n: number, area: number, edges: number[]) =>
  `${n}|${round(area, 1)}|${[...edges].map((e) => round(e, 1)).sort((a, b) => a - b).join(',')}`;
const sorted = (a: string[]) => [...a].sort();

// Python face signatures, keyed by Python face index.
const pySig = new Map<number, string>(
  congruence.faces.map((f: any) => [f.idx, sig(f.sides, f.area, f.edge_lengths)]),
);
// JS face signatures, keyed by JS face index.
const jsSig = new Map<number, string>(
  res.faces.map((f) => [f.idx, sig(f.n, f.area, f.edgeLengths)]),
);

/** every point in A has a match in B within tol, and the counts agree */
function setMatches(A: Vec3[], B: Vec3[], tol: number): boolean {
  if (A.length !== B.length) return false;
  const used = new Array(B.length).fill(false);
  for (const a of A) {
    let hit = -1;
    for (let k = 0; k < B.length; k++) {
      if (used[k]) continue;
      if (Math.hypot(a[0] - B[k][0], a[1] - B[k][1], a[2] - B[k][2]) <= tol) {
        hit = k;
        break;
      }
    }
    if (hit < 0) return false;
    used[hit] = true;
  }
  return true;
}

describe('parity with committed Python pipeline (relabelling-invariant)', () => {
  it('reproduces face count and bounding box', () => {
    expect(res.faces.length).toBe(congruence.n_faces);
    for (let i = 0; i < 3; i++) expect(res.bbox[i]).toBeCloseTo(congruence.bbox[i], 2);
  });

  it('reproduces the per-face congruence signatures (as a multiset)', () => {
    expect(sorted([...jsSig.values()])).toEqual(sorted([...pySig.values()]));
  });

  it('reproduces the congruence-group sizes', () => {
    const py = congruence.congruence_groups.map((g: number[]) => g.length).sort();
    const js = res.congruenceGroups.map((g) => g.length).sort();
    expect(js).toEqual(py);
  });

  it('reproduces the unusable (chiral, no-mate) faces up to congruence', () => {
    expect(res.unusable.length).toBe(mateGraph.unusable_faces.length);
    const pyU = sorted(mateGraph.unusable_faces.map((i: number) => pySig.get(i)!));
    const jsU = sorted(res.unusable.map((i) => jsSig.get(i)!));
    expect(jsU).toEqual(pyU);
  });

  it('reproduces the connection structure (self-mates + pairs) up to congruence', () => {
    const pySelf = (mateGraph.connections as [number, number][]).filter(([a, b]) => a === b);
    const jsSelf = res.connections.filter(([a, b]) => a === b);
    expect(jsSelf.length).toBe(pySelf.length);
    expect(sorted(jsSelf.map(([a]) => jsSig.get(a)!))).toEqual(
      sorted(pySelf.map(([a]) => pySig.get(a)!)),
    );

    const pyPair = (mateGraph.connections as [number, number][]).filter(([a, b]) => a !== b);
    const jsPair = res.connections.filter(([a, b]) => a !== b);
    expect(jsPair.length).toBe(pyPair.length);
    expect(sorted(jsPair.map(([a]) => jsSig.get(a)!))).toEqual(
      sorted(pyPair.map(([a]) => pySig.get(a)!)),
    );
  });

  it('reproduces the magnet centres (as a set, within 0.01 mm)', () => {
    const py = magnetDesign.magnets.map((m: any) => m.centre as Vec3);
    const js = [...res.design.values()].flat().map((m) => m.pos);
    expect(js.length).toBe(py.length);
    expect(setMatches(js, py, 1e-2)).toBe(true);
  });

  it('reproduces the edge clearances (as a multiset, within 0.01 mm)', () => {
    const py = Object.values<number>(magnetDesign.edge_clearance).sort((a, b) => a - b);
    const js = [...res.fit.clearance.values()].sort((a, b) => a - b);
    expect(js.length).toBe(py.length);
    js.forEach((v, i) => expect(v).toBeCloseTo(py[i], 2));
  });

  it('all connections verify and all pockets fit', () => {
    expect(res.verify.allOk).toBe(true);
    expect(res.fit.allFit).toBe(true);
  });
});
