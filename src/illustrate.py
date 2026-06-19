"""
illustrate.py
=============
Generates the figures that show WHERE the cylinders go.

This is the module the brief calls out specifically: it draws each face as a
flat polygon (projected into the face's own plane) and overlays the magnet
pocket centre(s) for that face, grouped by which faces mate. Two figures:

* ``plan_figure`` -- one panel per face: the polygon outline plus its pocket
  centre(s). In single_centered mode the slot is drawn neutral grey (you choose
  N/S at assembly); in dual_genderless mode the two slots are coloured red (N)
  and blue (S). Faces with no flush mate are drawn red and labelled.

* ``render_3d`` -- a shaded multi-view render of the drilled solid.

How a face is flattened
-----------------------
``face_frame`` gives an in-plane orthonormal frame (centroid + axes u, v). Every
3-D point ``p`` on the face becomes the 2-D coordinate ``((p-c)·u, (p-c)·v)``.
Pocket centres are projected the same way, so their dots sit exactly where the
cylinders are cut.
"""

from __future__ import annotations
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from magnets import face_frame

POLE_COLOR = {"N": "#d33", "S": "#36c"}     # dual mode
SLOT_COLOR = "#777"                          # single mode (polarity chosen later)


def _to2d(face, world_pts):
    """Project world points into the face's 2-D plane (see module docstring)."""
    c, nrm, u, v = face_frame(face)
    d = np.asarray(world_pts) - c
    return np.c_[d @ u, d @ v]


def plan_figure(faces_by_idx, design, connections, unusable, radius, path, mode="single_centered"):
    """Draw the per-face cylinder-placement plan and save it to ``path``."""
    usable = sorted({f for conn in connections for f in conn})
    n_cells = len(usable) + len(unusable)
    cols = 4
    rows = int(np.ceil(n_cells / cols))
    fig = plt.figure(figsize=(3.2 * cols, 3.0 * rows))
    gs = fig.add_gridspec(rows, cols, hspace=0.45, wspace=0.25)

    conn_label = {}
    for a, b in connections:
        conn_label[a] = f"self-mate {a}\u2194{a}" if a == b else f"pair {a}\u2194{b}"
        conn_label[b] = conn_label[a]

    def draw_face(ax, fi, title, usable=True):
        face = faces_by_idx[fi]
        poly = _to2d(face, face.pts)
        fc = "#eef1f6" if usable else "#f3d9d9"
        ec = "#334" if usable else "#a55"
        ax.fill(*poly.T, facecolor=fc, edgecolor=ec, lw=1.6)
        ax.plot(*np.vstack([poly, poly[:1]]).T, color=ec, lw=1.6)
        for m in design.get(fi, []):
            xy = _to2d(face, [m.pos])[0]
            col = POLE_COLOR.get(m.pole, SLOT_COLOR)
            ax.add_patch(plt.Circle(xy, radius, color=col, alpha=0.85, zorder=3))
            lab = m.pole if m.pole else ""
            if lab:
                ax.text(*xy, lab, color="w", ha="center", va="center",
                        fontweight="bold", zorder=4)
        ax.set_aspect("equal"); ax.axis("off"); ax.margins(0.18)
        ax.set_title(title, fontsize=10, color=("#333" if usable else "#a33"))

    cell = 0
    for fi in usable:
        ax = fig.add_subplot(gs[cell // cols, cell % cols])
        draw_face(ax, fi, f"face {fi}  ({faces_by_idx[fi].n}-gon)\n{conn_label.get(fi,'')}")
        cell += 1
    for fi in unusable:
        ax = fig.add_subplot(gs[cell // cols, cell % cols])
        draw_face(ax, fi, f"face {fi}  ({faces_by_idx[fi].n}-gon)\nchiral \u2014 NO mate", usable=False)
        cell += 1

    if mode == "single_centered":
        sub = ("One centred pocket per usable face (grey). Insert magnets so that on each joint "
               "the two touching faces present OPPOSITE poles; alternate N/S between adjacent copies.")
        title = "Cylinder plan: one centred slot per usable face."
    else:
        sub = ("Two pockets per face: N (red) + S (blue). Partner-face slots are mate-transform "
               "images with poles swapped, so each joint self-aligns and attracts.")
        title = "Cylinder plan: N (red) + S (blue) per usable face."

    fig.suptitle(title, fontsize=12, y=0.99)
    fig.text(0.5, 0.01, sub, ha="center", fontsize=9, color="#444")
    fig.savefig(path, dpi=145, bbox_inches="tight")
    plt.close(fig)


def render_3d(mesh, path, views=((8, -8), (24, 52))):
    """Shaded multi-view render of a mesh (headless)."""
    def shade(m, base=np.array([0.58, 0.66, 0.80])):
        inten = 0.40 + 0.60 * np.clip(m.face_normals @ np.array([0.35, 0.45, 0.82]), 0, 1)
        return np.clip(base[None, :] * inten[:, None], 0, 1)

    fig = plt.figure(figsize=(6.5 * len(views), 6))
    for k, (elev, azim) in enumerate(views):
        ax = fig.add_subplot(1, len(views), k + 1, projection="3d")
        tris = mesh.vertices[mesh.faces]
        ax.add_collection3d(Poly3DCollection(tris, facecolors=shade(mesh), edgecolors="none"))
        v = mesh.vertices
        ax.set_xlim(v[:, 0].min(), v[:, 0].max())
        ax.set_ylim(v[:, 1].min(), v[:, 1].max())
        ax.set_zlim(v[:, 2].min(), v[:, 2].max())
        ax.set_box_aspect(np.array(mesh.bounding_box.extents))
        ax.view_init(elev=elev, azim=azim)
        ax.set_axis_off()
    fig.tight_layout()
    fig.savefig(path, dpi=140, bbox_inches="tight")
    plt.close(fig)
