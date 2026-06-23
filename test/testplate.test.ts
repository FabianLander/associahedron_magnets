import { describe, it, expect } from 'vitest';
import { buildTestPlate } from '../src/core/testplate.ts';
import { manifoldToMesh } from '../src/core/drill.ts';

const zRange = (man: Awaited<ReturnType<typeof buildTestPlate>>): number => {
  const { vertices } = manifoldToMesh(man);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vertices) {
    lo = Math.min(lo, v[2]);
    hi = Math.max(hi, v[2]);
  }
  return hi - lo;
};

describe('fit-test plate (diameter × depth grid of blind pockets)', () => {
  it('is a closed solid with positive volume', async () => {
    const man = await buildTestPlate({
      magnetRadiusMm: 2.5,
      clearancesMm: [0, 0.05, 0.1, 0.15, 0.2, 0.25],
      depthsMm: [1.0, 1.5, 2.0, 2.5],
    });
    expect(man.volume()).toBeGreaterThan(0);
  });

  it('pockets are blind: the slab (minus the raised labels) is thicker than the deepest pocket', async () => {
    const man = await buildTestPlate({
      magnetRadiusMm: 2.5,
      clearancesMm: [0, 0.1, 0.2],
      depthsMm: [1.0, 2.0, 2.5],
    });
    // labels stand 0.6 mm proud of the top, so subtract that before comparing.
    expect(zRange(man) - 0.6).toBeGreaterThan(2.5);
  });

  it('deeper pockets remove more material (footprint and thickness held fixed)', async () => {
    // Same largest depth (2.5) ⇒ same slab thickness and footprint; the "deep"
    // grid deepens the other pockets, so it removes strictly more material.
    const base = { magnetRadiusMm: 2.5, clearancesMm: [0, 0.1, 0.2] };
    const shallow = await buildTestPlate({ ...base, depthsMm: [1.0, 1.0, 2.5] });
    const deep = await buildTestPlate({ ...base, depthsMm: [2.5, 2.5, 2.5] });
    expect(deep.volume()).toBeLessThan(shallow.volume());
  });
});
