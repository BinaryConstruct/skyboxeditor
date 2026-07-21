/**
 * Skybox preview: camera at the origin looking out, layers composited on a
 * sky sphere around it, in file order (0 = furthest back), each with its own
 * src/dest blend factors — mirroring the original's layered scene.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EXRExporter } from 'three/addons/exporters/EXRExporter.js';
import { halfBufferToFloat } from '../export/hdr';
import type { StarData } from '../export/perLayer';
import { filterBillboards, generateBillboards, type Billboards } from '../core/billboards';
import { kelvinToRgb } from '../core/blackbody';
import { generateGalaxyStars } from '../core/galaxy';
import type { Layer } from '../core/layers';
import { billboardsFromCatalog, parseStarCsv, type CatalogStar } from '../core/starCatalog';
import type { CubeMask } from '../core/placement';
import { generatePoints, generatePointsMasked, generateStarSizes } from '../core/points';
import { MsvcRng } from '../core/rng';
import { applyBlend } from './blend';
import { loadFlareTexture } from './flareTextures';
import { bakePlanetGen, bakeSunGen, GEN_SIZE } from '../gen/generators';
import { ditherCanvas, windowSpriteEdges } from '../gen/genCommon';
import { buildBlackHoleObject } from './blackHoleLayer';
import { NoiseCubemap, noiseParamsFromLayer, noiseParamsFromMask, noiseParamsFromVolumetric } from './NoiseCubemap';
import { EQUIRECT_FRAG, EQUIRECT_VERT, POINTS_FRAG, POINTS_VERT, SKY_FRAG, SKY_VERT } from './noiseGlsl';

const SKY_RADIUS = 50;
const MASK_SIZE = 512; // "should be a good approximation" — same as original

// Bundled HYG-style star catalog. Any layer dataFile maps here for now;
// user-uploaded catalogs arrive with the project-bundle work (M8).
let catalogPromise: Promise<CatalogStar[]> | null = null;
function loadBundledCatalog(): Promise<CatalogStar[]> {
  catalogPromise ??= fetch(`${import.meta.env.BASE_URL}media/stars.csv`)
    .then((r) => r.text())
    .then(parseStarCsv)
    .catch((err) => {
      console.warn('star catalog failed to load', err);
      return [];
    });
  return catalogPromise;
}

interface LayerObject {
  group: THREE.Group;
  /** resolves when async content (catalog fetch, textures) is attached */
  ready?: Promise<void>;
  /**
   * Distortion layers (black hole) capture the assembled scene here — called
   * after every scene (re)build, and in the bake path before rendering.
   */
  prepare?: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, pointScale?: number) => void;
  /** direct-manipulation hook: quad layers that can be grabbed and re-placed */
  placeable?: { mesh: THREE.Mesh; place: (lonDeg: number, latDeg: number) => void };
  /** App-level visibility (eye toggle) — combined with the PCG backdrop flag */
  appVisible?: boolean;
  dispose(): void;
}

/** lon/lat (deg) -> unit direction, the app-wide sky convention. */
function lonLatToDir(lonDeg: number, latDeg: number): THREE.Vector3 {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.cos(lon),
  );
}

/** unit direction -> lon/lat (deg), inverse of lonLatToDir. */
function dirToLonLat(dir: THREE.Vector3): { lonDeg: number; latDeg: number } {
  const latDeg = (Math.asin(Math.min(1, Math.max(-1, dir.y))) * 180) / Math.PI;
  const lonDeg = (Math.atan2(dir.x, -dir.z) * 180) / Math.PI;
  return { lonDeg, latDeg };
}

/**
 * Placement basis for a galaxy disc on the *unit* sky sphere: center is the
 * unit direction, (u, v, w) the spun/tilted disc frame. Shared by the render
 * path (scaled by SKY_RADIUS) and the data export (sky radius = 1) so the
 * exported cloud is the rendered cloud by construction.
 */
function galaxyBasis(layer: Extract<Layer, { type: 'galaxy' }>): {
  center: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; w: THREE.Vector3;
} {
  const lon = (layer.dirLonDeg * Math.PI) / 180;
  const lat = (layer.dirLatDeg * Math.PI) / 180;
  const n = new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.cos(lon),
  );
  const ref = Math.abs(n.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(ref, n).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1);

  // spin in the tangent plane
  const spin = (layer.spinDeg * Math.PI) / 180;
  const u = e1.clone().multiplyScalar(Math.cos(spin)).addScaledVector(e2, Math.sin(spin));
  const vTan = e1.clone().multiplyScalar(-Math.sin(spin)).addScaledVector(e2, Math.cos(spin));

  // tilt the disc away from face-on around the u axis
  const tilt = (layer.tiltDeg * Math.PI) / 180;
  const v = vTan.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(n, Math.sin(tilt));
  const w = n.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(vTan, -Math.sin(tilt));

  return { center: n, u, v, w };
}

export class PreviewScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private layerObjects: LayerObject[] = [];
  private grid: THREE.LineSegments | null = null;
  /** Discrete FOV zoom levels (zoomed in -> out); wheel steps through them. */
  private static readonly ZOOM_LEVELS = [30, 45, 60, 80, 100];
  private zoomIndex = 3;
  private onWheel: (e: WheelEvent) => void;
  private wheelTarget: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    // alpha:false is load-bearing: layer blend factors (e.g. the src_alpha
    // mask nebulas) write alpha<1 into the framebuffer, and a transparent
    // canvas composites that against the page as box-shaped artifacts around
    // billboards. The original rendered to an opaque window; so do we.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    // raw byte parity with the original — no color management
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(80, 1, 0.1, SKY_RADIUS * 4);
    // slightly off-origin so OrbitControls has a direction to orbit
    this.camera.position.set(0, 0, 0.01);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableZoom = false; // wheel handled below (discrete FOV steps)
    this.controls.enablePan = false;
    this.controls.rotateSpeed = -0.35; // inverted: we are inside the sky sphere
    this.controls.enableDamping = true;
    // right-drag ALWAYS pans the view — it can never grab a sprite (the
    // sprite-drag path below only reacts to the left button)
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.onContextMenu = (e: Event) => e.preventDefault();
    canvas.addEventListener('contextmenu', this.onContextMenu);

    // direct manipulation: grab a placeable quad and drag it on the sphere
    this.onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        // 3rd+ fingers during a pinch are ignored outright and hidden from
        // OrbitControls (which, like the pinch fingers, never saw them land)
        if (this.pinch) {
          this.pinchExtra.add(e.pointerId);
          e.stopImmediatePropagation();
          return;
        }
        this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // second finger = pinch zoom: cancel any grab, freeze OrbitControls
        // rotation by hiding this and all further pinch events from it
        if (this.touchPts.size === 2) {
          if (this.dragIndex !== null) this.endDrag(false);
          const [a, b] = [...this.touchPts.values()];
          this.pinch = {
            startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
            startFov: this.camera.fov,
          };
          e.stopImmediatePropagation();
          return;
        }
      }
      if (e.button !== 0 || this.dragIndex !== null) return;
      // scene lock: drags always pan the view, quads can't be grabbed
      const hit = this.sceneLocked ? null : this.pickPlaceable(e);
      if (hit === null) return;
      this.dragIndex = hit;
      this.dragPointerId = e.pointerId;
      this.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      e.stopImmediatePropagation(); // keep OrbitControls from starting a rotate
    };
    this.onPointerMove = (e: PointerEvent) => {
      if (this.pinchExtra.has(e.pointerId)) {
        e.stopPropagation();
        return;
      }
      if (this.pinch && e.pointerType === 'touch' && this.touchPts.has(e.pointerId)) {
        this.touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.touchPts.size === 2) {
          const [a, b] = [...this.touchPts.values()];
          const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
          this.setFov(this.pinch.startFov * (this.pinch.startDist / dist));
        }
        // swallow every move until all fingers lift so OrbitControls (whose
        // rotate anchor is stale from before the pinch) can't jump the view
        e.stopPropagation();
        return;
      }
      if (this.dragIndex === null || e.pointerId !== this.dragPointerId) return;
      const obj = this.layerObjects[this.dragIndex];
      if (!obj?.placeable) return;
      const dir = this.pointerRayDir(e);
      const { lonDeg, latDeg } = dirToLonLat(dir);
      this.dragLonLat = { lonDeg, latDeg };
      obj.placeable.place(lonDeg, latDeg);
    };
    this.onPointerUp = (e: PointerEvent) => {
      if (this.releasePinchPointer(e)) return;
      if (this.dragIndex === null || e.pointerId !== this.dragPointerId) return;
      this.endDrag(true);
    };
    // any way the pointer can die must end the drag, or navigation locks up
    this.onPointerCancel = (e: PointerEvent) => {
      if (this.releasePinchPointer(e)) return;
      if (this.dragIndex === null || e.pointerId !== this.dragPointerId) return;
      this.endDrag(false);
    };
    // capture phase so a grab wins over OrbitControls' own pointerdown
    canvas.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('lostpointercapture', this.onPointerCancel);

    this.wheelTarget = canvas;
    this.onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const levels = PreviewScene.ZOOM_LEVELS;
      const step = e.deltaY > 0 ? 1 : -1; // wheel down = zoom out
      this.zoomIndex = Math.min(levels.length - 1, Math.max(0, this.zoomIndex + step));
      this.setFov(levels[this.zoomIndex]);
    };
    canvas.addEventListener('wheel', this.onWheel, { passive: false });

    this.scene.background = new THREE.Color(0x000000);

    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });

    // debug handle for diagnostics/tests
    (window as unknown as Record<string, unknown>).__preview = this;
  }

  /** Rebuild displayed objects from the layer stack (file order = draw order). */
  setLayers(layers: Layer[]): void {
    for (const obj of this.layerObjects) {
      this.scene.remove(obj.group);
      obj.dispose();
    }
    this.layerObjects = [];

    layers.forEach((layer, index) => {
      const obj = this.buildLayer(layer, index);
      obj.appVisible = layer.visible !== false;
      obj.group.visible = obj.appVisible && !this.skyHidden;
      this.layerObjects.push(obj);
      this.scene.add(obj.group);
    });
    this.applyVisibility();
    this.runPrepares();
  }

  /** Rebuild a single (dirty) layer in place, preserving its visibility. */
  updateLayer(index: number, layer: Layer): void {
    const old = this.layerObjects[index];
    if (!old) return;
    const visible = layer.visible !== false;
    this.scene.remove(old.group);
    old.dispose();

    const obj = this.buildLayer(layer, index);
    obj.appVisible = visible;
    obj.group.visible = visible && !this.skyHidden;
    this.layerObjects[index] = obj;
    this.scene.add(obj.group);
    this.runPrepares();
  }

  private prepareGen = 0;

  // ------------------------------------------------- direct manipulation
  /** fired when a drag ends: the App commits lon/lat to the layer state */
  onLayerPlaced?: (index: number, lonDeg: number, latDeg: number) => void;
  /**
   * fired when a moved drag is cancelled (pinch started, scene locked,
   * pointer died): the App should rebuild the layer from its stored state
   * so the quad snaps back instead of lingering at the uncommitted spot
   */
  onLayerDragCancelled?: (index: number) => void;
  private raycaster = new THREE.Raycaster();
  private sceneLocked = false;
  /** live touch-pointer positions on the canvas (pinch-zoom tracking) */
  private touchPts = new Map<number, { x: number; y: number }>();
  private pinch: { startDist: number; startFov: number } | null = null;
  /** extra fingers that landed mid-pinch: fully ignored until they lift */
  private pinchExtra = new Set<number>();
  private dragIndex: number | null = null;
  private dragPointerId: number | null = null;
  private dragLonLat: { lonDeg: number; latDeg: number } | null = null;
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;
  private onPointerCancel: (e: PointerEvent) => void;
  private onContextMenu!: (e: Event) => void;

  /**
   * Scene lock: viewport drags always pan the view; placeable quads can't
   * be grabbed until unlocked.
   */
  setSceneLocked(locked: boolean): void {
    this.sceneLocked = locked;
    if (locked && this.dragIndex !== null) this.endDrag(false);
  }

  /** Continuous FOV zoom (pinch + wheel), clamped to the wheel's range. */
  private setFov(fov: number): void {
    const levels = PreviewScene.ZOOM_LEVELS;
    this.camera.fov = Math.min(levels[levels.length - 1], Math.max(levels[0], fov));
    this.camera.updateProjectionMatrix();
    // keep drag speed proportional to the visible field
    this.controls.rotateSpeed = -0.35 * (this.camera.fov / 80);
    this.applyStarZoom();
  }

  /**
   * Pointer-up/cancel bookkeeping for pinch zoom. Returns true when the
   * event belonged to an active pinch. The event still propagates —
   * OrbitControls must see its tracked finger lift to clean up (it never
   * saw the second finger, and moves stay swallowed until all fingers are
   * up, so its stale rotate anchor can't jump the view). The pinch ends
   * once the last finger lifts, snapping the wheel's zoom index to the
   * nearest discrete level so wheel zoom continues from the pinched FOV.
   */
  private releasePinchPointer(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false;
    // ignored 3rd+ finger lifting: swallow it — OrbitControls never saw it
    // land, and processing its up would corrupt its single-pointer state
    if (this.pinchExtra.has(e.pointerId)) {
      this.pinchExtra.delete(e.pointerId);
      e.stopPropagation();
      return true;
    }
    // losing pointer capture (e.g. endDrag releasing it when a pinch begins)
    // does NOT mean the finger lifted — keep tracking it
    if (e.type === 'lostpointercapture') return false;
    const inPinch = this.pinch !== null && this.touchPts.has(e.pointerId);
    this.touchPts.delete(e.pointerId);
    if (!inPinch) return false;
    if (this.touchPts.size === 0) {
      this.pinch = null;
      const levels = PreviewScene.ZOOM_LEVELS;
      this.zoomIndex = levels.reduce(
        (best, fov, i) =>
          Math.abs(fov - this.camera.fov) < Math.abs(levels[best] - this.camera.fov) ? i : best,
        0,
      );
    }
    return true;
  }

  /** Single cleanup path for every way a drag can end. */
  private endDrag(commit: boolean): void {
    const index = this.dragIndex;
    const pointerId = this.dragPointerId;
    this.dragIndex = null;
    this.dragPointerId = null;
    this.controls.enabled = true;
    const canvas = this.renderer.domElement;
    if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    canvas.style.cursor = '';
    if (index !== null && this.dragLonLat) {
      if (commit) this.onLayerPlaced?.(index, this.dragLonLat.lonDeg, this.dragLonLat.latDeg);
      else this.onLayerDragCancelled?.(index);
    }
    this.dragLonLat = null;
  }

  /** world direction of the pointer ray (camera sits at the origin) */
  private pointerRayDir(e: PointerEvent): THREE.Vector3 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.direction.clone().normalize();
  }

  /** index of the placeable quad under the pointer, or null */
  private pickPlaceable(e: PointerEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const candidates: Array<{ mesh: THREE.Mesh; index: number }> = [];
    this.layerObjects.forEach((o, i) => {
      if (o.placeable && o.group.visible && o.placeable.mesh.visible) {
        candidates.push({ mesh: o.placeable.mesh, index: i });
      }
    });
    if (!candidates.length) return null;
    const hits = this.raycaster.intersectObjects(candidates.map((c) => c.mesh), false);
    if (!hits.length) return null;
    const hitMesh = hits[0].object;
    return candidates.find((c) => c.mesh === hitMesh)?.index ?? null;
  }

  /** camera view center as lon/lat — where new objects get placed */
  viewCenter(): { lonDeg: number; latDeg: number } {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return dirToLonLat(dir);
  }

  /** sky lon/lat under a client-space point (drag-and-drop placement) */
  lonLatAtClient(clientX: number, clientY: number): { lonDeg: number; latDeg: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return dirToLonLat(this.raycaster.ray.direction.clone().normalize());
  }

  // --------------------------------------------------- PCG viewport preview
  private pcgQuad: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; geo: THREE.PlaneGeometry; tex: THREE.CanvasTexture } | null = null;
  private skyHidden = false;

  private applyVisibility(): void {
    for (const obj of this.layerObjects) {
      obj.group.visible = (obj.appVisible ?? true) && !this.skyHidden;
    }
  }

  /**
   * Show a generator bake full-size in the main viewport (PCG tab). Pass
   * null when leaving the tab; the quad sits at the current view center and
   * follows it on each update.
   */
  setPcgPreview(canvas: HTMLCanvasElement | null, occludes = false): void {
    if (!canvas) {
      if (this.pcgQuad) {
        this.scene.remove(this.pcgQuad.mesh);
        this.pcgQuad.geo.dispose();
        this.pcgQuad.mat.dispose();
        this.pcgQuad.tex.dispose();
        this.pcgQuad = null;
      }
      this.skyHidden = false;
      this.applyVisibility();
      return;
    }
    if (!this.pcgQuad) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.NoColorSpace;
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      applyBlend(mat, 'one', 'one'); // additive: black sprite bg vanishes
      const side = SKY_RADIUS * 0.9;
      const geo = new THREE.PlaneGeometry(side, side);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 10000;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.pcgQuad = { mesh, mat, geo, tex };
    } else {
      this.pcgQuad.tex.dispose();
      this.pcgQuad.tex = new THREE.CanvasTexture(canvas);
      this.pcgQuad.tex.colorSpace = THREE.NoColorSpace;
      this.pcgQuad.mat.map = this.pcgQuad.tex;
      this.pcgQuad.mat.needsUpdate = true;
    }
    // solid bodies preview with their disc alpha (premultiplied-over);
    // everything else stays additive so black backgrounds vanish
    applyBlend(this.pcgQuad.mat, 'one', occludes ? 'one_minus_src_alpha' : 'one');
    const { lonDeg, latDeg } = this.viewCenter();
    this.pcgQuad.mesh.position.copy(lonLatToDir(lonDeg, latDeg)).multiplyScalar(SKY_RADIUS * 0.9);
    this.pcgQuad.mesh.lookAt(0, 0, 0);
  }

  /** PCG backdrop toggle: preview over the skybox (true) or black (false). */
  setPcgBackdrop(showSky: boolean): void {
    this.skyHidden = !showSky;
    this.applyVisibility();
  }

  /** Re-capture backgrounds for distortion layers after any scene change. */
  private runPrepares(): void {
    if (!this.layerObjects.some((o) => o.prepare)) return;
    this.captureAll();
    // async content (catalog billboards, flare textures) lands later —
    // re-capture once it does, unless the scene was rebuilt in the meantime
    const gen = ++this.prepareGen;
    const pending = this.layerObjects.map((o) => o.ready).filter(Boolean);
    if (pending.length) {
      void Promise.all(pending).then(() => {
        if (gen === this.prepareGen) this.captureAll();
      });
    }
  }

  /**
   * One capture pass for all distortion layers. Captures must always see the
   * sky (even while the PCG backdrop hides it for the user) and must never
   * see the PCG preview quad (it's UI, not sky).
   */
  private captureAll(): void {
    const pcgVisible = this.pcgQuad?.mesh.visible ?? false;
    if (this.pcgQuad) this.pcgQuad.mesh.visible = false;
    if (this.skyHidden) {
      for (const o of this.layerObjects) o.group.visible = o.appVisible ?? true;
    }
    // point stars render in device pixels — rescale them so their apparent
    // size in the capture matches the live view it's composited into
    const pointScale =
      (this.bhCaptureSize * (this.camera.fov / 90)) / Math.max(1, this.renderer.domElement.height);
    PreviewScene.prepareObjects(this.layerObjects, this.renderer, this.scene, pointScale);
    if (this.skyHidden) this.applyVisibility();
    if (this.pcgQuad) this.pcgQuad.mesh.visible = pcgVisible;
  }

  /**
   * A distortion layer must capture only the layers BELOW it: hide everything
   * above (restoring visibility after), so foreground layers aren't bent and
   * double-drawn, and stacked black holes resolve in stack order.
   */
  private static prepareObjects(
    objs: LayerObject[],
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    pointScale = 1,
  ): void {
    objs.forEach((obj, i) => {
      if (!obj.prepare) return;
      const above = objs.slice(i + 1).map((o) => [o.group, o.group.visible] as const);
      for (const [g] of above) g.visible = false;
      obj.prepare(renderer, scene, pointScale);
      for (const [g, v] of above) g.visible = v;
    });
  }

  private buildLayer(layer: Layer, index: number): LayerObject {
    switch (layer.type) {
      case 'noise': return this.buildNoiseLayer(layer, index);
      case 'points': return this.buildPointsLayer(layer, index);
      case 'billboards': return this.buildBillboardsLayer(layer, index);
      case 'volumetric': return this.buildVolumetricLayer(layer, index);
      case 'galaxy': return this.buildGalaxyLayer(layer, index);
      case 'sun': return this.buildSunLayer(layer, index);
      case 'planet': return this.buildPlanetLayer(layer, index);
      case 'blackhole': return buildBlackHoleObject(layer, index, SKY_RADIUS, this.bhCaptureSize);
      case 'sprite': return this.buildSpriteLayer(layer, index);
    }
  }

  /** Lens background-capture resolution; raised during high-res bakes. */
  private bhCaptureSize = 1024;

  /**
   * Place a texture as a world quad pinned to the sky sphere: spherical
   * placement, angular size, aspect stretch, in-plane rotation. Returns a
   * placeable LayerObject so the quad can be grabbed and dragged.
   */
  private spriteQuad(
    tex: THREE.Texture,
    layer: { sourceBlendFactor: Layer['sourceBlendFactor']; destBlendFactor: Layer['destBlendFactor']; locked?: boolean },
    index: number,
    opts: { lonDeg: number; latDeg: number; halfSize: number; aspect?: number; rotationDeg?: number },
  ): LayerObject {
    const material = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    applyBlend(material, layer.sourceBlendFactor, layer.destBlendFactor);

    const side = opts.halfSize * SKY_RADIUS * 2;
    const geometry = new THREE.PlaneGeometry(side * (opts.aspect ?? 1), side);
    const mesh = new THREE.Mesh(geometry, material);
    const place = (lonDeg: number, latDeg: number) => {
      mesh.position.copy(lonLatToDir(lonDeg, latDeg)).multiplyScalar(SKY_RADIUS * 0.96);
      mesh.lookAt(0, 0, 0);
      if (opts.rotationDeg) mesh.rotateZ((opts.rotationDeg * Math.PI) / 180);
    };
    place(opts.lonDeg, opts.latDeg);
    mesh.renderOrder = index;
    mesh.frustumCulled = false;

    const group = new THREE.Group();
    group.add(mesh);
    return {
      group,
      placeable: layer.locked ? undefined : { mesh, place },
      dispose: () => {
        geometry.dispose();
        material.dispose();
        tex.dispose();
      },
    };
  }

  /**
   * Invisible drag/pick proxy quad for layers whose visual geometry isn't a
   * single raycastable mesh (galaxy particle clouds, the black-hole lens).
   */
  static pickProxy(center: THREE.Vector3, halfSize: number): { mesh: THREE.Mesh; dispose: () => void } {
    const geo = new THREE.PlaneGeometry(halfSize * 2, halfSize * 2);
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    mesh.lookAt(0, 0, 0);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    return { mesh, dispose: () => { geo.dispose(); mat.dispose(); } };
  }

  /** Generic sprite layer: any texture id pinned to the sky. */
  private buildSpriteLayer(layer: Extract<Layer, { type: 'sprite' }>, index: number): LayerObject {
    // placeholder 1x1 texture until the real one resolves, so the quad is
    // placeable immediately and never flashes untextured white
    const tex = new THREE.Texture();
    const obj = this.spriteQuad(tex, layer, index, {
      lonDeg: layer.dirLonDeg,
      latDeg: layer.dirLatDeg,
      halfSize: layer.apparentSize,
      aspect: layer.aspect,
      rotationDeg: layer.rotationDeg,
    });
    const mesh = obj.placeable!.mesh;
    mesh.visible = false;
    const ready = layer.texture
      ? loadFlareTexture(layer.texture).then((loaded) => {
          if (loaded) {
            (mesh.material as THREE.MeshBasicMaterial).map = loaded;
            (mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
            mesh.visible = true;
          }
        })
      : undefined;
    return { ...obj, ready };
  }

  /**
   * Opaque-body alpha for a premultiplied (flattened-on-black) body sprite:
   * fully opaque inside the disc (with the same ~1.5px AA band the bakers
   * use), luminance-alpha outside for corona/rings/atmosphere. Solid bodies
   * must occlude the sky behind them — only their surroundings are additive.
   */
  private static bodyAlpha(canvas: HTMLCanvasElement, discRadiusPx: number): HTMLCanvasElement {
    const ctx = canvas.getContext('2d')!;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const c = canvas.width / 2;
    const aa = 1.5;
    for (let py = 0; py < canvas.height; py++) {
      for (let px = 0; px < canvas.width; px++) {
        const o = (py * canvas.width + px) * 4;
        const d = Math.hypot(px - c, py - c);
        const cover = d <= discRadiusPx - aa ? 1
          : d >= discRadiusPx + aa ? 0
          : (discRadiusPx + aa - d) / (2 * aa);
        const lum = Math.max(img.data[o], img.data[o + 1], img.data[o + 2]);
        img.data[o + 3] = Math.max(Math.round(255 * cover), lum);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  /** Positional sun: the sun-generator sprite billboarded on the sky. */
  private buildSunLayer(layer: Extract<Layer, { type: 'sun' }>, index: number): LayerObject {
    const DISC_RADIUS = 0.16;
    // large quads magnify the bake into visible texels — scale the bake res
    const res = layer.apparentSize > 0.4 ? 1024 : layer.apparentSize > 0.2 ? 768 : GEN_SIZE;
    const canvas = PreviewScene.bodyAlpha(
      ditherCanvas(windowSpriteEdges(bakeSunGen({
        seed: layer.seed,
        kelvin: layer.kelvin,
        discRadius: DISC_RADIUS,
        limbDarkening: layer.limbDarkening,
        granulation: layer.granulation,
        corona: layer.corona,
        coronaExtent: layer.coronaExtent,
        prominences: layer.prominences,
        glow: layer.glow,
      }, res))),
      DISC_RADIUS * res,
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    return this.spriteQuad(tex, layer, index, {
      lonDeg: layer.dirLonDeg,
      latDeg: layer.dirLatDeg,
      halfSize: layer.apparentSize,
      rotationDeg: layer.rotationDeg,
    });
  }

  /**
   * Positional planet: the planet-generator sprite with a reconstructed
   * alpha channel (opaque disc, luminance-alpha rings/atmosphere) so the
   * default one / 1-src_alpha blend occludes the sky behind the body.
   */
  private buildPlanetLayer(layer: Extract<Layer, { type: 'planet' }>, index: number): LayerObject {
    // the positional layer keeps flat single-ring fields (JSON-schema
    // friendly); map them onto the workbench baker's ring-set array
    const hasRings = layer.ringAmount > 0 && layer.ringOuter > layer.ringInner;
    const res = layer.apparentSize > 0.4 ? 1024 : layer.apparentSize > 0.2 ? 768 : GEN_SIZE;
    const canvas = bakePlanetGen({
      seed: layer.seed,
      baseColor: layer.baseColor,
      secondColor: layer.secondColor,
      noiseScale: layer.noiseScale,
      octaves: layer.octaves,
      banding: layer.banding,
      lightAngleDeg: layer.lightAngleDeg,
      atmosphereColor: layer.atmosphereColor,
      atmosphereWidth: layer.atmosphereWidth,
      rings: hasRings ? [{
        inner: layer.ringInner,
        outer: layer.ringOuter,
        rotationDeg: 0,
        tiltDeg: layer.ringTiltDeg,
        opacity: layer.ringAmount,
        color: layer.ringColor,
        bandSeed: layer.seed,
      }] : [],
    }, res);
    const discR = (hasRings ? 0.47 / layer.ringOuter : 0.42) * res;
    PreviewScene.bodyAlpha(ditherCanvas(windowSpriteEdges(canvas)), discR);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.NoColorSpace;
    return this.spriteQuad(tex, layer, index, {
      lonDeg: layer.dirLonDeg,
      latDeg: layer.dirLatDeg,
      halfSize: layer.apparentSize,
      rotationDeg: layer.rotationDeg,
    });
  }

  /** Hero galaxy: oriented spiral star-particle cloud + additive core glow. */
  private buildGalaxyLayer(layer: Extract<Layer, { type: 'galaxy' }>, index: number): LayerObject {
    const stars = generateGalaxyStars(layer);

    const { center: nUnit, u, v, w } = galaxyBasis(layer);
    const Rg = layer.apparentSize * SKY_RADIUS;
    const center = nUnit.clone().multiplyScalar(SKY_RADIUS);

    const positions = new Float32Array(stars.count * 3);
    for (let i = 0; i < stars.count; i++) {
      const x = stars.positions[i * 3];
      const y = stars.positions[i * 3 + 1];
      const z = stars.positions[i * 3 + 2];
      positions[i * 3] = center.x + (x * u.x + y * v.x + z * w.x) * Rg;
      positions[i * 3 + 1] = center.y + (x * u.y + y * v.y + z * w.y) * Rg;
      positions[i * 3 + 2] = center.z + (x * u.z + y * v.z + z * w.z) * Rg;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(stars.colors, 4));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(stars.sizes, 1));

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: { sizeScale: { value: this.starZoomFactor() } },
    });
    material.userData.baseSize = 1;
    applyBlend(material, layer.sourceBlendFactor, layer.destBlendFactor);

    const points = new THREE.Points(geometry, material);
    points.renderOrder = index;
    points.frustumCulled = false;

    const group = new THREE.Group();
    group.add(points);

    // additive core glow quad
    let glowMat: THREE.MeshBasicMaterial | null = null;
    let glowGeo: THREE.PlaneGeometry | null = null;
    if (layer.coreGlow > 0) {
      const bulge = kelvinToRgb(layer.bulgeKelvin);
      glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(
          bulge.r * layer.coreGlow,
          bulge.g * layer.coreGlow,
          bulge.b * layer.coreGlow,
        ),
        // the disc basis points +Z away from the origin, so a single-sided
        // plane is backface-culled from inside the sky — the "no core" bug
        side: THREE.DoubleSide,
      });
      applyBlend(glowMat, 'one', 'one');
      // The bulge is an oblate spheroid (star squash 1 : 0.82 : 0.5); its
      // on-sky silhouette is an ellipse whose minor axis shrinks with tilt.
      // Face the glow toward the viewer (origin) on the in-plane tangent basis
      // and squash it to that silhouette, so the core reads as a squashed
      // sphere at any tilt. Orienting it in the disc plane (basis u,v,w)
      // instead makes it go edge-on and collapse into a flat bar when tilted.
      const vTan = new THREE.Vector3().crossVectors(nUnit, u).normalize();
      const tilt = (layer.tiltDeg * Math.PI) / 180;
      const glowAspect = Math.hypot(0.82 * Math.cos(tilt), 0.5 * Math.sin(tilt));
      const glowSize = layer.bulgeSize * 3.2 * Rg;
      glowGeo = new THREE.PlaneGeometry(glowSize, glowSize * glowAspect);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.copy(center);
      glow.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, vTan, nUnit));
      glow.renderOrder = index;
      glow.visible = false;
      const mat = glowMat;
      void loadFlareTexture('proc:point').then((tex) => {
        if (tex) {
          mat.map = tex;
          mat.needsUpdate = true;
          glow.visible = true;
        }
      });
      group.add(glow);
    }

    // non-star particles: bright HII nebula clumps (additive) and dark dust
    // clouds (darkening quads, blend zero / 1-src_alpha) — rendered as
    // merged billboard quads through the flare-quad path
    const blobDisposers: Array<() => void> = [];
    const attachBlobs = (
      blobs: import('../core/galaxy').GalaxyBlobs | undefined,
      texture: string,
      blend: [Layer['sourceBlendFactor'], Layer['destBlendFactor']],
      order: number,
      seedSalt: number,
    ) => {
      if (!blobs || !blobs.count) return;
      const positions = new Float32Array(blobs.count * 3);
      const bSizes = new Float32Array(blobs.count);
      for (let i = 0; i < blobs.count; i++) {
        const x = blobs.positions[i * 3];
        const y = blobs.positions[i * 3 + 1];
        const z = blobs.positions[i * 3 + 2];
        // unit-disc -> world -> unit sky direction (blobs hug the sphere)
        const wx = center.x + (x * u.x + y * v.x + z * w.x) * Rg;
        const wy = center.y + (x * u.y + y * v.y + z * w.y) * Rg;
        const wz = center.z + (x * u.z + y * v.z + z * w.z) * Rg;
        const len = Math.hypot(wx, wy, wz) || 1;
        positions[i * 3] = wx / len;
        positions[i * 3 + 1] = wy / len;
        positions[i * 3 + 2] = wz / len;
        bSizes[i] = blobs.sizes[i] * layer.apparentSize;
      }
      const fake = {
        seed: (layer.seed + seedSalt) >>> 0,
        texture,
        sourceBlendFactor: blend[0],
        destBlendFactor: blend[1],
        randomRotation: true,
        aspectJitter: 0.45,
      } as Extract<Layer, { type: 'billboards' }>;
      const built = this.buildFlareQuads(
        { positions, sizes: bSizes, colors: blobs.colors, count: blobs.count },
        fake,
        index,
      );
      built.mesh.renderOrder = index + order;
      group.add(built.mesh);
      blobDisposers.push(built.dispose);
    };
    // dust darkens first, HII glows on top of it
    attachBlobs(stars.dust, 'proc:dust-blob', ['zero', 'one_minus_src_alpha'], 0.02, 0xd05);
    attachBlobs(stars.nebulae, 'proc:point', ['one', 'one'], 0.04, 0x11eb);

    // drag support: rotating the whole group about the origin re-aims the
    // world-baked star cloud without regenerating it; an invisible proxy
    // quad at the disc makes the cloud grabbable
    const dir0 = nUnit.clone();
    const proxy = PreviewScene.pickProxy(center, Rg);
    group.add(proxy.mesh);
    const place = (lonDeg: number, latDeg: number) => {
      group.quaternion.setFromUnitVectors(dir0, lonLatToDir(lonDeg, latDeg));
    };

    return {
      group,
      placeable: layer.locked ? undefined : { mesh: proxy.mesh, place },
      dispose: () => {
        geometry.dispose();
        material.dispose();
        glowGeo?.dispose();
        glowMat?.dispose();
        proxy.dispose();
        for (const d of blobDisposers) d();
      },
    };
  }

  /** Volumetric nebulas bake through the same cubemap path, raymarch shader. */
  private buildVolumetricLayer(layer: Extract<Layer, { type: 'volumetric' }>, index: number): LayerObject {
    const cubemap = new NoiseCubemap(Math.max(4, layer.previewTextureSize), 'half', 'volumetric');
    cubemap.render(this.renderer, noiseParamsFromVolumetric(layer));

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      uniforms: { cubeMap: { value: cubemap.texture } },
    });
    applyBlend(material, layer.sourceBlendFactor, layer.destBlendFactor);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(SKY_RADIUS * 2, SKY_RADIUS * 2, SKY_RADIUS * 2),
      material,
    );
    mesh.renderOrder = index;

    const group = new THREE.Group();
    group.add(mesh);
    return {
      group,
      dispose: () => {
        mesh.geometry.dispose();
        material.dispose();
        cubemap.dispose();
      },
    };
  }

  setLayerVisible(index: number, visible: boolean): void {
    const obj = this.layerObjects[index];
    if (obj) {
      obj.appVisible = visible;
      obj.group.visible = visible && !this.skyHidden;
    }
    this.runPrepares();
  }

  /**
   * Lat/lon reference geosphere (editor aid only — never part of layer
   * rendering, so exports are unaffected unless an export option opts in).
   */
  setGridVisible(visible: boolean): void {
    if (!this.grid && visible) {
      const R = SKY_RADIUS * 0.98;
      const pts: number[] = [];
      const add = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        for (const [lat, lon] of [[lat1, lon1], [lat2, lon2]]) {
          const phi = (lat * Math.PI) / 180;
          const theta = (lon * Math.PI) / 180;
          pts.push(
            R * Math.cos(phi) * Math.cos(theta),
            R * Math.sin(phi),
            R * Math.cos(phi) * Math.sin(theta),
          );
        }
      };
      for (let lon = 0; lon < 360; lon += 15) {
        for (let lat = -90; lat < 90; lat += 4) add(lat, lon, lat + 4, lon);
      }
      for (let lat = -75; lat <= 75; lat += 15) {
        for (let lon = 0; lon < 360; lon += 4) add(lat, lon, lat, lon + 4);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const mat = new THREE.LineBasicMaterial({
        color: 0x5a6a9a,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        depthWrite: false,
      });
      this.grid = new THREE.LineSegments(geo, mat);
      this.grid.renderOrder = 9999;
      this.grid.frustumCulled = false;
      this.scene.add(this.grid);
    }
    if (this.grid) this.grid.visible = visible;
  }

  /** Pixel-size stars scale with zoom so they grow as the view narrows. */
  private starZoomFactor(): number {
    return 80 / this.camera.fov;
  }

  private applyStarZoom(): void {
    const factor = this.starZoomFactor();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Points) {
        (o.material as THREE.ShaderMaterial).uniforms.sizeScale.value = factor;
      }
    });
  }

  /** Bake a layer's noise mask cubemap and read it back for CPU sampling. */
  private bakeMask(layer: Parameters<typeof noiseParamsFromMask>[0]): CubeMask {
    const cubemap = new NoiseCubemap(MASK_SIZE, 'byte');
    cubemap.render(this.renderer, noiseParamsFromMask(layer));
    const faces = cubemap.readFaces(this.renderer);
    cubemap.dispose();
    return { size: MASK_SIZE, faces };
  }

  private buildNoiseLayer(layer: Extract<Layer, { type: 'noise' }>, index: number): LayerObject {
    const cubemap = new NoiseCubemap(Math.max(4, layer.previewTextureSize));
    cubemap.render(this.renderer, noiseParamsFromLayer(layer));

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      uniforms: { cubeMap: { value: cubemap.texture } },
    });
    applyBlend(material, layer.sourceBlendFactor, layer.destBlendFactor);

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(SKY_RADIUS * 2, SKY_RADIUS * 2, SKY_RADIUS * 2),
      material,
    );
    mesh.renderOrder = index;

    const group = new THREE.Group();
    group.add(mesh);
    return {
      group,
      dispose: () => {
        mesh.geometry.dispose();
        material.dispose();
        cubemap.dispose();
      },
    };
  }

  private buildPointsLayer(layer: Extract<Layer, { type: 'points' }>, index: number): LayerObject {
    const stars = layer.maskEnabled
      ? generatePointsMasked(layer, this.bakeMask(layer))
      : generatePoints(layer);
    const count = stars.positions.length / 3;

    const positions = new Float32Array(stars.positions.length);
    for (let i = 0; i < positions.length; i++) {
      positions[i] = stars.positions[i] * SKY_RADIUS;
    }

    // per-star sizes when a range is set; uniform legacy size otherwise
    const sizes = generateStarSizes(layer, count)
      ?? new Float32Array(count).fill(Math.max(1, layer.pointSize));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(stars.colors, 4));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: { sizeScale: { value: this.starZoomFactor() } },
    });
    applyBlend(material, layer.sourceBlendFactor, layer.destBlendFactor);

    const points = new THREE.Points(geometry, material);
    points.renderOrder = index;
    points.frustumCulled = false;

    const group = new THREE.Group();
    group.add(points);
    return {
      group,
      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    };
  }

  /**
   * Billboards as true world-space quads facing the origin (one merged
   * geometry, one draw call). Unlike screen-space sprites this matches Ogre's
   * accurate-facing billboards: quads stretch with perspective at the edges
   * of a wide field of view. With a dataFile set, positions/colors come from
   * the bundled HYG star catalog instead of procedural placement.
   */
  private buildBillboardsLayer(layer: Extract<Layer, { type: 'billboards' }>, index: number): LayerObject {
    const group = new THREE.Group();
    let disposed = false;
    const disposers: Array<() => void> = [];

    const attach = (flares: Billboards) => {
      if (disposed) return;
      // mixed texture set: split the batch per texture, one quad mesh each
      const mix = layer.textureMix;
      if (flares.texIndex && mix && mix.length >= 2) {
        mix.forEach((texture, t) => {
          const subset = filterBillboards(flares, (i) => flares.texIndex![i] === t);
          if (!subset.count) return;
          const built = this.buildFlareQuads(subset, { ...layer, texture }, index);
          group.add(built.mesh);
          disposers.push(built.dispose);
        });
        return;
      }
      const built = this.buildFlareQuads(flares, layer, index);
      group.add(built.mesh);
      disposers.push(built.dispose);
    };

    let ready: Promise<void> | undefined;
    if (layer.dataFile) {
      ready = loadBundledCatalog().then((stars) => attach(billboardsFromCatalog(layer, stars)));
    } else {
      attach(generateBillboards(layer, layer.maskEnabled ? this.bakeMask(layer) : undefined));
    }

    return {
      group,
      ready,
      dispose: () => {
        disposed = true;
        for (const d of disposers) d();
      },
    };
  }

  private buildFlareQuads(
    flares: Billboards,
    layer: Extract<Layer, { type: 'billboards' }>,
    index: number,
  ): { mesh: THREE.Mesh; dispose: () => void } {
    const count = flares.count;
    const positions = new Float32Array(count * 4 * 3);
    const colors = new Float32Array(count * 4 * 4);
    const uvs = new Float32Array(count * 4 * 2);
    const indices = new Uint32Array(count * 6);

    const n = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const rotRight = new THREE.Vector3();
    const rotUp = new THREE.Vector3();
    const center = new THREE.Vector3();
    const corner = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const X = new THREE.Vector3(1, 0, 0);
    const QUAD_UV = [0, 0, 1, 0, 1, 1, 0, 1];

    // in-plane rotation / elliptical squash for galaxy smudges etc.
    // separate RNG stream: legacy placement is untouched when disabled
    const jitterRng = (layer.randomRotation || layer.aspectJitter > 0)
      ? new MsvcRng((layer.seed + 0x407a7) >>> 0)
      : null;

    for (let i = 0; i < count; i++) {
      n.set(flares.positions[i * 3], flares.positions[i * 3 + 1], flares.positions[i * 3 + 2]);
      // tangent frame on the sky sphere (pole-safe)
      right.crossVectors(Math.abs(n.y) > 0.99 ? X : Y, n).normalize();
      up.crossVectors(n, right);
      center.copy(n).multiplyScalar(SKY_RADIUS);
      const half = (flares.sizes[i] * SKY_RADIUS) / 2;

      let aspect = 1;
      if (jitterRng) {
        const angle = layer.randomRotation ? jitterRng.unit() * Math.PI * 2 : 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        rotRight.copy(right).multiplyScalar(cos).addScaledVector(up, sin);
        rotUp.copy(right).multiplyScalar(-sin).addScaledVector(up, cos);
        right.copy(rotRight);
        up.copy(rotUp);
        if (layer.aspectJitter > 0) {
          aspect = 1 - layer.aspectJitter * jitterRng.unit() * 0.85;
        }
      }

      for (let v = 0; v < 4; v++) {
        const sx = QUAD_UV[v * 2] * 2 - 1;
        const sy = QUAD_UV[v * 2 + 1] * 2 - 1;
        corner.copy(center)
          .addScaledVector(right, sx * half)
          .addScaledVector(up, sy * half * aspect);
        const vi = (i * 4 + v);
        positions[vi * 3] = corner.x;
        positions[vi * 3 + 1] = corner.y;
        positions[vi * 3 + 2] = corner.z;
        uvs[vi * 2] = QUAD_UV[v * 2];
        uvs[vi * 2 + 1] = QUAD_UV[v * 2 + 1];
        colors[vi * 4] = flares.colors[i * 4];
        colors[vi * 4 + 1] = flares.colors[i * 4 + 1];
        colors[vi * 4 + 2] = flares.colors[i * 4 + 2];
        colors[vi * 4 + 3] = flares.colors[i * 4 + 3];
      }

      const b = i * 4;
      indices.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    applyBlend(material, layer.sourceBlendFactor, layer.destBlendFactor);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = index;
    mesh.frustumCulled = false;

    // flare texture loads async; hold the quads back until it lands so we
    // don't flash untextured squares
    if (layer.texture) {
      mesh.visible = false;
      void loadFlareTexture(layer.texture).then((tex) => {
        // stay hidden if the texture failed — a mapless material would render
        // the whole vertex-colored quad as a solid rectangle
        if (tex) {
          material.map = tex;
          material.needsUpdate = true;
          mesh.visible = true;
        }
      });
    }

    return {
      mesh,
      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    };
  }

  /**
   * Bake the layer stack at export resolution into a half-float cubemap and
   * read back pixels as floats (HDR-capable). Noise layers re-bake at the
   * export size; the reference grid is never included (separate scene).
   * Face order +X -X +Y -Y +Z -Z, rows bottom-up (GL readback order).
   */
  /**
   * Particle data for engine-native systems (Niagara / GPUParticles /
   * MultiMesh). Positions use sky radius = 1. Masked layers go through the
   * exact GPU mask path the renderer uses. Returns null for image-only
   * layers (noise, volumetric).
   */
  async layerStarData(layer: Layer): Promise<StarData | null> {
    switch (layer.type) {
      case 'points': {
        const stars = layer.maskEnabled
          ? generatePointsMasked(layer, this.bakeMask(layer))
          : generatePoints(layer);
        const count = stars.positions.length / 3;
        const sizes = generateStarSizes(layer, count)
          ?? new Float32Array(count).fill(Math.max(1, layer.pointSize));
        return { positions: stars.positions, colors: stars.colors, sizes, count, sizeUnit: 'pixels' };
      }
      case 'billboards': {
        const flares = layer.dataFile
          ? billboardsFromCatalog(layer, await loadBundledCatalog())
          : generateBillboards(layer, layer.maskEnabled ? this.bakeMask(layer) : undefined);
        return {
          positions: flares.positions,
          colors: flares.colors,
          sizes: flares.sizes,
          count: flares.count,
          sizeUnit: 'sky-radius',
        };
      }
      case 'galaxy': {
        const stars = generateGalaxyStars(layer);
        const { center, u, v, w } = galaxyBasis(layer);
        const Rg = layer.apparentSize;
        const positions = new Float32Array(stars.count * 3);
        for (let i = 0; i < stars.count; i++) {
          const x = stars.positions[i * 3];
          const y = stars.positions[i * 3 + 1];
          const z = stars.positions[i * 3 + 2];
          positions[i * 3] = center.x + (x * u.x + y * v.x + z * w.x) * Rg;
          positions[i * 3 + 1] = center.y + (x * u.y + y * v.y + z * w.y) * Rg;
          positions[i * 3 + 2] = center.z + (x * u.z + y * v.z + z * w.z) * Rg;
        }
        return { positions, colors: stars.colors, sizes: stars.sizes, count: stars.count, sizeUnit: 'pixels' };
      }
      default:
        return null;
    }
  }

  async bakeExport(
    layers: Layer[],
    size: number,
    wantEquirect: boolean,
    wantExr = false,
    wantFaces = true,
  ): Promise<{
    faces: Float32Array[];
    equirect?: { width: number; height: number; data: Float32Array };
    exr?: Uint8Array;
  }> {
    // ensure flare textures are resolved so billboard meshes are visible
    await Promise.all(
      layers
        .filter((l): l is Extract<Layer, { type: 'billboards' }> => l.type === 'billboards')
        .flatMap((l) => [l.texture, ...(l.textureMix ?? [])])
        .filter(Boolean)
        .map((t) => loadFlareTexture(t)),
    );

    const exportLayers = layers.map((l) => {
      if (l.type === 'noise') return { ...l, previewTextureSize: size };
      // volumetric raymarch cost scales with area; cap its bake resolution
      if (l.type === 'volumetric') return { ...l, previewTextureSize: Math.min(size, 2048) };
      return l;
    });

    // lens captures should match export quality (capped — the capture is a
    // whole extra cubemap per black hole)
    const prevCapture = this.bhCaptureSize;
    this.bhCaptureSize = Math.min(Math.max(512, size), 2048);
    let objs: LayerObject[] = [];
    let rt: THREE.WebGLCubeRenderTarget | undefined;
    let eqRt: THREE.WebGLRenderTarget | undefined;
    try {
    objs = exportLayers.map((l, i) => this.buildLayer(l, i));
    // wait for async layer content (star catalog) and texture callbacks
    await Promise.all(objs.map((o) => o.ready ?? Promise.resolve()));
    await new Promise((r) => setTimeout(r, 0));

    const bakeScene = new THREE.Scene();
    bakeScene.background = new THREE.Color(0x000000);
    for (const o of objs) bakeScene.add(o.group);
    // distortion layers capture the layers below them in the bake scene;
    // both render at 90° FOV, so only the resolution ratio matters
    PreviewScene.prepareObjects(objs, this.renderer, bakeScene, this.bhCaptureSize / size);

    rt = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    const cam = new THREE.CubeCamera(0.1, SKY_RADIUS * 4, rt);
    cam.update(this.renderer, bakeScene);

    const faces: Float32Array[] = [];
    if (wantFaces) {
      for (let face = 0; face < 6; face++) {
        const buf = new Uint16Array(size * size * 4);
        this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf, face);
        faces.push(halfBufferToFloat(buf));
      }
    }

    let equirect: { width: number; height: number; data: Float32Array } | undefined;
    let exr: Uint8Array | undefined;
    if (wantEquirect || wantExr) {
      const w = size * 2;
      const h = size;
      eqRt = new THREE.WebGLRenderTarget(w, h, {
        depthBuffer: false,
        type: THREE.HalfFloatType,
      });
      const eqScene = new THREE.Scene();
      const eqMat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: EQUIRECT_VERT,
        fragmentShader: EQUIRECT_FRAG,
        uniforms: { cubeMap: { value: rt.texture } },
        depthTest: false,
        depthWrite: false,
      });
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), eqMat);
      quad.frustumCulled = false;
      eqScene.add(quad);
      const eqCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const prevTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(eqRt);
      this.renderer.render(eqScene, eqCam);
      this.renderer.setRenderTarget(prevTarget);

      const half = new Uint16Array(w * h * 4);
      this.renderer.readRenderTargetPixels(eqRt, 0, 0, w, h, half);
      equirect = { width: w, height: h, data: halfBufferToFloat(half) };

      if (wantExr) {
        exr = await new EXRExporter().parse(this.renderer, eqRt, {
          type: THREE.HalfFloatType,
        });
      }

      quad.geometry.dispose();
      eqMat.dispose();
    }

    return { faces, equirect, exr };
    } finally {
      // GPU resources must go even when a readback/EXR step throws
      this.bhCaptureSize = prevCapture;
      for (const o of objs) o.dispose();
      rt?.dispose();
      eqRt?.dispose();
    }
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // lens captures scale point stars by viewport height — refresh them
    if (this.layerObjects.some((o) => o.prepare)) this.runPrepares();
  }

  dispose(): void {
    this.wheelTarget.removeEventListener('wheel', this.onWheel);
    this.wheelTarget.removeEventListener('pointerdown', this.onPointerDown, { capture: true } as EventListenerOptions);
    this.wheelTarget.removeEventListener('pointermove', this.onPointerMove);
    this.wheelTarget.removeEventListener('pointerup', this.onPointerUp);
    this.wheelTarget.removeEventListener('pointercancel', this.onPointerCancel);
    this.wheelTarget.removeEventListener('lostpointercapture', this.onPointerCancel);
    this.wheelTarget.removeEventListener('contextmenu', this.onContextMenu);
    this.onLayerDragCancelled = undefined; // no rebuilds into a dying scene
    this.endDrag(false);
    this.setPcgPreview(null);
    this.renderer.setAnimationLoop(null);
    this.setLayers([]);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
