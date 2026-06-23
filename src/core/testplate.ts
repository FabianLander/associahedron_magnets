/**
 * testplate.ts — a fit-test grid: a slab of BLIND pockets, one per (diameter,
 * depth) pair. Columns step the diameter across a clearance sweep, rows step the
 * pocket depth. Print it, press the magnet into each pocket, and find the cell
 * that both slip-fits (diameter) and seats flush (depth); read its clearance and
 * depth off the extruded edge labels and set the main sliders to match.
 *
 * Each pocket has diameter = 2·magnetRadius + clearance[col] (the SAME formula
 * the faces use) and depth = depth[row], drilled from the top face. The slab is
 * thick enough to leave a floor under the deepest pocket. Labels are extruded on
 * the top face: clearance along the top edge, depth down the left edge.
 */
import type { Manifold as MFManifold } from 'manifold-3d';
import { initManifold, OVERSHOOT_MM } from './drill.ts';
import { buildLabel } from './text.ts';

const SEGMENTS = 32; // match the polyhedron pockets (trimesh cylinder default)
const GAP_MM = 8; // spacing between pocket rims (and rim-to-label)
const FLOOR_MM = 3; // material under the deepest pocket
const MARK_H_MM = 1.2; // height of the extruded labels
const LABEL_MM = 5.2; // label character height

export interface GridPlateParams {
  magnetRadiusMm: number; // nominal magnet radius (no clearance)
  clearancesMm: number[]; // columns: pocket Ø = 2·radius + clearance
  depthsMm: number[]; // rows: pocket depth
}

/** Build the (diameter × depth) grid of blind pockets, with extruded labels. */
export async function buildTestPlate(p: GridPlateParams): Promise<MFManifold> {
  const { Manifold } = await initManifold();

  const radii = p.clearancesMm.map((c) => p.magnetRadiusMm + c / 2);
  const maxR = Math.max(...radii);
  const nCol = radii.length;
  const nRow = p.depthsMm.length;
  const maxDepth = Math.max(...p.depthsMm);

  const cell = 2 * maxR + GAP_MM; // square cell pitch, set by the largest pocket
  const t = maxDepth + FLOOR_MM; // plate thickness leaves a floor under the deepest

  // margins hold the edge labels: left for depth values, top for clearance values
  const leftMargin = LABEL_MM * 3.4;
  const topMargin = LABEL_MM + 3;
  const pad = 3; // outer border on the other two sides

  const plateLen = leftMargin + nCol * cell + pad; // X (clearance axis)
  const plateWid = topMargin + nRow * cell + pad; // Y (depth axis)

  // grid origin: column j centre and row i centre (row 0 at the top)
  const leftEdge = -plateLen / 2 + leftMargin;
  const topEdge = plateWid / 2 - topMargin;
  const colX = (j: number): number => leftEdge + cell * (j + 0.5);
  const rowY = (i: number): number => topEdge - cell * (i + 0.5);

  let plate = Manifold.cube([plateLen, plateWid, t], true);

  // blind pockets: cylinder from the top face down by `depth`, overshooting the
  // top so the cut is clean (same trick as drill.ts).
  for (let i = 0; i < nRow; i++) {
    for (let j = 0; j < nCol; j++) {
      const h = p.depthsMm[i] + OVERSHOOT_MM;
      const cyl = Manifold.cylinder(h, radii[j], radii[j], SEGMENTS, true).translate([
        colX(j),
        rowY(i),
        t / 2 + OVERSHOOT_MM - h / 2, // mouth at the top face, body going down
      ]);
      plate = plate.subtract(cyl);
    }
  }

  // extruded labels on the top face
  const zTop = t / 2 + MARK_H_MM / 2 - 0.01;
  const place = async (text: string, x: number, y: number): Promise<void> => {
    const lbl = await buildLabel(text, LABEL_MM, MARK_H_MM);
    if (lbl) plate = plate.add(lbl.translate([x, y, zTop]));
  };
  // clearance values across the top, depth values down the left
  for (let j = 0; j < nCol; j++) await place(fmt(p.clearancesMm[j]), colX(j), topEdge + topMargin / 2);
  for (let i = 0; i < nRow; i++) await place(fmt(p.depthsMm[i]), leftEdge - leftMargin / 2, rowY(i));

  return plate;
}

/** Compact fixed-2 label, trimming trailing zeros (0.10 → "0.1", 2.00 → "2"). */
function fmt(v: number): string {
  return v.toFixed(2).replace(/\.?0+$/, '');
}
