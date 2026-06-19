"""
mating.py
=========
Decide which faces can be *glued face-to-face* on an identical copy, and compute
the rigid transform that performs the join.

Why this is non-trivial
-----------------------
Two faces being congruent is **not** enough to mate them. For a flush joint the
two faces meet with their outward normals opposed, which means (viewed from one
side) one polygon must coincide with the *mirror image* of the other. So:

* If face A and face A' are related by a **reflection** (opposite chirality) or A
  is self-mirror-symmetric, they CAN mate.
* If they are related only by a **rotation** and are chiral, they CANNOT mate --
  the mirror-shaped face they would need does not exist on an identical copy.

We detect this numerically: search reversed cyclic vertex correspondences (the
orientation flips because the normals oppose), run a *proper* (det=+1) Kabsch
fit, and accept a mate only when RMSD ~ 0 AND the normals end up anti-parallel.
"""

from __future__ import annotations
import numpy as np
from numpy.linalg import svd, det

from geometry import Face


def kabsch(A: np.ndarray, B: np.ndarray):
    """Best PROPER rigid motion (rotation R det=+1, translation t) mapping the
    ordered point set A onto B. Returns (R, t, rmsd)."""
    ca, cb = A.mean(0), B.mean(0)
    H = (A - ca).T @ (B - cb)
    U, S, Vt = svd(H)
    d = np.sign(det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    t = cb - R @ ca
    rmsd = float((((R @ A.T).T + t - B) ** 2).sum(1).mean() ** 0.5)
    return R, t, rmsd


def mate_transform(face_j: Face, face_i: Face):
    """Proper rigid motion (R, t) that lays ``face_j`` flush onto ``face_i``
    (centroids coincide, normals opposed, outlines aligned).

    Returns (R, t, rmsd, normal_dot). A clean mate has rmsd ~ 0 and
    normal_dot ~ -1. Returns None if the faces have different vertex counts.
    """
    A0 = face_j.pts[::-1]                       # reverse: opposing normals flip orientation
    B = face_i.pts
    if len(A0) != len(B):
        return None
    best = None
    for s in range(len(B)):
        R, t, r = kabsch(np.roll(A0, s, axis=0), B)
        if best is None or r < best[2]:
            nd = float((R @ face_j.normal) @ face_i.normal)
            best = (R, t, r, nd)
    return best


def flush_mate_graph(faces: list[Face], rmsd_tol: float = 1e-2):
    """For every face, the list of faces it can be glued flush against.

    Returns dict ``{face_idx: [mateable_face_idx, ...]}``. A face whose list is
    empty cannot participate in a magnetic face joint on an identical copy.
    """
    by_idx = {f.idx: f for f in faces}
    graph: dict[int, list[int]] = {}
    for i in faces:
        mates = []
        for j in faces:
            res = mate_transform(by_idx[j.idx], by_idx[i.idx])
            if res is None:
                continue
            _, _, rmsd, nd = res
            if rmsd < rmsd_tol and nd < -0.99:
                mates.append(j.idx)
        graph[i.idx] = sorted(mates)
    return graph


def derive_connections(graph: dict[int, list[int]]):
    """Turn the mate graph into a list of connections and the unusable faces.

    * faces with an empty mate list  -> ``unusable``
    * a face that only mates with itself -> self-connection ``(i, i)``
    * a congruent mateable pair {a, b}   -> connection ``(a, b)``
    * larger mateable components are chained pairwise (with a note)

    Returns ``(connections, unusable)``.
    """
    unusable = sorted(i for i, m in graph.items() if not m)

    # connected components over the "mates with" relation (ignoring unusable)
    remaining = set(i for i in graph if graph[i])
    comps = []
    while remaining:
        seed = next(iter(remaining))
        stack, comp = [seed], set()
        while stack:
            x = stack.pop()
            if x in comp:
                continue
            comp.add(x)
            for y in graph[x]:
                if y in remaining and y not in comp:
                    stack.append(y)
        remaining -= comp
        comps.append(sorted(comp))

    connections = []
    for comp in comps:
        if len(comp) == 1:
            connections.append((comp[0], comp[0]))          # self-mate
        elif len(comp) == 2:
            connections.append((comp[0], comp[1]))          # congruent pair
        else:
            for k in range(0, len(comp) - 1, 2):            # generic: pair up
                connections.append((comp[k], comp[k + 1]))
    return connections, unusable
