/**
 * stl2obj.mjs — convert an STL (binary or ASCII) to an OBJ with WELDED vertices.
 *
 * STL stores a triangle soup: each triangle repeats its three corner positions,
 * so nothing is shared. The app's coplanar-facet extraction needs shared vertex
 * indices to know which triangles meet at an edge, so we weld coincident corners
 * onto a tolerance grid (derived from the bounding box) and emit an indexed OBJ.
 *
 *   node scripts/stl2obj.mjs <input.stl> <output.obj>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node scripts/stl2obj.mjs <input.stl> <output.obj>');
  process.exit(1);
}

const buf = readFileSync(inPath);
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

function parseTriangles() {
  const n = dv.getUint32(80, true);
  if (buf.byteLength === 84 + 50 * n) {
    const rd = (q) => [dv.getFloat32(q, true), dv.getFloat32(q + 4, true), dv.getFloat32(q + 8, true)];
    const tris = [];
    for (let i = 0, o = 84; i < n; i++, o += 50) tris.push([rd(o + 12), rd(o + 24), rd(o + 36)]);
    return tris;
  }
  // ASCII fallback
  const nums = [...buf.toString('utf8').matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)].map((m) => [
    +m[1], +m[2], +m[3],
  ]);
  const tris = [];
  for (let i = 0; i < nums.length; i += 3) tris.push([nums[i], nums[i + 1], nums[i + 2]]);
  return tris;
}

const tris = parseTriangles();

// weld tolerance: a millionth of the bounding-box diagonal
const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (const t of tris)
  for (const v of t)
    for (let a = 0; a < 3; a++) {
      if (v[a] < lo[a]) lo[a] = v[a];
      if (v[a] > hi[a]) hi[a] = v[a];
    }
const tol = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1e-6, 1e-9);
const key = (v) => `${Math.round(v[0] / tol)},${Math.round(v[1] / tol)},${Math.round(v[2] / tol)}`;

const map = new Map();
const verts = [];
const idxOf = (v) => {
  const k = key(v);
  let i = map.get(k);
  if (i === undefined) {
    i = verts.length;
    map.set(k, i);
    verts.push(v);
  }
  return i;
};

const faces = [];
for (const t of tris) {
  const f = [idxOf(t[0]), idxOf(t[1]), idxOf(t[2])];
  if (f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]) faces.push(f); // drop degenerates
}

const lines = [`# converted from ${inPath} by stl2obj.mjs (vertices welded)`];
for (const v of verts) lines.push(`v ${v[0]} ${v[1]} ${v[2]}`);
for (const f of faces) lines.push(`f ${f[0] + 1} ${f[1] + 1} ${f[2] + 1}`);
writeFileSync(outPath, lines.join('\n') + '\n');

console.log(`wrote ${outPath}: ${verts.length} verts, ${faces.length} tris (from ${tris.length} STL triangles)`);
