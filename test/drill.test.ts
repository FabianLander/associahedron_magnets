/**
 * drill.test.ts — proves the manifold-based drill reproduces the committed
 * Python STL. Per the agreed caveat the meshes are NOT vertex-identical (the two
 * boolean engines tessellate differently), so parity is by VOLUME: the drilled
 * solid's volume must match the volume of the committed output/A31_magnets.stl,
 * and the removed material must equal seven 32-gon prisms (one per pocket).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { runCore, DEFAULT_PARAMS } from '@core/pipeline.ts';
import { drillSolid, initManifold } from '@core/drill.ts';

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const objText = readFileSync(here('../input/A31_affine_associahedron.obj'), 'utf8');
const stl = readFileSync(here('../output/A31_magnets.stl'));

/** Signed-tetrahedra volume of a binary STL (asserts the file really is binary). */
function stlBinaryVolume(buf: Buffer): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  if (buf.byteLength !== 84 + n * 50) throw new Error('not a binary STL');
  const read = (q: number): [number, number, number] => [
    dv.getFloat32(q, true),
    dv.getFloat32(q + 4, true),
    dv.getFloat32(q + 8, true),
  ];
  let vol = 0;
  for (let i = 0, off = 84; i < n; i++, off += 50) {
    const a = read(off + 12);
    const b = read(off + 24);
    const c = read(off + 36);
    vol +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return Math.abs(vol);
}

describe('drill parity with committed STL (volume, not vertices)', () => {
  it('drilled volume matches the committed STL within 0.1%', async () => {
    const core = runCore(objText, DEFAULT_PARAMS);
    const drilled = await drillSolid(
      core.mesh,
      core.byIdx,
      core.design,
      core.pocketDiameterMm,
      core.pocketDepthMm,
    );
    const jsVol = drilled.volume();
    const pyVol = stlBinaryVolume(stl);
    expect(Math.abs(jsVol - pyVol) / pyVol).toBeLessThan(1e-3);
  });

  it('removes exactly seven 32-gon prisms of material', async () => {
    const { Manifold, Mesh: MMesh } = await initManifold();
    const core = runCore(objText, DEFAULT_PARAMS);

    // undrilled solid volume
    const vp = new Float32Array(core.mesh.vertices.flat());
    const tv = new Uint32Array(core.mesh.tris.flat());
    const solidMesh = new MMesh({ numProp: 3, vertProperties: vp, triVerts: tv });
    solidMesh.merge();
    const solidVol = Manifold.ofMesh(solidMesh).volume();

    const drilled = await drillSolid(
      core.mesh,
      core.byIdx,
      core.design,
      core.pocketDiameterMm,
      core.pocketDepthMm,
    );
    const removed = solidVol - drilled.volume();

    // 7 pockets, each a 32-gon prism: area = ½·n·sin(2π/n)·r², height = depth
    const r = core.pocketDiameterMm / 2;
    const prismArea = 0.5 * 32 * Math.sin((2 * Math.PI) / 32) * r * r;
    const expected = 7 * prismArea * core.pocketDepthMm;
    expect(removed / expected).toBeCloseTo(1, 2); // within 1%
  });
});
