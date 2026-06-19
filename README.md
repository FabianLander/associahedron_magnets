# Associahedron Magnet-Pocket Generator

A small, self-contained pipeline that drills **cylindrical magnet pockets** into a
polyhedral solid so that multiple 3D-printed copies **click together at matching
faces**. It is geometry-driven: it works out which faces can actually be glued
face-to-face, places the magnet pocket(s), checks they fit, cuts them, and draws
a per-face placement plan — all reproducibly from one input mesh.

Built around `input/A31_affine_associahedron.obj` (the 3-D associahedron, K5).

---

## TL;DR

```bash
pip install -r requirements.txt
python run_all.py          # regenerates everything in output/ and data/
```

Current build: **Wukong 5 × 2 mm** neodymium discs, solid printed at **60 mm**
longest dimension, **one centred pocket per usable face** (you choose each
magnet's polarity at assembly). Output: `output/A31_magnets.stl`.

---

## 1. What problem this solves, precisely

We want copies of one printed solid to snap together with embedded magnets. Two
conditions must hold for a working magnetic joint between a face of copy A and a
face of copy B:

1. **Geometry** — the two faces must be able to sit *flush*: congruent **and**
   able to meet with their outward normals opposed (one copy on each side of the
   contact plane). Congruence alone is **not** enough.
2. **Magnetism** — where the faces touch, the magnets must present **opposite
   poles** so they attract.

This repo handles (1) rigorously and gives you two ways to handle (2).

---

## 2. The geometry of this solid (the interesting part)

The mesh has **9 faces = 3 quadrilaterals + 6 pentagons**. Grouping by true
congruence (the full sorted multiset of pairwise vertex distances, a complete
isometry invariant — see `geometry.py`):

| faces   | shape              | mating status                         |
|---------|--------------------|---------------------------------------|
| `2`     | 9.33 × 8.05 rect   | **self-mates** (2 ↔ 2)                |
| `7, 8`  | 3.95 × 6.27 rect   | mate as a pair (7 ↔ 8)                |
| `3, 4`  | pentagon           | mate as a pair (3 ↔ 4)                |
| `5, 6`  | pentagon           | mate as a pair (5 ↔ 6)                |
| `0, 1`  | pentagon           | **UNUSABLE — chiral, no flush mate**  |

### Why faces 0 and 1 can't be used
Faces 0 and 1 are congruent, and there is even a **180° rotation that maps one
onto the other** — in fact it is a true symmetry of the whole solid (it maps the
entire mesh onto itself). But that rotation sends *outward* normals to *outward*
normals (normal·normal = +1): it is a **symmetry**, not a join. Gluing needs the
faces to point *into* each other (normal·normal = −1). When we force that, the
best achievable alignment error is **1.17** (model units) versus ~0 for faces
that genuinely mate — because the pentagon is **chiral** (no mirror symmetry),
and every printed copy has the same handedness. To get a flush joint there you
would need a *mirror-image* copy.

The same logic, applied to all face pairs, produces the **flush-mate graph** in
`data/mate_graph.json`. Faces 0 and 1 come out with no mate and are left bare.

> Want faces 0/1 usable? Print one **mirrored** copy; a normal copy's face 0 will
> then mate against the mirrored copy. This repo does not generate the mirrored
> variant, but `mating.py` already contains everything needed to verify it.

---

## 3. Two magnet-design modes

Set `MODE` at the top of `run_all.py`.

### `single_centered`  (current default)
**One pocket per usable face, at the face centre.** You insert each magnet with
whichever polarity that particular joint needs. Because mating makes the two
faces' centres coincide, the two centred magnets always line up.

* + Fewest magnets (7 here), simplest model.
* − Copies are **not** interchangeable: you must plan polarity. Trivial for a
  chain or tree (just alternate N/S between adjacent copies). The only thing that
  can't be 2-coloured is a **closed loop with an odd number of parts** — one
  joint in such a loop is forced to repel.
* − A single centred magnet does not stop the joint from **rotating** (flat face
  on flat face, magnet on the spin axis). Fine for many builds; if you need the
  joint to lock to an orientation, use the other mode or offset the magnet.

### `dual_genderless`
**Two pockets per face: one N-out, one S-out.** The partner face's two magnets
are the mate-transform images of the first face's, with poles swapped, so at any
matching face every N meets an S.

* + Every copy is identical; any copy clicks to any copy with no planning; wrong
  orientation repels (self-keying); two magnets give rotational registration.
* − Twice the magnets (14 here).

Both modes leave faces 0 and 1 bare — that is geometry, not a mode choice.

---

## 4. Assembly (for the current `single_centered` build)

1. Print the copies. Each usable face has one 5.15 mm × 2.2 mm blind pocket at
   its centre. Faces 0 and 1 are intentionally blank.
2. When joining two copies at a face, glue a magnet into **each** of the two
   touching faces so they present **opposite poles** (one N facing out, the other
   S facing out). A dab of super glue holds each magnet.
3. Across a multi-copy build, alternate polarity like a checkerboard. For a
   straight chain this is just N, S, N, S… down the line.
4. `output/magnet_plan.png` shows every face and where its slot is; the
   millimetre centres are in `data/magnet_design.json`.

---

## 5. Folder layout

```
associahedron_magnets/
├── README.md                 <- this file
├── requirements.txt
├── run_all.py                <- entry point; CONFIG block (MODE + mm settings) at top
├── input/
│   └── A31_affine_associahedron.obj
├── src/
│   ├── geometry.py           <- load mesh, extract face polygons, congruence fingerprint
│   ├── mating.py             <- Kabsch, flush-mate transform, mate graph, connections
│   ├── magnets.py            <- pocket placement (both modes), verification, fit check
│   ├── drill.py              <- boolean-subtract the cylindrical pockets
│   └── illustrate.py         <- per-face cylinder-placement images + 3D render
├── output/                   <- generated; safe to delete and regenerate
│   ├── A31_magnets.stl       <- drilled solid, scaled to mm (PRINT THIS)
│   ├── A31_magnets.obj
│   ├── magnet_plan.png       <- the face images with cylinder positions
│   └── A31_magnets_3d.png    <- shaded 3D preview of the drilled solid
└── data/                     <- generated; machine-readable results
    ├── congruence.json
    ├── mate_graph.json
    └── magnet_design.json
```

---

## 6. Pipeline, stage by stage

`run_all.py` runs five stages. Each writes a machine-readable artifact so another
tool (or agent) can consume the results without rerunning Python.

1. **geometry** (`geometry.py`)
   `load_solid` reads the mesh. `extract_faces` merges coplanar triangles into
   facets, walks each facet's boundary into an ordered polygon, and computes a
   **congruence fingerprint** = sorted multiset of all pairwise vertex distances.
   `congruence_groups` buckets faces by that fingerprint. → `data/congruence.json`

2. **mating** (`mating.py`)
   `kabsch` finds the best *proper* (det +1) rigid fit between two ordered point
   sets. `mate_transform` searches reversed cyclic vertex correspondences (normals
   oppose ⇒ orientation flips) to lay one face flush onto another. `flush_mate_graph`
   records, for every face, which faces it can be glued against (RMSD ≈ 0 and
   normals anti-parallel). `derive_connections` turns that graph into the list of
   connections and the unusable faces. → `data/mate_graph.json`

3. **magnets** (`magnets.py`)
   `place_magnets` builds the pockets for the chosen `MODE`. `verify` simulates
   each connection (lay copy-2's face onto copy-1's and confirm the pockets meet —
   and, in dual mode, that poles oppose). `fit_check` confirms every pocket clears
   its face edges. The run aborts if either check fails. → `data/magnet_design.json`

4. **drill** (`drill.py`)
   `drill` subtracts a cylinder at each pocket centre, oriented along the inward
   face normal, using trimesh's manifold3d boolean backend. The cutter overshoots
   the surface slightly so the cut face is never coplanar with the model surface
   (the main cause of boolean glitches). → `output/A31_magnets.{stl,obj}`

5. **illustrate** (`illustrate.py`) — *the face-image generator*
   `plan_figure` is the code the brief asks for: it draws **each face as a flat
   polygon with its cylinder centre(s) marked**. For every face it builds an
   in-plane frame (`face_frame` → centroid + axes *u, v*), projects the polygon
   and the pocket centres into 2-D via `((p − c)·u, (p − c)·v)`, and plots the
   outline plus a dot at each cylinder. Single mode draws one neutral grey slot;
   dual mode draws red (N) and blue (S). Unusable faces are drawn red. `render_3d`
   adds a shaded preview of the drilled solid. → `output/magnet_plan.png`,
   `output/A31_magnets_3d.png`

---

## 7. Configuration (top of `run_all.py`)

The input OBJ is **unitless**; the pipeline scales it so its longest dimension
equals `TARGET_LONGEST_MM`, after which every length is **real millimetres**.

```python
MODE              = "single_centered"  # or "dual_genderless"
TARGET_LONGEST_MM = 60.0   # printed size of the solid (longest bbox dimension)
MAGNET_DIA_MM     = 5.0     # magnet diameter   (Wukong 5 x 2 mm disc)
MAGNET_CLEAR_MM   = 0.15    # added to diameter for a slip fit (tune to printer)
MAGNET_THICK_MM   = 2.0     # magnet thickness
DEPTH_EXTRA_MM    = 0.2     # extra pocket depth: glue room + faces meet flush
OFFSET_MM         = 4.5     # (dual mode only) magnet-centre distance from face centre
OVERSHOOT_MM      = 0.6     # cutter overshoot past the surface (boolean robustness)
```

Current build → scale ≈ **4.515 mm per model unit**; pockets **5.15 mm dia ×
2.2 mm deep**; every pocket clears its face edges comfortably (see
`data/magnet_design.json → edge_clearance`).

### Tuning notes
* FDM holes often print slightly undersized. If magnets are too tight, raise
  `MAGNET_CLEAR_MM` toward 0.2–0.25; too loose, lower it. Glue fixes them anyway.
* To hide a magnet under a thin printed roof (drop it in during a print pause),
  set `DEPTH_EXTRA_MM` negative so a 0.2–0.4 mm wall remains over the pocket.
* Changing `TARGET_LONGEST_MM` rescales everything; `fit_check` aborts if a
  pocket no longer fits (the small rectangles 7/8 are the tightest faces).

---

## 8. Data-file schemas (for downstream tools/agents)

`data/congruence.json` — faces (sides, area, edge lengths) and congruence groups.

`data/mate_graph.json`
```json
{ "flush_mate_graph": {"<face>": [<face>...]},
  "connections": [[i, j], ...],
  "unusable_faces": [<face>, ...] }
```

`data/magnet_design.json`
```json
{ "params": {"mode": "...", "units": "mm", "scale_mm_per_model_unit": ...,
             "pocket_diameter_mm": ..., "pocket_depth_mm": ..., ...},
  "connections": [[i, j], ...],
  "unusable_faces": [...],
  "magnets": [ {"face": <int>, "pole_out": "N"|"S"|null, "centre": [x, y, z]} ],
  "verification": [ {"connection": [i, j], "ok": true} ],
  "edge_clearance": {"<face>": <min distance centre→edge, mm>} }
```
`pole_out` is `null` in single_centered mode (you choose polarity at assembly).
`centre` is the world-space (mm) centre of the pocket opening on the surface.

---

## 9. Adapting to a different solid

Drop a watertight mesh in `input/`, point `INPUT` at it, set `TARGET_LONGEST_MM`
and the magnet sizes, and run. Congruence grouping, flush-mate detection,
connection derivation, placement, verification, fit check, drilling and the face
plan are all geometry-driven — no per-face hand-tuning. Watch for: non-watertight
input (booleans will fail — repair first) and faces too small for the pocket at
your scale (the fit check aborts and names the face).

---

## 10. Dependencies

`trimesh` (mesh + booleans), `manifold3d` (fast/robust boolean backend), `numpy`,
`matplotlib` (figures). `scipy` is optional (only used by ad-hoc checks, not the
pipeline). See `requirements.txt`.
