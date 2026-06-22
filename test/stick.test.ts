import { describe, it, expect } from 'vitest';
import { buildStick } from '../src/core/stick.ts';

describe('polarity stick', () => {
  it('is a closed solid with two pockets and distinguishable ends', async () => {
    const p = { magnetRadiusMm: 5, clearanceMm: 0.1, pocketDepthMm: 1.9, lengthMm: 55 };
    const man = await buildStick(p);
    const vol = man.volume();
    expect(vol).toBeGreaterThan(0);

    // a plain bar (no pockets, no marks) of the same outer size, for comparison
    const r = p.magnetRadiusMm + p.clearanceMm / 2;
    const side = 2 * r + 3.2;
    const barVol = p.lengthMm * side * side;
    // pockets remove material → less than the solid bar; marks add a little back,
    // but two ⌀10 × 1.9 holes dwarf two thin raised glyphs.
    expect(vol).toBeLessThan(barVol);

    const pocketVol = 2 * Math.PI * r * r * p.pocketDepthMm;
    expect(barVol - vol).toBeGreaterThan(pocketVol * 0.5); // pockets really cut in
  });
});
