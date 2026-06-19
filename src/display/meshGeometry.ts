/**
 * meshGeometry.ts — bridge from a core indexed mesh ({vertices, tris}) to a
 * Three.js BufferGeometry. Impure render boundary (three.js).
 *
 * We expand to a NON-INDEXED geometry (three vertices per triangle) so flat
 * shading gives crisp facets: the polyhedron's flat faces and the 32-gon pocket
 * walls should read as flats, not be smoothed across edges.
 */
import * as THREE from 'three';
import type { Mesh } from '@core/obj.ts';

export function meshToGeometry(mesh: Mesh): THREE.BufferGeometry {
  const pos = new Float32Array(mesh.tris.length * 9);
  let o = 0;
  for (const [a, b, c] of mesh.tris)
    for (const vi of [a, b, c]) {
      const v = mesh.vertices[vi];
      pos[o++] = v[0];
      pos[o++] = v[1];
      pos[o++] = v[2];
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
