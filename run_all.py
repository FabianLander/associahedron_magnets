#!/usr/bin/env python3
"""
run_all.py  --  one-command pipeline.

Regenerates EVERYTHING in output/ and data/ from input/A31_affine_associahedron.obj:

  1. extract faces + congruence groups        -> data/congruence.json
  2. compute the flush-mate graph + connections-> data/mate_graph.json
  3. place + verify the magnet design          -> data/magnet_design.json
  4. drill the pockets                          -> output/A31_magnets.{stl,obj}
  5. draw the 2D plan and a 3D render           -> output/magnet_plan.png,
                                                   output/A31_magnets_3d.png

Run:   python run_all.py
Tune the magnet geometry in the CONFIG block below. All lengths are in the
model's own units (the OBJ is unitless); see README for scaling to real magnets.
"""

from __future__ import annotations
import os, sys, json
import numpy as np

# make src/ importable
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

from geometry import load_solid, extract_faces, congruence_groups
from mating import flush_mate_graph, derive_connections
from magnets import place_magnets, verify, fit_check
from drill import drill
from illustrate import plan_figure, render_3d

# ----------------------------- CONFIG ---------------------------------------
INPUT      = os.path.join(HERE, "input", "A31_affine_associahedron.obj")
OUT        = os.path.join(HERE, "output")
DATA       = os.path.join(HERE, "data")

# Magnet design mode:
#   "single_centered" -> ONE centred pocket per face; you set polarity at assembly.
#   "dual_genderless" -> TWO pockets per face (N+S); copies are interchangeable.
MODE = "single_centered"

# --- real-world build settings, in MILLIMETRES ---
# The input OBJ is unitless; we scale it so its longest dimension = TARGET_LONGEST_MM,
# after which every length below is real millimetres.
TARGET_LONGEST_MM = 60.0    # printed size of the solid (longest bounding-box dimension)
MAGNET_DIA_MM     = 5.0      # magnet diameter  (Wukong 5 x 2 mm disc)
MAGNET_CLEAR_MM   = 0.15     # added to diameter for a slip fit (tune to your printer)
MAGNET_THICK_MM   = 2.0      # magnet thickness
DEPTH_EXTRA_MM    = 0.2      # extra pocket depth: glue room + faces still meet flush
OFFSET_MM         = 4.5      # magnet-centre distance from the face centre
OVERSHOOT_MM      = 0.6      # cutter overshoot past the surface (boolean robustness)

MAGNET_DIA   = MAGNET_DIA_MM + MAGNET_CLEAR_MM      # pocket diameter (mm)
MAGNET_DEPTH = MAGNET_THICK_MM + DEPTH_EXTRA_MM     # pocket depth    (mm)
OFFSET       = OFFSET_MM
OVERSHOOT    = OVERSHOOT_MM
# ----------------------------------------------------------------------------


def _jsonable(x):
    if isinstance(x, np.ndarray):
        return [round(float(v), 6) for v in x]
    return x


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(DATA, exist_ok=True)

    # 1. geometry -------------------------------------------------------------
    mesh = load_solid(INPUT)
    # scale unitless model to real millimetres (longest dimension = TARGET_LONGEST_MM)
    scale = TARGET_LONGEST_MM / float(max(mesh.bounding_box.extents))
    mesh.apply_scale(scale)
    faces = extract_faces(mesh)
    by_idx = {f.idx: f for f in faces}
    groups = congruence_groups(faces)

    json.dump(
        {
            "n_faces": len(faces),
            "watertight": bool(mesh.is_watertight),
            "bbox": _jsonable(mesh.bounding_box.extents),
            "faces": [
                {"idx": f.idx, "sides": f.n, "area": round(f.area, 4),
                 "edge_lengths": _jsonable(f.edge_lengths)}
                for f in faces
            ],
            "congruence_groups": groups,
        },
        open(os.path.join(DATA, "congruence.json"), "w"), indent=2,
    )

    # 2. mating ---------------------------------------------------------------
    graph = flush_mate_graph(faces)
    connections, unusable = derive_connections(graph)
    json.dump(
        {"flush_mate_graph": graph, "connections": connections, "unusable_faces": unusable},
        open(os.path.join(DATA, "mate_graph.json"), "w"), indent=2,
    )

    # 3. magnets --------------------------------------------------------------
    design = place_magnets(by_idx, connections, OFFSET, mode=MODE)
    ok, vreport = verify(design, by_idx, connections, mode=MODE)
    fit_ok, fit = fit_check(design, by_idx, radius=MAGNET_DIA / 2)
    if not ok:
        raise SystemExit("ABORT: a connection failed verification: %s" % vreport)
    if not fit_ok:
        raise SystemExit("ABORT: a pocket does not fit inside its face: %s" % fit)

    json.dump(
        {
            "params": {"mode": MODE, "units": "mm", "scale_mm_per_model_unit": round(scale, 5),
                       "target_longest_mm": TARGET_LONGEST_MM,
                       "magnet_dia_mm": MAGNET_DIA_MM, "magnet_thick_mm": MAGNET_THICK_MM,
                       "pocket_diameter_mm": MAGNET_DIA, "pocket_depth_mm": MAGNET_DEPTH,
                       "offset_mm": OFFSET},
            "connections": connections,
            "unusable_faces": unusable,
            "magnets": [
                {"face": m.face, "pole_out": m.pole, "centre": _jsonable(m.pos)}
                for f in sorted(design) for m in design[f]
            ],
            "verification": [{"connection": [i, j], "ok": bool(o)} for i, j, o in vreport],
            "edge_clearance": {str(k): round(float(v), 3) for k, v in fit.items()},
        },
        open(os.path.join(DATA, "magnet_design.json"), "w"), indent=2,
    )

    # 4. drill ----------------------------------------------------------------
    drilled = drill(mesh, by_idx, design, MAGNET_DIA, MAGNET_DEPTH, OVERSHOOT)
    drilled.export(os.path.join(OUT, "A31_magnets.stl"))
    drilled.export(os.path.join(OUT, "A31_magnets.obj"))

    # 5. illustrate -----------------------------------------------------------
    plan_figure(by_idx, design, connections, unusable,
                radius=MAGNET_DIA / 2, path=os.path.join(OUT, "magnet_plan.png"), mode=MODE)
    render_3d(drilled, os.path.join(OUT, "A31_magnets_3d.png"))

    # summary -----------------------------------------------------------------
    print("=== SUMMARY ===")
    print("mode:", MODE)
    print("faces:", len(faces), "| congruence groups:", groups)
    print("connections:", connections)
    print("unusable (chiral, no mate):", unusable)
    print("all connections verified:", ok, "| all pockets fit:", fit_ok)
    print("watertight result:", drilled.is_watertight,
          "| volume %.1f -> %.1f" % (mesh.volume, drilled.volume))
    print("wrote output/ and data/")


if __name__ == "__main__":
    main()
