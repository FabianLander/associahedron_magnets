/**
 * pipeline.ts — the whole geometry pipeline as one pure function of (mesh text,
 * parameters), the JS equivalent of run_all.main minus file I/O, drilling, and
 * figures. The browser app calls this on every slider change; the parity test
 * calls it once at default parameters and checks the result against the
 * committed Python outputs.
 *
 * Lengths are millimetres after `scaleToMm`. Pocket diameter/depth are derived
 * exactly as run_all does: dia = magnet + clearance, depth = thickness + extra.
 */
import { parseObj, scaleToMm, orientOutward, bboxExtents, type Mesh } from './obj.ts';
import { extractFaces, congruenceGroups, type Face } from './geometry.ts';
import { flushMateGraph, deriveConnections, type MateGraph } from './mating.ts';
import {
  placeMagnets,
  verify,
  fitCheck,
  type Design,
  type Mode,
  type PairAxis,
  type VerifyResult,
  type FitResult,
} from './magnets.ts';
import type { Vec3 } from './vec3.ts';

export interface Params {
  targetLongestMm: number;
  magnetDiaMm: number;
  magnetClearMm: number;
  magnetThickMm: number;
  depthExtraMm: number;
  offsetMm: number;
  mode: Mode;
  // dual-mode N/S pair layout: 'u' side by side (default), 'v' stacked, 'both'.
  // pairOverrides sets it per connection (keyed by owner face). Both optional so
  // DEFAULT_PARAMS stays a verbatim copy of the Python parity config.
  pairAxis?: PairAxis;
  pairOverrides?: Map<number, PairAxis>;
}

/** Defaults copied verbatim from run_all.py's CONFIG block. */
export const DEFAULT_PARAMS: Params = {
  targetLongestMm: 60.0,
  magnetDiaMm: 5.0,
  magnetClearMm: 0.15,
  magnetThickMm: 2.0,
  depthExtraMm: 0.2,
  offsetMm: 4.5,
  mode: 'single_centered',
};

export interface CoreResult {
  scaleMmPerUnit: number;
  bbox: Vec3;
  pocketDiameterMm: number;
  pocketDepthMm: number;
  mesh: Mesh; // scaled + outward-oriented solid, the input to drilling
  faces: Face[];
  byIdx: Map<number, Face>;
  congruenceGroups: number[][];
  mateGraph: MateGraph;
  connections: [number, number][];
  unusable: number[];
  design: Design;
  verify: VerifyResult;
  fit: FitResult;
}

export function runCore(objText: string, params: Params = DEFAULT_PARAMS): CoreResult {
  const pocketDiameterMm = params.magnetDiaMm + params.magnetClearMm;
  const pocketDepthMm = params.magnetThickMm + params.depthExtraMm;

  const mesh = parseObj(objText);
  const scaleMmPerUnit = scaleToMm(mesh, params.targetLongestMm);
  orientOutward(mesh);
  const faces = extractFaces(mesh);
  const byIdx = new Map(faces.map((f) => [f.idx, f]));
  const groups = congruenceGroups(faces);

  const mateGraph = flushMateGraph(faces);
  const { connections, unusable } = deriveConnections(mateGraph);

  const design = placeMagnets(byIdx, connections, params.offsetMm, params.mode, params.pairAxis ?? 'u', params.pairOverrides);
  const v = verify(design, byIdx, connections, params.mode);
  const fit = fitCheck(design, byIdx, pocketDiameterMm / 2);

  return {
    scaleMmPerUnit,
    bbox: bboxExtents(mesh),
    pocketDiameterMm,
    pocketDepthMm,
    mesh,
    faces,
    byIdx,
    congruenceGroups: groups,
    mateGraph,
    connections,
    unusable,
    design,
    verify: v,
    fit,
  };
}
