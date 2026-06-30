/**
 * facesView.ts — the 2D companion to the 3D view, a port of illustrate.plan_figure.
 * One cell per face: the polygon flattened into its own plane, with the magnet
 * pocket centre(s) drawn at the pocket radius. Single-centred slots are neutral
 * grey (you pick polarity at assembly); dual slots are red (N) / blue (S);
 * chiral faces with no flush mate are drawn red and labelled. Impure render
 * boundary (canvas 2D).
 *
 * A face is flattened exactly as the Python: faceFrame gives an in-plane frame
 * (centroid c, axes u, v) and every point p maps to ((p−c)·u, (p−c)·v), so the
 * pocket dots sit where the cylinders are actually cut.
 */
import { dot, sub, type Vec3 } from '@core/vec3.ts';
import { faceFrame } from '@core/magnets.ts';
import type { Face } from '@core/geometry.ts';
import type { CoreResult } from '@core/pipeline.ts';

const BG = '#f4f3ee';
const POLE_COLOR: Record<string, string> = { N: '#d33', S: '#36c' };
const SLOT_COLOR = '#777';

export interface FacesView {
  update(core: CoreResult): void;
  dispose(): void;
}

export interface FacesViewOpts {
  onToggleFace?: (faceIdx: number) => void; // a usable face cell was clicked
}

export function makeFacesView(container: HTMLElement, opts: FacesViewOpts = {}): FacesView {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let core: CoreResult | null = null;
  // hit-test rects from the last draw, a face→partner lookup, and the hovered
  // face (so we can light a cell and its matched partner together).
  let cells: { idx: number; x: number; y: number; w: number; h: number }[] = [];
  let partner = new Map<number, number>();
  let hoverIdx: number | null = null;

  const connLabel = (c: CoreResult): Map<number, string> => {
    const m = new Map<number, string>();
    for (const [a, b] of c.connections) {
      // self-mating faces have a geometrically forced pair (see facesView click
      // handling) — flag them as fixed so the locked cell isn't read as broken.
      const label = a === b ? `self-mate ${a}↔${a} · fixed` : `pair ${a}↔${b}`;
      m.set(a, label);
      m.set(b, label);
    }
    return m;
  };

  function drawFace(c: CoreResult, f: Face, usable: boolean, label: string, x: number, y: number, w: number, h: number): void {
    const ff = faceFrame(f);
    const to2d = (p: Vec3): [number, number] => [dot(sub(p, ff.c), ff.u), dot(sub(p, ff.c), ff.v)];
    const poly = f.pts.map(to2d);
    const mags = (c.design.get(f.idx) ?? []).map((mg) => ({ xy: to2d(mg.pos), pole: mg.pole }));
    const R = c.pocketDiameterMm / 2;

    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const [px, py] of poly) {
      minx = Math.min(minx, px); maxx = Math.max(maxx, px);
      miny = Math.min(miny, py); maxy = Math.max(maxy, py);
    }

    const padTop = 30, pad = 14;
    const availW = w - 2 * pad, availH = h - pad - padTop;
    const s = Math.min(availW / ((maxx - minx) || 1), availH / ((maxy - miny) || 1));
    const drawW = (maxx - minx) * s, drawH = (maxy - miny) * s;
    const ox = x + pad + (availW - drawW) / 2;
    const oy = y + padTop + (availH - drawH) / 2;
    const X = (p: [number, number]) => ox + (p[0] - minx) * s;
    const Y = (p: [number, number]) => oy + (maxy - p[1]) * s; // flip: canvas y grows down

    ctx.beginPath();
    poly.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.closePath();
    ctx.fillStyle = usable ? '#eef1f6' : '#f3d9d9';
    ctx.strokeStyle = usable ? '#334' : '#a55';
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();

    for (const mg of mags) {
      ctx.beginPath();
      ctx.arc(X(mg.xy), Y(mg.xy), Math.max(2, R * s), 0, 2 * Math.PI);
      ctx.fillStyle = mg.pole ? POLE_COLOR[mg.pole] : SLOT_COLOR;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      if (mg.pole) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(mg.pole, X(mg.xy), Y(mg.xy));
      }
    }

    ctx.fillStyle = usable ? '#333' : '#a33';
    ctx.font = '12px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`face ${f.idx} (${f.n}-gon)`, x + w / 2, y + 6);
    ctx.fillText(label, x + w / 2, y + 20);
  }

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const W = container.clientWidth, H = container.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (!core) return;
    const c = core;

    const labels = connLabel(c);
    const usable = c.faces.filter((f) => !c.unusable.includes(f.idx));
    const unus = c.faces.filter((f) => c.unusable.includes(f.idx));
    const ordered = [...usable, ...unus];
    const n = ordered.length;
    const cols = Math.min(n, Math.max(2, Math.floor(W / 240)));
    const rows = Math.ceil(n / cols);
    const cw = W / cols, ch = H / rows;
    cells = [];
    const lit = new Set<number>();
    if (hoverIdx != null) {
      lit.add(hoverIdx);
      const p = partner.get(hoverIdx);
      if (p != null) lit.add(p);
    }
    ordered.forEach((f, k) => {
      const x = (k % cols) * cw, y = Math.floor(k / cols) * ch;
      const isUsable = !c.unusable.includes(f.idx);
      cells.push({ idx: f.idx, x, y, w: cw, h: ch });
      if (lit.has(f.idx)) {
        ctx.save();
        ctx.fillStyle = f.idx === hoverIdx ? 'rgba(29,78,216,0.10)' : 'rgba(29,78,216,0.05)';
        ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
        ctx.strokeStyle = '#1d4ed8';
        ctx.lineWidth = f.idx === hoverIdx ? 2 : 1;
        ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3);
        ctx.restore();
      }
      const label = isUsable ? (labels.get(f.idx) ?? '') : 'chiral — no mate';
      drawFace(c, f, isUsable, label, x, y, cw, ch);
    });
  }

  function onResize(): void {
    draw();
  }
  window.addEventListener('resize', onResize);

  // Map a mouse event to the face cell under it (CSS pixels: the ctx is scaled by
  // dpr, but layout/getBoundingClientRect are in CSS pixels, as are the cells).
  function cellAt(ev: MouseEvent): { idx: number; interactive: boolean } | null {
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    for (const cell of cells)
      if (mx >= cell.x && mx < cell.x + cell.w && my >= cell.y && my < cell.y + cell.h) {
        const usable = core ? !core.unusable.includes(cell.idx) : false;
        // a self-mating face (partner === itself) has a geometrically forced
        // pair, so it can't be cycled — treat it as non-interactive.
        const interactive = usable && partner.get(cell.idx) !== cell.idx;
        return { idx: cell.idx, interactive };
      }
    return null;
  }
  function onClick(ev: MouseEvent): void {
    const hit = cellAt(ev);
    if (hit?.interactive) opts.onToggleFace?.(hit.idx);
  }
  function onMove(ev: MouseEvent): void {
    const hit = cellAt(ev);
    const idx = hit?.interactive ? hit.idx : null;
    canvas.style.cursor = idx != null ? 'pointer' : 'default';
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      draw();
    }
  }
  function onLeave(): void {
    canvas.style.cursor = 'default';
    if (hoverIdx != null) {
      hoverIdx = null;
      draw();
    }
  }
  canvas.addEventListener('click', onClick);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);

  return {
    update(c: CoreResult): void {
      core = c;
      partner = new Map();
      for (const [a, b] of c.connections) {
        partner.set(a, b);
        partner.set(b, a);
      }
      draw();
    },
    dispose(): void {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.remove();
    },
  };
}
