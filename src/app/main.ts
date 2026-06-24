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
import { buildStick } from '@core/stick.ts';
import { buildTestPlate } from '@core/testplate.ts';
import { makeViewer3D } from '@display/viewer3d.ts';
import { makeFacesView } from '@display/facesView.ts';
import a31Obj from '../../input/A31_affine_associahedron.obj?raw';
import affineA3Obj from '../../input/AffineA3_22.obj?raw';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

await initManifold(() => wasmUrl);

// bundled models; the selector swaps between them (sliders keep their values).
const MODELS: { label: string; obj: string }[] = [
  { label: 'A31', obj: a31Obj },
  { label: 'Affine A3', obj: affineA3Obj },
];
let activeObj = MODELS[0].obj;

// ---- layout: two stacked full-bleed stages (one per tab) + control panel --
document.body.style.cssText = 'margin:0;overflow:hidden;font:13px system-ui,sans-serif';
const stage3d = document.createElement('div');
stage3d.style.cssText = 'position:fixed;inset:0';
const stageFaces = document.createElement('div');
stageFaces.style.cssText = 'position:fixed;inset:0;display:none';
const stagePlate = document.createElement('div');
stagePlate.style.cssText = 'position:fixed;inset:0;display:none';
document.body.append(stage3d, stageFaces, stagePlate);

const viewer = makeViewer3D(stage3d);
const faces = makeFacesView(stageFaces);
const plateViewer = makeViewer3D(stagePlate); // the second viewer (fit-test plate)

const panel = document.createElement('div');
panel.style.cssText =
  'position:fixed;top:16px;left:16px;background:rgba(255,255,255,0.97);color:#101014;' +
  'padding:14px 16px;border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.15);width:230px';
document.body.appendChild(panel);

const title = document.createElement('div');
title.style.cssText = 'font-weight:600;margin-bottom:8px';
title.textContent = 'Associahedron magnets';
panel.append(title);

// ---- model selector (which solid) -----------------------------------------
const modelCap = document.createElement('div');
modelCap.style.cssText = 'color:#667;margin:2px 0 4px';
modelCap.textContent = 'Model';
const modelRow = document.createElement('div');
modelRow.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
panel.append(modelCap, modelRow);

let currentModel = 0; // index into MODELS, or -1 for an uploaded custom OBJ
const modelBtns = MODELS.map((m, i) => {
  const b = document.createElement('button');
  b.textContent = m.label;
  b.style.cssText =
    'flex:1;padding:5px 0;border:1px solid #ccd;border-radius:6px;background:#fff;cursor:pointer;font:inherit;font-size:12px';
  b.onclick = () => selectModel(i);
  modelRow.append(b);
  return b;
});
function paintModel(): void {
  modelBtns.forEach((b, i) => {
    b.style.background = i === currentModel ? '#1d4ed8' : '#fff';
    b.style.color = i === currentModel ? '#fff' : '#101014';
  });
}
function selectModel(i: number): void {
  currentModel = i;
  activeObj = MODELS[i].obj;
  paintModel();
  void run(true).catch(reportError); // recenter; sliders keep their values
}
paintModel();

// ---- tab bar --------------------------------------------------------------
type Tab = '3d' | 'faces' | 'plate';
const tabBar = document.createElement('div');
tabBar.style.cssText = 'display:flex;gap:6px;margin-bottom:10px';
const tabBtns: Record<Tab, HTMLButtonElement> = {
  '3d': mkTab('3D', '3d'),
  faces: mkTab('Faces', 'faces'),
  plate: mkTab('Test plate', 'plate'),
};
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

let activeTab: Tab = '3d';
function setTab(name: Tab): void {
  activeTab = name;
  stage3d.style.display = name === '3d' ? 'block' : 'none';
  stageFaces.style.display = name === 'faces' ? 'block' : 'none';
  stagePlate.style.display = name === 'plate' ? 'block' : 'none';
  for (const t of ['3d', 'faces', 'plate'] as Tab[]) {
    tabBtns[t].style.background = t === name ? '#1d4ed8' : '#fff';
    tabBtns[t].style.color = t === name ? '#fff' : '#101014';
  }
  platePanel.style.display = name === 'plate' ? 'block' : 'none';
  // the just-shown stage may have had zero size while hidden; let the views
  // re-measure, repaint the faces canvas, and (re)build the plate on entry.
  window.dispatchEvent(new Event('resize'));
  if (name === 'faces' && lastCore) faces.update(lastCore);
  if (name === 'plate') void runPlate().catch(reportError);
  // the solid may have gone stale while we tuned shared sliders on the plate
  // tab; rebuild it when we come back to a view that shows it.
  if ((name === '3d' || name === 'faces') && solidDirty) void run().catch(reportError);
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

// The app's starting slider values. Kept separate from DEFAULT_PARAMS in the
// core, which stays pinned to the committed Python parity run.
const UI = { sizeMm: 70, radiusMm: 2.5, clearanceMm: 0.1, depthMm: 1.9, offsetMm: 8.0 };
const size = slider('Printed size', 30, 120, 1, UI.sizeMm);
const radius = slider('Magnet radius', 1, 6, 0.05, UI.radiusMm);
const clearance = slider('Clearance (slip fit)', 0, 0.5, 0.01, UI.clearanceMm);
const depth = slider('Pocket depth', 0.5, 8, 0.1, UI.depthMm);
const offset = slider('Pocket offset', 0, 15, 0.1, UI.offsetMm); // ± along the face axis

// ---- reference stick: an optional extra body added beside the solid ---------
// A long square bar with one magnet pocket in each end (same hole as the faces:
// radius + clearance + depth above), so you can mount a magnet on each end and
// keep a fixed N/S reference. `+` end = North, `−` end = South. Toggling it on
// drops it into the 3D view and the exported STL, sitting clear of the solid.
const stickToggle = document.createElement('label');
stickToggle.style.cssText = 'display:flex;align-items:center;gap:8px;margin:12px 0 2px;cursor:pointer';
const stickCheck = document.createElement('input');
stickCheck.type = 'checkbox';
const stickToggleText = document.createElement('span');
stickToggleText.textContent = 'Add reference stick';
stickToggle.append(stickCheck, stickToggleText);
panel.append(stickToggle);
const stickLen = slider('Stick length', 25, 120, 1, 55);

const readout = document.createElement('div');
readout.style.cssText = 'margin-top:8px;color:#445;line-height:1.5';
panel.append(readout);

// ---- test plate: a fit-test coupon shown in the second viewer ---------------
// Holes step across a clearance sweep (selectable below); each hole Ø = magnet Ø
// + clearance, plate thickness = pocket depth. Print it, find the hole that
// slip-fits, and set the main Clearance slider to that value.
// The fit-test grid: columns sweep diameter (clearance, starting at the main
// Clearance), rows sweep pocket depth (starting at the main Pocket depth). Both
// step up from there; each axis has its own step COUNT and step SIZE slider.
const platePanel = document.createElement('div');
platePanel.style.cssText = 'display:none;border-top:1px solid #e3e3ea;margin-top:10px;padding-top:8px';
const plateCap = document.createElement('div');
plateCap.style.cssText = 'color:#667;margin-bottom:2px';
plateCap.textContent = 'Fit-test grid';
platePanel.append(plateCap);

// slider local to the plate panel, with its own value formatter (counts show as
// plain integers, sizes in mm). Mirrors slider() but appends to platePanel.
function plateSlider(label: string, min: number, max: number, step: number, value: number, unit: string): HTMLInputElement {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:block;margin:8px 0';
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
  const sync = () => (val.textContent = unit ? `${Number(input.value).toFixed(2)} ${unit}` : String(Number(input.value)));
  sync();
  input.addEventListener('input', sync);
  wrap.append(head, input);
  platePanel.append(wrap);
  return input;
}

const diaCount = plateSlider('Diameter steps (columns)', 2, 12, 1, 6, '');
const diaStep = plateSlider('Clearance step', 0.01, 0.2, 0.01, 0.05, 'mm');
const depthCount = plateSlider('Depth steps (rows)', 2, 10, 1, 4, '');
const depthStep = plateSlider('Depth step', 0.2, 1.5, 0.05, 0.5, 'mm');

const plateReadout = document.createElement('div');
plateReadout.style.cssText = 'margin-top:6px;color:#445;line-height:1.5';
platePanel.append(plateReadout);
panel.append(platePanel);

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
let lastDrilledMesh: Mesh | null = null; // the solid alone (what the drill returns)
let lastMesh: Mesh | null = null; // what we show + export: solid, plus stick if on
let lastPlateMesh: Mesh | null = null; // the fit-test plate (second viewer / export)
let solidDirty = false; // shared sliders moved while on the plate tab → solid stale
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
    lastDrilledMesh = manifoldToMesh(drilled);
    await compose(recenter); // sets lastMesh + shows it (with the stick if toggled)
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
    solidDirty = false; // solid is now current with the sliders
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

// ---- compose: the displayed/exported mesh = drilled solid (+ stick if on) --
// Cheap relative to the drill, so the stick toggle/length rebuild only this, not
// the whole boolean. The stick is parked beside the solid (clear of it) so the
// single STL holds two disjoint printable bodies.
async function compose(recenter = false): Promise<void> {
  if (!lastDrilledMesh) return;
  let out = lastDrilledMesh;
  if (stickCheck.checked) {
    const man = await buildStick({
      magnetRadiusMm: Number(radius.value),
      clearanceMm: Number(clearance.value),
      pocketDepthMm: Number(depth.value),
      lengthMm: Number(stickLen.value),
    });
    out = mergeBeside(lastDrilledMesh, manifoldToMesh(man));
  }
  lastMesh = out;
  viewer.setMesh(out, recenter);
}

/** Merge `stick` into `solid`, shifted to sit just clear of the solid in +Y. */
function mergeBeside(solid: Mesh, stick: Mesh): Mesh {
  let maxY = -Infinity;
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const v of solid.vertices) {
    maxY = Math.max(maxY, v[1]);
    cx += v[0];
    cz += v[2];
    n++;
  }
  cx /= n;
  cz /= n;
  // stick is centred at origin; its half-extent in Y is half its square side.
  let halfY = 0;
  for (const v of stick.vertices) halfY = Math.max(halfY, Math.abs(v[1]));
  const dx = cx;
  const dy = maxY + 8 + halfY; // 8 mm gap so the bodies never touch
  const dz = cz;
  const base = solid.vertices.length;
  return {
    vertices: [
      ...solid.vertices,
      ...stick.vertices.map((v) => [v[0] + dx, v[1] + dy, v[2] + dz] as Mesh['vertices'][number]),
    ],
    tris: [...solid.tris, ...stick.tris.map((t) => [t[0] + base, t[1] + base, t[2] + base] as [number, number, number])],
  };
}

// ---- fit-test plate (independent of the polyhedron; its own viewer) --------
let plateRunning = false;
let platePending = false;

async function runPlate(): Promise<void> {
  if (plateRunning) {
    platePending = true;
    return;
  }
  plateRunning = true;
  try {
    const r = Number(radius.value);
    const nC = Math.round(Number(diaCount.value));
    const sC = Number(diaStep.value);
    const nR = Math.round(Number(depthCount.value));
    const sR = Number(depthStep.value);
    const c0 = Number(clearance.value); // first column = the main pocket clearance
    const d0 = Number(depth.value); // first row = the main pocket depth
    const clears = Array.from({ length: nC }, (_, i) => c0 + i * sC); // c0, c0+sC, …
    const depths = Array.from({ length: nR }, (_, i) => d0 + i * sR); // d0, d0+sR, …
    const man = await buildTestPlate({ magnetRadiusMm: r, clearancesMm: clears, depthsMm: depths });
    lastPlateMesh = manifoldToMesh(man);
    plateViewer.setMesh(lastPlateMesh, true);
    const cols = clears.map((c) => `+${c.toFixed(2)} → Ø ${(2 * r + c).toFixed(2)}`);
    plateReadout.innerHTML =
      `magnet Ø <b>${(2 * r).toFixed(2)}</b> mm · grid <b>${nC}×${nR}</b> (Ø × depth)<br>` +
      `columns (clearance → Ø): ${cols.join(', ')}<br>` +
      `rows (depth): ${depths.map((d) => d.toFixed(2)).join(', ')} mm`;
  } catch (e) {
    plateReadout.innerHTML = `<span style="color:#b00">${(e as Error).message}</span>`;
  } finally {
    plateRunning = false;
    if (platePending) {
      platePending = false;
      void runPlate().catch(reportError);
    }
  }
}

// Swap in a user OBJ; on any failure revert and keep the last good model.
async function loadObj(text: string, name: string): Promise<void> {
  const prev = activeObj;
  activeObj = text;
  try {
    await run(true); // recenter: it's a different model
    currentModel = -1; // a custom upload, not one of the built-ins
    paintModel();
  } catch (e) {
    activeObj = prev;
    reportError(new Error(`could not load ${name}: ${(e as Error).message}`));
  }
}

function schedule(job: () => Promise<void>): void {
  clearTimeout(timer);
  timer = window.setTimeout(() => void job().catch(reportError), 100);
}
// Shared geometry sliders rebuild whichever view is showing: the drilled solid
// on 3D/Faces, or the fit-test plate on its tab (the polyhedron then goes stale
// and is rebuilt when you switch back). The stick is cheap, so its length and
// toggle only recompose (no redrill); toggling recenters to frame both bodies.
function buildActive(): Promise<void> {
  if (activeTab === 'plate') {
    solidDirty = true;
    return runPlate();
  }
  return run();
}
for (const s of [size, radius, clearance, depth, offset]) s.addEventListener('input', () => schedule(buildActive));
stickLen.addEventListener('input', () => schedule(() => compose()));
stickCheck.addEventListener('change', () => void compose(true).catch(reportError));
// the four grid sliders only affect the plate
for (const s of [diaCount, diaStep, depthCount, depthStep]) s.addEventListener('input', () => schedule(() => runPlate()));

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
  const plate = activeTab === 'plate';
  const mesh = plate ? lastPlateMesh : lastMesh;
  if (!mesh) return;
  const blob = new Blob([meshToStlBinary(mesh)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = plate
    ? 'magnet_test_plate.stl'
    : stickCheck.checked
      ? 'associahedron_magnets_with_stick.stl'
      : 'associahedron_magnets.stl';
  a.click();
  URL.revokeObjectURL(a.href);
};
panel.append(dl);

setTab('3d');
await run().catch(reportError);
