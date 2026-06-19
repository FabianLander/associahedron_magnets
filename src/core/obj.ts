/**
 * obj.ts — minimal Wavefront OBJ reader, replacing `trimesh.load(path)`.
 *
 * We parse the OBJ by hand (not via three's OBJLoader) for one reason: facet
 * extraction needs SHARED vertex indices so triangles that meet at an edge are
 * recognised as adjacent. OBJLoader hands back de-indexed geometry (every
 * triangle gets its own copies of its 3 vertices), which destroys adjacency.
 *
 * Only `v` and `f` lines matter here. Face lines may carry `v/vt/vn` triples;
 * we keep the vertex index (the part before the first `/`) and drop the rest.
 * Polygonal faces are fan-triangulated, though the associahedron input is
 * already all triangles.
 */
import type { Vec3 } from './vec3.ts';
import { sub, cross, dot, mean } from './vec3.ts';

export interface Mesh {
  vertices: Vec3[];
  tris: [number, number, number][]; // 0-based vertex indices
}

export function parseObj(text: string): Mesh {
  const vertices: Vec3[] = [];
  const tris: [number, number, number][] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s.startsWith('v ')) {
      const p = s.split(/\s+/);
      vertices.push([Number(p[1]), Number(p[2]), Number(p[3])]);
    } else if (s.startsWith('f ')) {
      const idx = s
        .split(/\s+/)
        .slice(1)
        .map((tok) => Number(tok.split('/')[0]) - 1); // OBJ is 1-based
      // fan-triangulate any polygon (no-op for the all-triangle input)
      for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]);
    }
  }
  return { vertices, tris };
}

/** Per-axis bounding-box extents (max − min), as in `mesh.bounding_box.extents`. */
export function bboxExtents(mesh: Mesh): Vec3 {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices)
    for (let i = 0; i < 3; i++) {
      if (v[i] < lo[i]) lo[i] = v[i];
      if (v[i] > hi[i]) hi[i] = v[i];
    }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

/**
 * Reorient every triangle's winding so its geometric normal points OUTWARD,
 * in place. trimesh did this winding repair for us; manifold needs consistent
 * CCW-outward winding to build a positive-volume solid, and the drill needs
 * outward face normals to cut inward.
 *
 * Outward is decided against the vertex-mean, which lies inside the solid for a
 * CONVEX body — true for these space-filling polyhedra. A concave input would
 * need a real winding-repair / ray test here instead.
 */
export function orientOutward(mesh: Mesh): void {
  const inside = mean(mesh.vertices);
  for (const t of mesh.tris) {
    const a = mesh.vertices[t[0]];
    const b = mesh.vertices[t[1]];
    const c = mesh.vertices[t[2]];
    const n = cross(sub(b, a), sub(c, a));
    const triC: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(n, sub(triC, inside)) < 0) [t[1], t[2]] = [t[2], t[1]];
  }
}

/**
 * Scale the (unitless) mesh in place so its longest bbox dimension equals
 * `targetLongestMm`; afterwards every length is real millimetres. Returns the
 * applied scale factor (mm per model unit), matching run_all's `scale`.
 */
export function scaleToMm(mesh: Mesh, targetLongestMm: number): number {
  const ext = bboxExtents(mesh);
  const scale = targetLongestMm / Math.max(ext[0], ext[1], ext[2]);
  for (const v of mesh.vertices) {
    v[0] *= scale;
    v[1] *= scale;
    v[2] *= scale;
  }
  return scale;
}
