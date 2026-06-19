# Associahedron magnets

An interactive web app that works out where to drill **cylindrical magnet pockets** into a polyhedral solid so that multiple 3D-printed copies **click together at matching faces**, then lets you tune the magnet geometry live and download a printable STL. It is geometry-driven: it finds which faces can actually be glued face-to-face, places the pockets, checks they fit, drills them, and draws a per-face plan, all from one input mesh.

Built around the 3-D associahedron (`input/A31_affine_associahedron.obj`, K5), but you can load your own polyhedron (see below).

## Run it

```bash
npm install
npm run dev        # dev server with hot reload
npm run build      # production build into dist/
npm run preview    # serve the production build locally
npm test           # geometry + drill parity tests (vitest)
```

The app has two tabs, both driven by the same computed state:

- **3D** shows the drilled solid with orbit controls (drag to rotate, scroll to zoom).
- **Faces** shows each face flattened into its own plane with its pocket(s) marked.

Four sliders drive everything live (debounced re-drill): **printed size** (longest dimension in mm), **magnet radius**, **clearance** (slip fit added to the hole), and **pocket depth**. The pocket is `2·radius + clearance` wide and `depth` deep. **Download STL** exports the current drilled solid.

## The geometry

The mesh's flat faces are recovered by merging coplanar triangles. Faces are compared by a **congruence fingerprint** (the sorted multiset of all pairwise vertex distances, a complete isometry invariant including reflection).

A working magnetic joint between a face of copy A and a face of copy B needs two things:

1. **A flush fit.** The two faces must sit flush: congruent *and* able to meet with outward normals opposed. Congruence alone is not enough. We detect this with a proper Kabsch fit over reversed cyclic vertex correspondences, accepting a mate only when the fit residual is ~0 and the normals end up anti-parallel.
2. **Opposite poles** where they touch.

For the associahedron this leaves two pentagons (faces 0 and 1) **unusable**: they are chiral (no mirror symmetry), so on an identical, same-handed copy there is no flush partner for them. They are left bare. Using them would require printing a mirror-image copy.

The app drills in **dual genderless** mode: two pockets per face, one N-out and one S-out, with the partner face's pockets being the mate-transform images with poles swapped. So every matching face attracts in any orientation and copies are interchangeable. A `verify` pass simulates each joint and the UI flags any face where the genderless scheme is geometrically impossible.

## Load your own polyhedron

The **Load OBJ…** button accepts any **convex, flat-faced, watertight** polyhedron. The matching, placement, N/S assignment, and drilling are all generic, not specific to the associahedron. Concave or curved or non-manifold meshes are out of scope: the outward-normal test assumes convexity, and the boolean needs a closed manifold. Invalid input is reported and the previous model is kept.

## How it is built

```
src/core/      pure geometry (no DOM): OBJ parse, coplanar-facet extraction,
               congruence, Kabsch + flush-mate graph, magnet placement,
               manifold-3d drilling, STL/OBJ export. Framework-free.
src/display/   render boundary: Three.js drilled-solid viewer + 2D faces canvas.
src/app/       the app: control panel, tabs, debounced rebuild, file load, export.
test/          parity + dual-mode tests.
data/, output/ the committed reference outputs (see Parity).
input/         the bundled associahedron OBJ.
```

Dependencies: [`three`](https://threejs.org) (rendering), [`manifold-3d`](https://github.com/elalish/manifold) (robust mesh booleans, via WASM), [`ml-matrix`](https://github.com/mljs/matrix) (SVD / eigendecomposition for the Kabsch fit and the in-plane face frame). Build tooling: Vite + TypeScript + Vitest.

## Parity

The geometry core is a faithful port of an earlier Python pipeline (`trimesh` + `manifold3d` + `numpy`). The Python's committed outputs are kept in `data/` (the congruence groups, flush-mate graph, and single-mode magnet design) and `output/A31_magnets.stl`, and the tests in `test/` prove the TypeScript reproduces them:

- `parity.test.ts` checks the congruence signatures, mate graph, connections, magnet centres, and clearances match the committed JSON (compared up to a relabelling of faces, since facet numbering is incidental).
- `drill.test.ts` checks the drilled volume matches the committed STL to float precision (the meshes are not vertex-identical: a different boolean engine tessellates the cylinders differently, but the volume is the same).
- `dual.test.ts` checks dual-mode placement is self-consistent (two pockets per usable face, every joint verifies).

The original `single_centered` mode (one centred pocket, polarity chosen at assembly) remains in the core as the parity anchor, though the app only uses dual mode.

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which runs the tests, builds, and publishes `dist/` to GitHub Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**. Vite's `base: './'` keeps asset paths relative so the site works from the project subpath.
