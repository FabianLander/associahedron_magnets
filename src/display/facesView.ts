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

export function makeFacesView(container: HTMLElement): FacesView {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  let core: CoreResult | null = null;

  const connLabel = (c: CoreResult): Map<number, string> => {
    const m = new Map<number, string>();
    for (const [a, b] of c.connections) {
      const label = a === b ? `self-mate ${a}↔${a}` : `pair ${a}↔${b}`;
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
    ordered.forEach((f, k) => {
      const isUsable = !c.unusable.includes(f.idx);
      const label = isUsable ? (labels.get(f.idx) ?? '') : 'chiral — no mate';
      drawFace(c, f, isUsable, label, (k % cols) * cw, Math.floor(k / cols) * ch, cw, ch);
    });
  }

  function onResize(): void {
    draw();
  }
  window.addEventListener('resize', onResize);

  return {
    update(c: CoreResult): void {
      core = c;
      draw();
    },
    dispose(): void {
      window.removeEventListener('resize', onResize);
      canvas.remove();
    },
  };
}
