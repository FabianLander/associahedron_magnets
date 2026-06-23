/**
 * text.ts — minimal extruded number labels, no font dependency.
 *
 * Each glyph is a set of straight segments on the unit cell [0,1]×[0,1] (a
 * seven-segment layout plus `.` and `-`). A segment becomes a thin box; a label
 * is the union of its segments, raised `height` mm in +Z and centred on the
 * origin in XY so the caller can drop it anywhere on a top face. Enough to label
 * the fit-plate axes with values like `0.10`, `2.0`, `-0.05`.
 */
import type { Manifold as MFManifold } from 'manifold-3d';
import { initManifold } from './drill.ts';

type Pt = [number, number];
type Seg = [Pt, Pt];

// seven-segment endpoints on the unit cell
const A: Seg = [[0, 1], [1, 1]]; // top
const B: Seg = [[1, 0.5], [1, 1]]; // top-right
const C: Seg = [[1, 0], [1, 0.5]]; // bottom-right
const D: Seg = [[0, 0], [1, 0]]; // bottom
const E: Seg = [[0, 0], [0, 0.5]]; // bottom-left
const F: Seg = [[0, 0.5], [0, 1]]; // top-left
const G: Seg = [[0, 0.5], [1, 0.5]]; // middle

const GLYPHS: Record<string, Seg[]> = {
  '0': [A, B, C, D, E, F],
  '1': [B, C],
  '2': [A, B, G, E, D],
  '3': [A, B, G, C, D],
  '4': [F, G, B, C],
  '5': [A, F, G, C, D],
  '6': [A, F, G, E, C, D],
  '7': [A, B, C],
  '8': [A, B, C, D, E, F, G],
  '9': [A, B, C, D, F, G],
  '-': [G],
  '.': [[[0.5, 0], [0.5, 0.1]]], // a short stub reads as a dot when extruded
};

/**
 * Build `text` as an extruded label: characters `size` mm tall, raised `height`
 * mm, centred on the origin in XY (z spans [-height/2, height/2]). Returns null
 * for an empty / all-unknown string.
 */
export async function buildLabel(text: string, size: number, height: number): Promise<MFManifold | null> {
  const { Manifold } = await initManifold();
  const charW = size * 0.6; // glyph cell width
  const stroke = Math.max(size * 0.16, 0.5); // segment thickness
  const space = charW * 0.4; // gap between characters

  const segBox = (a: Pt, b: Pt): MFManifold => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) + stroke; // overlap by a stroke so corners meet
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    return Manifold.cube([len, stroke, height], true)
      .rotate([0, 0, ang])
      .translate([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]);
  };

  const parts: MFManifold[] = [];
  let pen = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      for (const [a, b] of g) {
        parts.push(segBox([pen + a[0] * charW, a[1] * size], [pen + b[0] * charW, b[1] * size]));
      }
    }
    pen += (ch === '.' ? charW * 0.5 : charW) + space;
  }
  if (parts.length === 0) return null;

  let label = parts[0];
  for (let i = 1; i < parts.length; i++) label = label.add(parts[i]);
  const totalW = pen - space;
  return label.translate([-totalW / 2, -size / 2, 0]); // centre on origin
}
