"""
drill.py
========
Subtract a cylindrical pocket at each magnet position, drilling inward along the
face normal. Uses trimesh's boolean difference with the manifold3d backend.

Notes
-----
* The cutter overshoots the surface slightly (``overshoot``) so the cut face is
  never coplanar with the model surface -- coplanar faces are the #1 cause of
  boolean glitches.
* Pockets are "blind" (they do not punch through). Set ``depth`` small for a
  shallow magnet seat; optionally leave a thin roof by reducing depth so the
  magnet hides below the surface and you drop it in during a print pause.
"""

from __future__ import annotations
import numpy as np
import trimesh


def drill(mesh: trimesh.Trimesh, faces_by_idx, design,
          diameter: float, depth: float, overshoot: float = 0.4) -> trimesh.Trimesh:
    """Return a copy of ``mesh`` with every magnet pocket subtracted."""
    radius = diameter / 2.0
    out = mesh
    for face_idx, mags in design.items():
        nrm = faces_by_idx[face_idx].normal
        rot = trimesh.geometry.align_vectors([0, 0, 1], -nrm)   # drill inward
        for m in mags:
            cyl = trimesh.creation.cylinder(radius=radius, height=depth + overshoot)
            # shift so the cutter mouth sits at the surface, body goes inward
            cyl.apply_translation([0, 0, (depth + overshoot) / 2 - overshoot])
            cyl.apply_transform(rot)
            cyl.apply_translation(m.pos)
            out = out.difference(cyl)
    return out
