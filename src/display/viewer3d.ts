/**
 * viewer3d.ts — the drilled-solid view: a Three.js scene with orbit controls
 * that shows one mesh and can swap it cheaply (setMesh) as the sliders re-drill.
 * Impure render boundary (three.js); the geometry it shows comes straight from
 * the core pipeline via meshToGeometry.
 *
 * Deliberately light: a hemisphere + key/fill lights and a flat-shaded standard
 * material, not the path-traced stage the sibling project uses for offline
 * renders. This view is for live tweaking, so it favours instant feedback.
 *
 * The mesh is recentred on the FIRST mesh's bounding-box centre and that centre
 * is reused for every later swap, so re-drilling (which barely moves the centre)
 * doesn't make the model jump under the orbit pivot.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mesh } from '@core/obj.ts';
import { meshToGeometry } from './meshGeometry.ts';

const BG = 0xf4f3ee; // off-white, matching the sibling project's theme

export interface Viewer3D {
  setMesh(mesh: Mesh, recenter?: boolean): void;
  dispose(): void;
}

export function makeViewer3D(container: HTMLElement): Viewer3D {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(BG);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    4000,
  );
  camera.position.set(130, 95, 150);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(1, 1.4, 1);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5);
  fill.position.set(-1, 0.3, -0.6);
  scene.add(fill);

  const material = new THREE.MeshStandardMaterial({
    color: 0x9fb0c8,
    roughness: 0.55,
    metalness: 0.05,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  let mesh: THREE.Mesh | null = null;
  let center: THREE.Vector3 | null = null;

  // recenter=true recomputes the orbit pivot (use when the model itself changes,
  // e.g. a freshly uploaded OBJ); otherwise the first mesh's centre is reused so
  // re-drilling the same model doesn't make it jump.
  function setMesh(m: Mesh, recenter = false): void {
    const geo = meshToGeometry(m);
    if (!center || recenter) {
      geo.computeBoundingBox();
      center = new THREE.Vector3();
      geo.boundingBox!.getCenter(center);
    }
    geo.translate(-center.x, -center.y, -center.z);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    } else {
      mesh = new THREE.Mesh(geo, material);
      scene.add(mesh);
    }
  }

  function onResize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  let raf = 0;
  function loop(): void {
    raf = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }
  loop();

  function dispose(): void {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setMesh, dispose };
}
