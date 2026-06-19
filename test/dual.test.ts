/**
 * dual.test.ts — exercises dual_genderless placement (two pockets per face, the
 * mode the 3D/faces views expose alongside single). Parity targets only single
 * mode (the committed Python run), so this instead checks the dual design is
 * self-consistent: two pockets on every usable face, none on chiral faces, and
 * every connection verifies (each magnet meets an opposite-pole partner).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { runCore, DEFAULT_PARAMS } from '@core/pipeline.ts';

const objText = readFileSync(
  fileURLToPath(new URL('../input/A31_affine_associahedron.obj', import.meta.url)),
  'utf8',
);

describe('dual_genderless placement', () => {
  const core = runCore(objText, { ...DEFAULT_PARAMS, mode: 'dual_genderless' });

  it('puts two pockets on every usable face and none on chiral faces', () => {
    for (const [face, mags] of core.design) {
      expect(mags.length).toBe(2);
      expect(core.unusable).not.toContain(face);
    }
    for (const u of core.unusable) expect(core.design.has(u)).toBe(false);
  });

  it('verifies: every magnet meets an opposite pole at each joint', () => {
    expect(core.verify.allOk).toBe(true);
  });
});
