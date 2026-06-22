/**
 * stick.ts — a small polarity-reference bar, separate from the polyhedra.
 *
 * A square-section bar lying along X with a cylindrical magnet pocket drilled
 * into each end (same pocket sizing as the polyhedron faces: diameter =
 * 2·radius + clearance, given depth). You press one magnet into each end; the
 * pole left facing OUT of a pocket is that end's exposed pole. The two ends
 * carry raised marks so you never mix them up: a `+` on the North end, a `−`
 * on the South end (the universal magnet-polarity convention, N = +). Decide
 * once which way you seat the magnets and the stick is a fixed N/S reference.
 *
 * Built with the same manifold-3d primitives + overshoot trick as drill.ts so
 * the pocket geometry matches the holes in the solids.
 */
import type { Manifold as MFManifold } from 'manifold-3d';
import type { Vec3 } from './vec3.ts';
import { initManifold } from './drill.ts';
import { OVERSHOOT_MM } from './drill.ts';

const SEGMENTS = 32; // match the polyhedron pockets (trimesh cylinder default)
const WALL_MM = 1.6; // material around the magnet, sets the bar cross-section
const MARK_H_MM = 0.6; // how far the +/− marks stand proud of the top face

export interface StickParams {
  magnetRadiusMm: number; // magnet radius (the bare magnet, no clearance)
  clearanceMm: number; // slip fit added to the hole, as on the faces
  pocketDepthMm: number; // how deep each end pocket goes
  lengthMm: number; // overall length of the bar
}

/**
 * Build the stick solid: a centred square bar along X, a pocket bored into each
 * end, a raised `+` near the +X end and a raised `−` near the −X end.
 */
export async function buildStick(p: StickParams): Promise<MFManifold> {
  const { Manifold } = await initManifold();

  const r = p.magnetRadiusMm + p.clearanceMm / 2; // pocket radius (matches faces)
  const side = 2 * r + 2 * WALL_MM; // square cross-section in Y/Z
  const L = Math.max(p.lengthMm, 2 * p.pocketDepthMm + side); // keep ends from meeting

  let bar = Manifold.cube([L, side, side], true);

  // One pocket per end, axis along X, mouth flush with the end face, body going
  // inward and overshooting outward by OVERSHOOT_MM (clean, non-coplanar cut).
  const h = p.pocketDepthMm + OVERSHOOT_MM;
  for (const endX of [L / 2, -L / 2]) {
    const dir = Math.sign(endX); // +1 at +X end, −1 at −X end
    // centred cylinder along Z, rotate +Z → ±X, then slide so the mouth sits on
    // the end face: interval becomes [endX − dir·depth, endX + dir·overshoot].
    const tx = dir * (L / 2 + OVERSHOOT_MM - h / 2);
    const cyl = Manifold.cylinder(h, r, r, SEGMENTS, true)
      .rotate([0, 90, 0]) // axis Z → X
      .translate([tx, 0, 0]);
    bar = bar.subtract(cyl);
  }

  // Raised pole marks on the top face (z = side/2). `+` over the +X (North) end,
  // `−` over the −X (South) end. Built from thin boxes so no font is needed.
  const markCx = L / 4; // a quarter of the way out toward each end
  const armLen = Math.min(side * 0.6, 8);
  const armThin = Math.max(side * 0.14, 1.4);
  const zTop = side / 2 + MARK_H_MM / 2 - 0.01; // sink 0.01 in so it fuses to the bar
  const bar1 = Manifold.cube([armLen, armThin, MARK_H_MM], true);
  const bar2 = Manifold.cube([armThin, armLen, MARK_H_MM], true);
  const plus = bar1.add(bar2).translate([markCx, 0, zTop] as Vec3); // North: +
  const minus = bar1.translate([-markCx, 0, zTop] as Vec3); // South: −
  bar = bar.add(plus).add(minus);

  return bar;
}
