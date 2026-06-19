"""
magnets.py
==========
Place the magnet pocket(s) on every usable face and verify that each connection
lines up when two copies are brought together.

Two design MODES are supported (set in run_all.py):

* ``single_centered`` (default) -- ONE pocket per face, at the face centre.
  You insert the magnet with whichever polarity a given joint needs ("opposite
  magnets for adjacent copies"). Because mating makes the two faces' centres
  coincide, the two centred magnets always meet. Simplest; fewer magnets.
  Trade-offs: copies are not interchangeable (you plan polarity -- trivial for
  chains/trees, impossible only for odd closed loops), and a single centred
  magnet lets the joint rotate freely.

* ``dual_genderless`` -- TWO pockets per face, one N-out and one S-out. The
  partner face's magnets are the mate-transform images with poles swapped, so at
  any matching face every N meets an S: the joint attracts and self-registers
  regardless of which copy is which, and the wrong orientation repels (keying).
  More magnets, but every copy is identical and assembly needs no planning.

Either way, faces with no flush mate (the chiral pentagons 0 & 1 here) get no
pocket -- that is a geometric fact, independent of the magnet scheme.
"""

from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
import numpy as np

from geometry import Face
from mating import mate_transform

OPPOSITE = {"N": "S", "S": "N"}


@dataclass
class Magnet:
    face: int
    pos: np.ndarray            # world-space centre of the pocket opening (on the face)
    pole: Optional[str]        # 'N'/'S' (dual mode) or None (single mode: chosen at assembly)


# --------------------------------------------------------------------------- #
# in-plane frame helpers (used by the dual-magnet mode)
# --------------------------------------------------------------------------- #
def face_frame(face: Face):
    """Return (centroid, normal, u, v): an in-plane orthonormal frame where
    ``u`` is the polygon's principal (longest) axis."""
    pts = face.pts
    c = pts.mean(0)
    nrm = face.normal
    Q = pts - c
    Q = Q - np.outer(Q @ nrm, nrm)
    w, Vv = np.linalg.eigh(Q.T @ Q)
    u = Vv[:, int(np.argmax(w))]
    u = u - (u @ nrm) * nrm
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    return c, nrm, u, v


def _pair_on(face: Face, offset: float, along: str = "u"):
    c, nrm, u, v = face_frame(face)
    d = u if along == "u" else v
    return [Magnet(face.idx, c + offset * d, "N"),
            Magnet(face.idx, c - offset * d, "S")]


# --------------------------------------------------------------------------- #
# placement
# --------------------------------------------------------------------------- #
def place_magnets(faces_by_idx, connections, offset: float, mode: str = "single_centered"):
    """Build the magnet design: ``{face_idx: [Magnet, ...]}``."""
    if mode == "single_centered":
        design: dict[int, list[Magnet]] = {}
        for i, j in connections:
            for f in {i, j}:
                design[f] = [Magnet(f, faces_by_idx[f].centroid.copy(), None)]
        return design

    if mode == "dual_genderless":
        design = {}
        for i, j in connections:
            if i == j:                                   # self-mating face
                chosen = None
                for along in ("u", "v"):
                    mags = _pair_on(faces_by_idx[i], offset, along)
                    R, t, _, _ = mate_transform(faces_by_idx[i], faces_by_idx[i])
                    good = True
                    for m in mags:
                        landed = R @ m.pos + t
                        partner = min(mags, key=lambda x: np.linalg.norm(x.pos - landed))
                        if np.linalg.norm(partner.pos - landed) > 1e-6 or partner.pole == m.pole:
                            good = False
                    if good:
                        chosen = mags
                        break
                design[i] = chosen if chosen else _pair_on(faces_by_idx[i], offset, "u")
            else:                                        # congruent pair
                mags_i = _pair_on(faces_by_idx[i], offset, "u")
                R, t, _, _ = mate_transform(faces_by_idx[j], faces_by_idx[i])
                Rinv = R.T
                design[i] = mags_i
                design[j] = [Magnet(j, Rinv @ (m.pos - t), OPPOSITE[m.pole]) for m in mags_i]
        return design

    raise ValueError(f"unknown mode {mode!r}")


# --------------------------------------------------------------------------- #
# verification
# --------------------------------------------------------------------------- #
def verify(design, faces_by_idx, connections, mode: str = "single_centered", tol: float = 1e-6):
    """Simulate every connection by laying copy-2's face onto copy-1's face.

    * single_centered: the two centred pockets must coincide.
    * dual_genderless: every magnet must meet an opposite-pole magnet.

    Returns ``(all_ok, report)`` with report = [(i, j, ok), ...].
    """
    report, all_ok = [], True
    for i, j in connections:
        R, t, _, _ = mate_transform(faces_by_idx[j], faces_by_idx[i])
        ok = True
        if mode == "single_centered":
            landed = R @ design[j][0].pos + t
            if np.linalg.norm(landed - design[i][0].pos) > tol:
                ok = False
        else:
            for m in design[i]:
                dists = [(np.linalg.norm((R @ p.pos + t) - m.pos), p.pole) for p in design[j]]
                dist, pole = min(dists, key=lambda x: x[0])
                if dist > tol or pole == m.pole:
                    ok = False
        report.append((i, j, ok))
        all_ok &= ok
    return all_ok, report


def fit_check(design, faces_by_idx, radius: float, margin: float = 0.3):
    """Clearance from each pocket centre to its face boundary.
    Returns ``(all_fit, {face: min_clearance})``."""
    def pt_seg(p, a, b):
        ab = b - a
        s = np.clip((p - a) @ ab / (ab @ ab), 0, 1)
        return np.linalg.norm(p - (a + s * ab))

    report, all_fit = {}, True
    for f, mags in design.items():
        pts = faces_by_idx[f].pts
        clear = min(
            min(pt_seg(m.pos, pts[k], pts[(k + 1) % len(pts)]) for k in range(len(pts)))
            for m in mags
        )
        report[f] = clear
        if clear < radius + margin:
            all_fit = False
    return all_fit, report
