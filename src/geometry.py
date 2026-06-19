"""
geometry.py
===========
Load the polyhedral solid and turn each flat face into an ordered polygon with a
*congruence fingerprint*.

Key ideas
---------
* A "face" of the polyhedron is a maximal set of coplanar triangles in the mesh.
  trimesh exposes these as ``mesh.facets`` (groups of triangle indices) together
  with ``mesh.facets_normal`` and ``mesh.facets_area``.
* To compare faces for congruence we use the sorted multiset of *all pairwise
  vertex distances* of the polygon. Two polygons are congruent iff this multiset
  matches (a complete invariant for a point set up to isometry, including
  reflection). This is strictly stronger than comparing areas or edge lengths.
"""

from __future__ import annotations
from collections import Counter, defaultdict
from itertools import combinations
from dataclasses import dataclass, field

import numpy as np
import trimesh


@dataclass
class Face:
    idx: int                      # facet index in the mesh
    loop: list                    # ordered vertex indices forming the boundary
    pts: np.ndarray               # (n,3) ordered boundary vertices (world coords)
    n: int                        # number of sides
    area: float
    normal: np.ndarray            # outward unit normal
    centroid: np.ndarray          # (3,) polygon centroid
    edge_lengths: np.ndarray      # (n,) lengths around the loop
    fingerprint: tuple            # congruence invariant (rounded sorted distances)


def load_solid(path: str) -> trimesh.Trimesh:
    """Load an STL/OBJ/PLY... as a single watertight Trimesh."""
    mesh = trimesh.load(path, force="mesh")
    return mesh


def _ordered_boundary(mesh: trimesh.Trimesh, tris) -> list:
    """Return the boundary vertex loop (ordered) of a coplanar facet.

    Boundary edges are those that appear exactly once among the facet's
    triangles; we then walk them head-to-tail into a single cycle.
    """
    directed = []
    for f in mesh.faces[tris]:
        for a, b in [(f[0], f[1]), (f[1], f[2]), (f[2], f[0])]:
            directed.append((int(a), int(b)))
    undirected_count = Counter(tuple(sorted(e)) for e in directed)
    boundary = [e for e in directed if undirected_count[tuple(sorted(e))] == 1]

    nxt = {a: b for a, b in boundary}
    start = boundary[0][0]
    loop = [start]
    cur = nxt[start]
    while cur != start:
        loop.append(cur)
        cur = nxt[cur]
    return loop


def extract_faces(mesh: trimesh.Trimesh, ndigits: int = 3) -> list[Face]:
    """Build a Face for every coplanar facet of the mesh."""
    V = mesh.vertices
    faces: list[Face] = []
    for i, tris in enumerate(mesh.facets):
        loop = _ordered_boundary(mesh, tris)
        pts = V[loop]
        el = np.linalg.norm(np.roll(pts, -1, axis=0) - pts, axis=1)
        pairwise = sorted(
            round(float(np.linalg.norm(pts[a] - pts[b])), ndigits)
            for a, b in combinations(range(len(pts)), 2)
        )
        faces.append(
            Face(
                idx=i,
                loop=loop,
                pts=pts,
                n=len(loop),
                area=float(mesh.facets_area[i]),
                normal=np.asarray(mesh.facets_normal[i], dtype=float),
                centroid=pts.mean(axis=0),
                edge_lengths=np.round(el, ndigits),
                fingerprint=tuple(pairwise),
            )
        )
    return faces


def congruence_groups(faces: list[Face]) -> list[list[int]]:
    """Group face indices by congruence fingerprint.

    Returns a list of groups (each a list of face indices), sorted largest-first.
    """
    groups: dict[tuple, list[int]] = defaultdict(list)
    for f in faces:
        groups[f.fingerprint].append(f.idx)
    return sorted(groups.values(), key=lambda g: (-len(g), g[0]))
