/**
 * main.ts — the app. One computed state feeds two IN-PAGE tabs (no new-window
 * handoff like the sibling moduli→inspector pair): "3D" shows the drilled solid,
 * "Faces" shows the per-face pocket plan. Moving a slider re-runs the core +
 * drill (debounced) and refreshes BOTH views.
 *
 * The pocket RADIUS and DEPTH sliders map onto the run_all parameter model
 * without disturbing it: pocket diameter = magnet + clearance and pocket depth =
 * thickness + extra, so we back out magnetDiaMm / magnetThickMm from the slider
 * values while holding clearance/extra at their defaults. The remaining knobs
 * (mode, printed size, clearance) land in Step 5.
 */
import { runCore, DEFAULT_PARAMS, type Params, type CoreResult } from '@core/pipeline.ts';
import { drillSolid, manifoldToMesh, meshToStlBinary, initManifold } from '@core/drill.ts';
import type { Mesh } from '@core/obj.ts';
import type { Mode } from '@core/magnets.ts';
import { makeViewer3D } from '@display/viewer3d.ts';
import { makeFacesView } from '@display/facesView.ts';
import objText from '../../input/A31_affine_associahedron.obj?raw';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

await initManifold(() => wasmUrl);

// ---- layout: two stacked full-bleed stages (one per tab) + control panel --
document.body.style.cssText = 'margin:0;overflow:hidden;font:13px system-ui,sans-serif';
const stage3d = document.createElement('div');
stage3d.style.cssText = 'position:fixed;inset:0';
const stageFaces = document.createElement('div');
stageFaces.style.cssText = 'position:fixed;inset:0;display:none';
document.body.append(stage3d, stageFaces);

const viewer = makeViewer3D(stage3d);
const faces = makeFacesView(stageFaces);

const panel = document.createElement('div');
panel.style.cssText =
  'position:fixed;top:16px;left:16px;background:rgba(255,255,255,0.97);color:#101014;' +
  'padding:14px 16px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.15);width:230px';
document.body.appendChild(panel);

const title = document.createElement('div');
title.style.cssText = 'font-weight:600;margin-bottom:8px';
title.textContent = 'Associahedron magnets';
panel.append(title);

// ---- tab bar --------------------------------------------------------------
type Tab = '3d' | 'faces';
const tabBar = document.createElement('div');
tabBar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
const tabBtns: Record<Tab, HTMLButtonElement> = { '3d': mkTab('3D', '3d'), faces: mkTab('Faces', 'faces') };
panel.append(tabBar);

function mkTab(label: string, name: Tab): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    'flex:1;padding:5px 0;border:1px solid #ccd;border-radius:6px;background:#fff;cursor:pointer;font:inherit';
  b.onclick = () => setTab(name);
  tabBar.append(b);
  return b;
}

function setTab(name: Tab): void {
  stage3d.style.display = name === '3d' ? 'block' : 'none';
  stageFaces.style.display = name === 'faces' ? 'block' : 'none';
  for (const t of ['3d', 'faces'] as Tab[]) {
    tabBtns[t].style.background = t === name ? '#1d4ed8' : '#fff';
    tabBtns[t].style.color = t === name ? '#fff' : '#101014';
  }
  // the just-shown stage may have had zero size while hidden; let both views
  // re-measure, and repaint the faces canvas from the last computed state.
  window.dispatchEvent(new Event('resize'));
  if (name === 'faces' && lastCore) faces.update(lastCore);
}

// Dual genderless only: two pockets (N + S) per face, partner slots are the
// mate-transform images with poles swapped, so any matching face attracts in
// any orientation. (single_centered still lives in the core as the parity
// anchor against the committed Python run, but the app never uses it.)
const mode: Mode = 'dual_genderless';

// ---- sliders --------------------------------------------------------------
function slider(label: string, min: number, max: number, step: number, value: number): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:block;margin:10px 0';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:4px';
  const name = document.createElement('span');
  name.textContent = label;
  const val = document.createElement('span');
  val.style.fontVariantNumeric = 'tabular-nums';
  head.append(name, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.style.width = '100%';
  const sync = () => (val.textContent = `${Number(input.value).toFixed(2)} mm`);
  sync();
  input.addEventListener('input', sync);
  wrap.append(head, input);
  panel.append(wrap);
  return input;
}

const size = slider('Printed size', 30, 120, 1, DEFAULT_PARAMS.targetLongestMm);
const radius = slider('Magnet radius', 1, 6, 0.05, DEFAULT_PARAMS.magnetDiaMm / 2);
const clearance = slider('Clearance (slip fit)', 0, 0.5, 0.01, DEFAULT_PARAMS.magnetClearMm);
const depth = slider('Pocket depth', 0.5, 8, 0.1, DEFAULT_PARAMS.magnetThickMm + DEFAULT_PARAMS.depthExtraMm);
const offset = slider('Pocket offset', 0, 15, 0.1, DEFAULT_PARAMS.offsetMm); // ± along the face axis

const readout = document.createElement('div');
readout.style.cssText = 'margin-top:8px;color:#445;line-height:1.5';
panel.append(readout);

// Pocket diameter = magnet + clearance; pocket depth = thickness + extra. We
// expose the magnet radius, clearance, and final depth, and hold `extra` at its
// default — so the drilled hole is 2·radius + clearance wide and `depth` deep.
function paramsNow(): Params {
  return {
    ...DEFAULT_PARAMS,
    mode,
    targetLongestMm: Number(size.value),
    magnetDiaMm: 2 * Number(radius.value),
    magnetClearMm: Number(clearance.value),
    magnetThickMm: Number(depth.value) - DEFAULT_PARAMS.depthExtraMm,
    offsetMm: Number(offset.value),
  };
}

// ---- debounced rebuild (coalesce slider spam; never overlap two drills) ---
let lastCore: CoreResult | null = null;
let lastMesh: Mesh | null = null;
let activeObj = objText; // swapped out when the user loads their own OBJ
let timer = 0;
let running = false;
let pending = false;

async function run(recenter = false): Promise<void> {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  try {
    const core = runCore(activeObj, paramsNow());
    if (core.faces.length < 4) throw new Error('not a polyhedron (fewer than 4 flat faces)');
    lastCore = core;
    faces.update(core); // cheap, independent of the boolean drill
    const drilled = await drillSolid(
      core.mesh,
      core.byIdx,
      core.design,
      core.pocketDiameterMm,
      core.pocketDepthMm,
    );
    const vol = drilled.volume();
    if (!(vol > 0)) throw new Error('not a closed, manifold solid');
    lastMesh = manifoldToMesh(drilled);
    viewer.setMesh(lastMesh, recenter);
    const pockets = [...core.design.values()].reduce((s, m) => s + m.length, 0);
    const bare = core.unusable.length
      ? ` · ${core.unusable.length} face(s) unmatched (left bare)`
      : '';
    const warn = core.verify.allOk
      ? ''
      : ' · <span style="color:#b00">⚠ genderless N/S impossible on some faces</span>';
    readout.innerHTML =
      `pocket Ø <b>${core.pocketDiameterMm.toFixed(2)}</b> · depth <b>${core.pocketDepthMm.toFixed(2)}</b> mm<br>` +
      `pockets <b>${pockets}</b> · fits <b>${core.fit.allFit ? 'yes' : 'NO'}</b>${bare}<br>` +
      `volume <b>${vol.toFixed(0)}</b> mm³${warn}`;
  } finally {
    running = false;
    if (pending) {
      pending = false;
      void run().catch(reportError);
    }
  }
}

function reportError(e: unknown): void {
  readout.innerHTML = `<span style="color:#b00">${(e as Error).message}</span>`;
}

// Swap in a user OBJ; on any failure revert and keep the last good model.
async function loadObj(text: string, name: string): Promise<void> {
  const prev = activeObj;
  activeObj = text;
  try {
    await run(true); // recenter: it's a different model
  } catch (e) {
    activeObj = prev;
    reportError(new Error(`could not load ${name}: ${(e as Error).message}`));
  }
}

function schedule(): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void run().catch(reportError), 100);
}
for (const s of [size, radius, clearance, depth, offset]) s.addEventListener('input', schedule);

// ---- load your own OBJ (convex, flat-faced, watertight polyhedron) --------
const loadBtn = document.createElement('button');
loadBtn.textContent = 'Load OBJ…';
loadBtn.style.cssText =
  'margin-top:12px;width:100%;padding:7px 0;border:1px solid #ccd;border-radius:6px;background:#fff;color:#101014;cursor:pointer;font:inherit';
const fileInput = document.createElement('input');
fileInput.type = 'file';
fileInput.accept = '.obj';
fileInput.style.display = 'none';
loadBtn.onclick = () => fileInput.click();
fileInput.onchange = async () => {
  const f = fileInput.files?.[0];
  if (!f) return;
  await loadObj(await f.text(), f.name);
  fileInput.value = ''; // let the same file be re-loaded
};
panel.append(loadBtn, fileInput);
const loadHint = document.createElement('div');
loadHint.style.cssText = 'color:#889;font-size:11px;margin-top:4px';
loadHint.textContent = 'convex · flat-faced · watertight';
panel.append(loadHint);

// ---- download the drilled solid as binary STL (the printable deliverable) -
const dl = document.createElement('button');
dl.textContent = 'Download STL';
dl.style.cssText =
  'margin-top:12px;width:100%;padding:7px 0;border:0;border-radius:6px;background:#101014;color:#fff;cursor:pointer;font:inherit';
dl.onclick = () => {
  if (!lastMesh) return;
  const blob = new Blob([meshToStlBinary(lastMesh)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'associahedron_magnets.stl';
  a.click();
  URL.revokeObjectURL(a.href);
};
panel.append(dl);

setTab('3d');
await run().catch(reportError);
