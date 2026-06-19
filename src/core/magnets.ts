/**
 * magnets.ts — place the magnet pocket(s) on every usable face, then verify the
 * placement holds when two copies are brought together. Port of magnets.py.
 *
 * Two modes:
 *   • single_centered — one pocket at the face centre; you pick polarity at
 *     assembly (mating makes the two centres coincide, so the magnets always
 *     meet). Fewest magnets; pole = null in the design.
 *   • dual_genderless — two pockets (N-out + S-out); the partner face's pockets
 *     are the mate-transform images with poles swapped, so any matching face has
 *     every N meeting an S. Copies are interchangeable; twice the magnets.
 *
 * Faces with no flush mate (the chiral pentagons) get no pocket — geometry, not
 * a mode choice.
 */
import type { Vec3 } from './vec3.ts';
import { sub, add, scale, dot, cross, normalize, dist, mean } from './vec3.ts';
import { principalAxis, matVec, type Mat3 } from './linalg.ts';
import type { Face } from './geometry.ts';
import { mateTransform } from './mating.ts';

export type Pole = 'N' | 'S' | null;
export interface Magnet {
  face: number;
  pos: Vec3; // world-space centre of the pocket opening (on the face)
  pole: Pole;
}
export type Design = Map<number, Magnet[]>;
export type Mode = 'single_centered' | 'dual_genderless';

const OPPOSITE: Record<'N' | 'S', 'N' | 'S'> = { N: 'S', S: 'N' };

/** In-plane orthonormal frame (centroid, normal, u, v) with u the longest axis. */
export function faceFrame(face: Face): { c: Vec3; nrm: Vec3; u: Vec3; v: Vec3 } {
  const c = mean(face.pts);
  const nrm = face.normal;
  // project each centred point into the face plane, accumulate scatter QᵀQ
  const S: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of face.pts) {
    const d0 = sub(p, c);
    const q = sub(d0, scale(nrm, dot(d0, nrm))); // strip normal component
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += q[i] * q[j];
  }
  let u = principalAxis(S);
  u = normalize(sub(u, scale(nrm, dot(u, nrm))));
  const v = cross(nrm, u);
  return { c, nrm, u, v };
}

function pairOn(face: Face, offset: number, along: 'u' | 'v'): Magnet[] {
  const { c, u, v } = faceFrame(face);
  const d = along === 'u' ? u : v;
  return [
    { face: face.idx, pos: add(c, scale(d, offset)), pole: 'N' },
    { face: face.idx, pos: sub(c, scale(d, offset)), pole: 'S' },
  ];
}

export function placeMagnets(
  byIdx: Map<number, Face>,
  connections: [number, number][],
  offset: number,
  mode: Mode = 'single_centered',
): Design {
  const design: Design = new Map();

  if (mode === 'single_centered') {
    for (const [i, j] of connections)
      for (const f of new Set([i, j]))
        design.set(f, [{ face: f, pos: [...byIdx.get(f)!.centroid] as Vec3, pole: null }]);
    return design;
  }

  // dual_genderless
  for (const [i, j] of connections) {
    if (i === j) {
      // self-mating face: pick the axis (u or v) whose N/S pair maps to the
      // opposite pole under the face's own mate transform
      let chosen: Magnet[] | null = null;
      for (const along of ['u', 'v'] as const) {
        const mags = pairOn(byIdx.get(i)!, offset, along);
        const mate = mateTransform(byIdx.get(i)!, byIdx.get(i)!)!;
        let good = true;
        for (const m of mags) {
          const landed = add(matVec(mate.R, m.pos) as Vec3, mate.t);
          let partner = mags[0];
          for (const x of mags) if (dist(x.pos, landed) < dist(partner.pos, landed)) partner = x;
          if (dist(partner.pos, landed) > 1e-6 || partner.pole === m.pole) good = false;
        }
        if (good) {
          chosen = mags;
          break;
        }
      }
      design.set(i, chosen ?? pairOn(byIdx.get(i)!, offset, 'u'));
    } else {
      const magsI = pairOn(byIdx.get(i)!, offset, 'u');
      const mate = mateTransform(byIdx.get(j)!, byIdx.get(i)!)!;
      // Rᵀ = R⁻¹ for the rotation; map i's slots back to j with poles swapped
      const Rt: Mat3 = [
        [mate.R[0][0], mate.R[1][0], mate.R[2][0]],
        [mate.R[0][1], mate.R[1][1], mate.R[2][1]],
        [mate.R[0][2], mate.R[1][2], mate.R[2][2]],
      ];
      design.set(i, magsI);
      design.set(
        j,
        magsI.map((m) => ({
          face: j,
          pos: matVec(Rt, sub(m.pos, mate.t)) as Vec3,
          pole: OPPOSITE[m.pole as 'N' | 'S'],
        })),
      );
    }
  }
  return design;
}

export interface VerifyResult {
  allOk: boolean;
  report: { connection: [number, number]; ok: boolean }[];
}

/** Simulate every connection by laying copy-2's face onto copy-1's face. */
export function verify(
  design: Design,
  byIdx: Map<number, Face>,
  connections: [number, number][],
  mode: Mode = 'single_centered',
  tol = 1e-6,
): VerifyResult {
  const report: { connection: [number, number]; ok: boolean }[] = [];
  let allOk = true;
  for (const [i, j] of connections) {
    const mate = mateTransform(byIdx.get(j)!, byIdx.get(i)!)!;
    let ok = true;
    if (mode === 'single_centered') {
      const landed = add(matVec(mate.R, design.get(j)![0].pos) as Vec3, mate.t);
      if (dist(landed, design.get(i)![0].pos) > tol) ok = false;
    } else {
      for (const m of design.get(i)!) {
        let best = { d: Infinity, pole: null as Pole };
        for (const p of design.get(j)!) {
          const d = dist(add(matVec(mate.R, p.pos) as Vec3, mate.t), m.pos);
          if (d < best.d) best = { d, pole: p.pole };
        }
        if (best.d > tol || best.pole === m.pole) ok = false;
      }
    }
    report.push({ connection: [i, j], ok });
    allOk &&= ok;
  }
  return { allOk, report };
}

export interface FitResult {
  allFit: boolean;
  clearance: Map<number, number>; // face → min centre-to-edge distance
}

/** Clearance from each pocket centre to its face boundary; fits if ≥ radius + margin. */
export function fitCheck(
  design: Design,
  byIdx: Map<number, Face>,
  radius: number,
  margin = 0.3,
): FitResult {
  const ptSeg = (p: Vec3, a: Vec3, b: Vec3): number => {
    const ab = sub(b, a);
    const s = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
    return dist(p, add(a, scale(ab, s)));
  };
  const clearance = new Map<number, number>();
  let allFit = true;
  for (const [f, mags] of design) {
    const pts = byIdx.get(f)!.pts;
    let clear = Infinity;
    for (const m of mags)
      for (let k = 0; k < pts.length; k++)
        clear = Math.min(clear, ptSeg(m.pos, pts[k], pts[(k + 1) % pts.length]));
    clearance.set(f, clear);
    if (clear < radius + margin) allFit = false;
  }
  return { allFit, clearance };
}
