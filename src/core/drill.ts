/**
 * drill.ts — subtract a cylindrical pocket at each magnet position, drilling
 * inward along the (outward) face normal. Port of drill.py, with trimesh's
 * boolean replaced by manifold-3d (the WASM build of the SAME manifold library
 * trimesh used as its backend, so the geometry matches; see test/drill.test.ts).
 *
 * Per pocket, exactly as the Python: take a z-axis cylinder, shift it so its
 * mouth sits at the surface and its body (length `depth`) goes inward while it
 * OVERSHOOTS the surface by `overshoot` (a cap of empty cylinder above the face
 * — coplanar cut faces are the #1 cause of boolean glitches), rotate +z onto the
 * inward normal, translate to the pocket centre, subtract.
 *
 * Cylinders use 32 segments to match trimesh's `creation.cylinder` default, so
 * the removed 32-gon prism — hence the drilled volume — agrees with the
 * committed STL.
 */
import Module from 'manifold-3d';
import type { ManifoldToplevel, Manifold as MFManifold, Mat4 } from 'manifold-3d';
import type { Vec3 } from './vec3.ts';
import { sub, cross, dot, len, normalize, scale } from './vec3.ts';
import type { Mat3 } from './linalg.ts';
import type { Mesh } from './obj.ts';
import type { Face } from './geometry.ts';
import type { Design } from './magnets.ts';

/** run_all's OVERSHOOT_MM: how far the cutter pokes past the surface. */
export const OVERSHOOT_MM = 0.6;
const SEGMENTS = 32; // trimesh creation.cylinder default

let wasmPromise: Promise<ManifoldToplevel> | null = null;
/**
 * Load + set up the manifold WASM module once; subsequent calls reuse it.
 * In Node the loader finds the .wasm on its own; under a bundler (Vite) pass
 * `locateFile` returning the asset URL (e.g. from `manifold-3d/manifold.wasm?url`).
 */
export function initManifold(locateFile?: () => string): Promise<ManifoldToplevel> {
  if (!wasmPromise)
    wasmPromise = Module(locateFile ? { locateFile } : undefined).then((w) => {
      w.setup();
      return w;
    });
  return wasmPromise;
}

/** Rotation (row-major Mat3) taking +z onto the unit vector t (Rodrigues). */
function rotateZTo(t: Vec3): Mat3 {
  const v = cross([0, 0, 1], t);
  const s = len(v);
  const c = dot([0, 0, 1], t);
  if (s < 1e-12) {
    // parallel (identity) or antiparallel (180° about x)
    return c > 0
      ? [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ]
      : [
          [1, 0, 0],
          [0, -1, 0],
          [0, 0, -1],
        ];
  }
  const [kx, ky, kz] = scale(v, 1 / s); // unit axis
  // R = I + sinθ·K + (1−cosθ)·K²,  with sinθ=s, cosθ=c, K=skew(k), K²=kkᵀ−I
  const K: Mat3 = [
    [0, -kz, ky],
    [kz, 0, -kx],
    [-ky, kx, 0],
  ];
  const K2: Mat3 = [
    [kx * kx - 1, kx * ky, kx * kz],
    [kx * ky, ky * ky - 1, ky * kz],
    [kx * kz, ky * kz, kz * kz - 1],
  ];
  const f = 1 - c;
  const R: Mat3 = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[i][j] += s * K[i][j] + f * K2[i][j];
  return R;
}

/** Row-major Mat3 rotation → manifold's 4×4 column-major Mat4 (no translation). */
function mat3ToMat4(R: Mat3): Mat4 {
  return [
    R[0][0], R[1][0], R[2][0], 0,
    R[0][1], R[1][1], R[2][1], 0,
    R[0][2], R[1][2], R[2][2], 0,
    0, 0, 0, 1,
  ];
}

/** Build the solid manifold from the scaled, outward-oriented mesh. */
async function solidOf(mesh: Mesh): Promise<MFManifold> {
  const { Manifold, Mesh: MMesh } = await initManifold();
  const vertProperties = new Float32Array(mesh.vertices.length * 3);
  mesh.vertices.forEach((v, i) => {
    vertProperties[3 * i] = v[0];
    vertProperties[3 * i + 1] = v[1];
    vertProperties[3 * i + 2] = v[2];
  });
  const triVerts = new Uint32Array(mesh.tris.flat());
  const m = new MMesh({ numProp: 3, vertProperties, triVerts });
  m.merge(); // weld any coincident verts so the input is a closed manifold
  return Manifold.ofMesh(m);
}

/** Return the solid with every magnet pocket subtracted. */
export async function drillSolid(
  mesh: Mesh,
  byIdx: Map<number, Face>,
  design: Design,
  pocketDiameterMm: number,
  pocketDepthMm: number,
  overshootMm = OVERSHOOT_MM,
): Promise<MFManifold> {
  const { Manifold } = await initManifold();
  let out = await solidOf(mesh);
  const radius = pocketDiameterMm / 2;
  const h = pocketDepthMm + overshootMm;
  for (const [faceIdx, mags] of design) {
    const rot = mat3ToMat4(rotateZTo(scale(byIdx.get(faceIdx)!.normal, -1))); // +z → inward
    for (const m of mags) {
      const cyl = Manifold.cylinder(h, radius, radius, SEGMENTS, true)
        .translate([0, 0, h / 2 - overshootMm]) // mouth at surface, body inward
        .transform(rot)
        .translate(m.pos);
      out = out.subtract(cyl);
    }
  }
  return out;
}

/** Pull a manifold's geometry back into a plain indexed mesh (for export / Three.js). */
export function manifoldToMesh(man: MFManifold): Mesh {
  const m = man.getMesh();
  const np = m.numProp;
  const vp = m.vertProperties;
  const vertices: Vec3[] = [];
  for (let i = 0; i < vp.length; i += np) vertices.push([vp[i], vp[i + 1], vp[i + 2]]);
  const tris: [number, number, number][] = [];
  const tv = m.triVerts;
  for (let i = 0; i < tv.length; i += 3) tris.push([tv[i], tv[i + 1], tv[i + 2]]);
  return { vertices, tris };
}

/** Binary STL (the printable deliverable) from an indexed mesh. */
export function meshToStlBinary(mesh: Mesh): ArrayBuffer {
  const n = mesh.tris.length;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, n, true);
  let off = 84;
  for (const [a, b, c] of mesh.tris) {
    const va = mesh.vertices[a];
    const vb = mesh.vertices[b];
    const vc = mesh.vertices[c];
    const nrm = normalize(cross(sub(vb, va), sub(vc, va)));
    dv.setFloat32(off, nrm[0], true);
    dv.setFloat32(off + 4, nrm[1], true);
    dv.setFloat32(off + 8, nrm[2], true);
    let p = off + 12;
    for (const v of [va, vb, vc]) {
      dv.setFloat32(p, v[0], true);
      dv.setFloat32(p + 4, v[1], true);
      dv.setFloat32(p + 8, v[2], true);
      p += 12;
    }
    dv.setUint16(off + 48, 0, true);
    off += 50;
  }
  return buf;
}

/** Wavefront OBJ text from an indexed mesh (1-based, as OBJ requires). */
export function meshToObj(mesh: Mesh): string {
  const lines: string[] = [];
  for (const v of mesh.vertices) lines.push(`v ${v[0]} ${v[1]} ${v[2]}`);
  for (const t of mesh.tris) lines.push(`f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}`);
  return lines.join('\n') + '\n';
}
