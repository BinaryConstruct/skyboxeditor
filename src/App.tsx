import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { addSpriteAsset, clearSpriteAssets, listSpriteAssets } from './assets/spriteStore';
import { importLegacyXml, fromJsonString } from './core/io';
import { defaultLayer, type Layer, type LayerType } from './core/layers';
import { manifestEntry, variantLayers, type VariationManifestEntry } from './export/batch';
import { compositeEntry, compositeJson, layerFileStem, starDataCsv, starDataJson, type ImageRefs } from './export/perLayer';
import { FACE_NAMES, downloadBlob, floatToPngBlob, packageFacesZip } from './export/exporter';
import { encodeRadianceHdr } from './export/hdr';
import { strToU8, zipSync } from 'fflate';
import { buildProjectBundle, mimeForFileName, openProjectBundle } from './export/projectBundle';
import { PreviewScene } from './render/PreviewScene';
import { Inspector } from './ui/Inspector';
import { LayerList } from './ui/LayerList';
import { ScriptTab } from './ui/ScriptTab';
import { SpritesTab } from './ui/SpritesTab';
import { StarsTab } from './ui/StarsTab';

// bundled presets: legacy .xml plus native v2 .json (new layer types)
const presetFiles = import.meta.glob('../presets/*.{xml,json}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const presets: Record<string, string> = Object.fromEntries(
  Object.entries(presetFiles).map(([path, text]) => [
    path.split('/').pop()!.replace(/\.(xml|json)$/, ''),
    text,
  ]),
);

const parsePreset = (text: string) =>
  text.trimStart().startsWith('{') ? fromJsonString(text) : importLegacyXml(text);

const DEFAULT_PRESET = 'purple-nebula-complex';

/** ?preset=name — used by tests/screenshots and shareable links. */
function initialPreset(): string {
  const q = new URLSearchParams(window.location.search).get('preset');
  return q && presets[q] ? q : DEFAULT_PRESET;
}

type Tab = 'layers' | 'stars' | 'sprites' | 'script';

export default function App() {
  const [tab, setTab] = useState<Tab>('layers');
  const [presetName, setPresetName] = useState(initialPreset);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selected, setSelected] = useState(0);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const [grid, setGrid] = useState(false);
  const [spriteVersion, setSpriteVersion] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportSize, setExportSize] = useState(1024);
  const [exportFaces, setExportFaces] = useState(true);
  const [exportEquirect, setExportEquirect] = useState(true);
  const [exportExr, setExportExr] = useState(false);
  const [exportHdr, setExportHdr] = useState(false);
  const [exportBatch, setExportBatch] = useState(1);
  const [exportPerLayer, setExportPerLayer] = useState(false);
  const [batchProgress, setBatchProgress] = useState('');
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<PreviewScene | null>(null);
  const dirtyRef = useRef<Map<number, Layer>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // mirror for callbacks that outlive a render (viewport drag commits)
  const layersRef = useRef<Layer[]>([]);
  layersRef.current = layers;

  // init scene once
  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;

    const scene = new PreviewScene(canvas);
    sceneRef.current = scene;

    // viewport drag-to-place: commit the final lon/lat into layer state
    scene.onLayerPlaced = (index, dirLonDeg, dirLatDeg) => {
      const layer = layersRef.current[index];
      if (!layer || !('dirLonDeg' in layer)) return;
      const next = { ...layer, dirLonDeg, dirLatDeg } as Layer;
      // a pending slider debounce for this layer would rebuild it with
      // pre-drag coordinates — the drag result supersedes it
      dirtyRef.current.delete(index);
      setLayers((prev) => prev.map((l, i) => (i === index ? next : l)));
      setSelected(index);
      scene.updateLayer(index, next);
    };

    const observer = new ResizeObserver(() => {
      scene.resize(viewport.clientWidth, viewport.clientHeight);
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  /** Replace the whole stack (preset load, file open, structural edits). */
  const loadLayers = (next: Layer[], keepSelection = false) => {
    dirtyRef.current.clear();
    setLayers(next);
    setHidden(new Set());
    if (!keepSelection) setSelected(0);
    else setSelected((s) => Math.min(s, Math.max(0, next.length - 1)));
    sceneRef.current?.setLayers(next);
  };

  // load preset on mount + preset switch
  useEffect(() => {
    loadLayers(parsePreset(presets[presetName]).layers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName]);

  // leaving the PCG tab clears the viewport preview + restores the backdrop
  useEffect(() => {
    if (tab !== 'stars') {
      sceneRef.current?.setPcgPreview(null);
    }
  }, [tab]);

  /** Add a sprite layer for a texture at a given (or view-center) position. */
  const addSpriteLayerAt = (
    textureId: string,
    baseName: string,
    at?: { lonDeg: number; latDeg: number },
    occludes = false,
  ) => {
    const scene = sceneRef.current;
    const sprite = defaultLayer('sprite', baseName) as Extract<Layer, { type: 'sprite' }>;
    sprite.texture = textureId;
    // solid bodies (planet/sun bakes carry disc alpha) occlude the sky
    if (occludes) {
      sprite.sourceBlendFactor = 'one';
      sprite.destBlendFactor = 'one_minus_src_alpha';
    }
    const pos = at ?? scene?.viewCenter();
    if (pos) {
      sprite.dirLonDeg = Math.round(pos.lonDeg * 100) / 100;
      sprite.dirLatDeg = Math.round(pos.latDeg * 100) / 100;
    }
    const next = [...layersRef.current, sprite];
    loadLayers(next, true);
    setSelected(next.length - 1);
    setTab('layers');
  };

  /** PCG bake → skybox: add a sprite layer with the baked texture at view center. */
  const addBakeToSky = (textureId: string, baseName: string, occludes = false) =>
    addSpriteLayerAt(textureId, baseName, undefined, occludes);

  /** Sprites-tab drag → viewport drop: place the sprite where it was dropped. */
  const onViewportDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-spacescape-sprite');
    if (!id) return;
    e.preventDefault();
    const scene = sceneRef.current;
    if (!scene) return;
    const at = scene.lonLatAtClient(e.clientX, e.clientY);
    // baked solid bodies (planet/sun/PCG star or planet) carry an occlude hint
    const occludes = e.dataTransfer.getData('application/x-spacescape-occludes') === 'true';
    addSpriteLayerAt(id, id.replace(/^user:/, '').replace(/\.(png|jpe?g|webp)$/i, ''), at, occludes);
  };

  /** Param edit: update state now, rebuild dirty layers debounced. */
  const updateLayer = (index: number, layer: Layer) => {
    setLayers((prev) => prev.map((l, i) => (i === index ? layer : l)));
    dirtyRef.current.set(index, layer);
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      for (const [i, l] of dirtyRef.current) {
        sceneRef.current?.updateLayer(i, l);
      }
      dirtyRef.current.clear();
    }, 200);
  };

  const toggleLayer = (index: number) => {
    const next = new Set(hidden);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setHidden(next);
    sceneRef.current?.setLayerVisible(index, !next.has(index));
  };

  const moveLayer = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers];
    [next[index], next[target]] = [next[target], next[index]];
    loadLayers(next, true);
    setSelected(target);
  };

  const duplicateLayer = (index: number) => {
    const copy = structuredClone(layers[index]);
    copy.name = `${copy.name} copy`;
    const next = [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)];
    loadLayers(next, true);
    setSelected(index + 1);
  };

  const deleteLayer = (index: number) => {
    loadLayers(layers.filter((_, i) => i !== index), true);
  };

  const addLayer = (type: LayerType) => {
    const names: Record<LayerType, string> = {
      noise: 'New Nebula',
      points: 'New Stars',
      billboards: 'New Flares',
      volumetric: 'New Volumetric Nebula',
      galaxy: 'New Galaxy',
      sun: 'New Sun',
      planet: 'New Planet',
      blackhole: 'New Black Hole',
      sprite: 'New Sprite',
    };
    const layer = defaultLayer(type, names[type]);
    const next = [...layers, layer];
    loadLayers(next, true);
    setSelected(next.length - 1);
  };

  const openFile = async (file: File) => {
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.sspj') || lower.endsWith('.zip')) {
        const bundle = openProjectBundle(new Uint8Array(await file.arrayBuffer()));
        clearSpriteAssets(); // don't leak the previous project's assets in
        for (const a of bundle.assets) {
          addSpriteAsset(a.fileName, a.data, mimeForFileName(a.fileName), a.occludes);
        }
        setSpriteVersion((v) => v + 1);
        loadLayers(bundle.layers);
        return;
      }
      const text = await file.text();
      const result = lower.endsWith('.json') ? fromJsonString(text) : importLegacyXml(text);
      loadLayers(result.layers);
    } catch (err) {
      alert(`Could not open ${file.name}: ${err instanceof Error ? err.message : err}`);
    }
  };

  /** Save the native project bundle: project.json + assets + preview.png. */
  const saveProject = async () => {
    const scene = sceneRef.current;
    if (!scene || saving) return;
    setSaving(true);
    try {
      let preview: Uint8Array | null = null;
      const bake = await scene.bakeExport(layers, 128, true);
      if (bake.equirect) {
        const blob = await floatToPngBlob(bake.equirect.data, bake.equirect.width, bake.equirect.height);
        preview = new Uint8Array(await blob.arrayBuffer());
      }
      downloadBlob(
        `${presetName}.sspj`,
        buildProjectBundle(layers, listSpriteAssets(), preview),
      );
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  };

  /** Batch bake: N deterministic seed variations, one zip download. */
  const runBatchExport = async (visibleLayers: Layer[], count: number) => {
    const scene = sceneRef.current!;
    const entries: Record<string, Uint8Array> = {};
    const variations: VariationManifestEntry[] = [];
    // zip32 + browser memory guard: entries are held in RAM and zipSync
    // allocates the archive on top, so stop adding variations past ~1 GB
    const BATCH_BYTE_BUDGET = 1_000_000_000;
    let entryBytes = 0;
    let truncatedAfter = 0;
    for (let k = 0; k < count; k++) {
      setBatchProgress(`${k + 1}/${count}`);
      const vLayers = variantLayers(visibleLayers, k);
      const { faces, equirect, exr } = await scene.bakeExport(
        vLayers,
        exportSize,
        exportEquirect || exportHdr,
        exportExr,
        exportFaces,
      );
      const tag = `v${String(k + 1).padStart(2, '0')}`;
      if (exportFaces) {
        for (let i = 0; i < 6; i++) {
          const blob = await floatToPngBlob(faces[i], exportSize, exportSize);
          entries[`${tag}/${presetName}_${FACE_NAMES[i]}.png`] =
            new Uint8Array(await blob.arrayBuffer());
        }
      }
      if (exportEquirect && equirect) {
        const blob = await floatToPngBlob(equirect.data, equirect.width, equirect.height);
        entries[`${tag}/${presetName}-equirect.png`] = new Uint8Array(await blob.arrayBuffer());
      }
      if (exportHdr && equirect) {
        const blob = encodeRadianceHdr(equirect.data, equirect.width, equirect.height);
        entries[`${tag}/${presetName}-equirect.hdr`] = new Uint8Array(await blob.arrayBuffer());
      }
      if (exportExr && exr) {
        entries[`${tag}/${presetName}-equirect.exr`] = exr;
      }
      variations.push(manifestEntry(vLayers, k));
      entryBytes = Object.values(entries).reduce((n, e) => n + e.length, 0);
      if (entryBytes > BATCH_BYTE_BUDGET && k < count - 1) {
        truncatedAfter = k + 1;
        break;
      }
    }
    entries['manifest.json'] = strToU8(JSON.stringify(
      {
        preset: presetName,
        faceSize: exportSize,
        ...(truncatedAfter ? { truncatedAfter, requested: count } : {}),
        variations,
      },
      null,
      2,
    ));
    const zipped = zipSync(entries, { level: 0 }); // payloads are already compressed
    downloadBlob(
      `${presetName}-batch${count}-${exportSize}.zip`,
      new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }),
    );
    if (truncatedAfter) {
      alert(
        `Batch stopped after ${truncatedAfter} of ${count} variations — the zip hit the ~1 GB in-memory limit. ` +
        'Lower the resolution or formats, or export the rest in a second batch.',
      );
    }
  };

  /**
   * Per-layer + data export: solo-baked layer images in every checked format
   * (cube faces / equirect PNG / HDR / EXR), particle data for star-bearing
   * layers, the fully flattened composite bake, and composite.json tying it
   * all together.
   */
  const runPerLayerExport = async (visibleLayers: Layer[]) => {
    const scene = sceneRef.current!;
    const entries: Record<string, Uint8Array> = {};
    const wantEquirect = exportEquirect || exportHdr;

    const writeImages = async (
      prefix: string,
      bake: Awaited<ReturnType<PreviewScene['bakeExport']>>,
    ): Promise<ImageRefs> => {
      const refs: ImageRefs = {};
      if (exportFaces) {
        refs.faces = [];
        for (let f = 0; f < 6; f++) {
          const blob = await floatToPngBlob(bake.faces[f], exportSize, exportSize);
          const path = `${prefix}/${FACE_NAMES[f]}.png`;
          entries[path] = new Uint8Array(await blob.arrayBuffer());
          refs.faces.push(path);
        }
      }
      if (exportEquirect && bake.equirect) {
        const blob = await floatToPngBlob(bake.equirect.data, bake.equirect.width, bake.equirect.height);
        refs.image = `${prefix}/equirect.png`;
        entries[refs.image] = new Uint8Array(await blob.arrayBuffer());
      }
      if (exportHdr && bake.equirect) {
        const hdr = encodeRadianceHdr(bake.equirect.data, bake.equirect.width, bake.equirect.height);
        refs.imageHdr = `${prefix}/equirect.hdr`;
        entries[refs.imageHdr] = new Uint8Array(await hdr.arrayBuffer());
      }
      if (exportExr && bake.exr) {
        refs.imageExr = `${prefix}/equirect.exr`;
        entries[refs.imageExr] = bake.exr;
      }
      return refs;
    };

    // same in-memory guard as batch export: entries + zipSync both live in RAM
    const BATCH_BYTE_BUDGET = 1_000_000_000;
    let truncatedAfter = 0;
    const composite = visibleLayers.map((l, i) => compositeEntry(l, i));
    for (let i = 0; i < visibleLayers.length; i++) {
      setBatchProgress(`layer ${i + 1}/${visibleLayers.length}`);
      const layer = visibleLayers[i];
      const stem = layerFileStem(layer, i);
      // a distortion layer solo-baked has nothing below it to bend — skip its image
      if (layer.type !== 'blackhole') {
        const bake = await scene.bakeExport([layer], exportSize, wantEquirect, exportExr, exportFaces);
        Object.assign(composite[i], await writeImages(`layers/${stem}`, bake));
      }
      const data = await scene.layerStarData(layer);
      if (data) {
        const jsonPath = `data/${stem}.json`;
        const csvPath = `data/${stem}.csv`;
        composite[i].data = { json: jsonPath, csv: csvPath, sizeUnit: data.sizeUnit };
        entries[jsonPath] = strToU8(starDataJson(layer.name, data));
        entries[csvPath] = strToU8(starDataCsv(data));
      }
      const bytes = Object.values(entries).reduce((n, e) => n + e.length, 0);
      if (bytes > BATCH_BYTE_BUDGET && i < visibleLayers.length - 1) {
        truncatedAfter = i + 1;
        break;
      }
    }

    // fully baked / flattened cubemap of the whole stack
    setBatchProgress('composite');
    const flattened = await scene.bakeExport(visibleLayers, exportSize, wantEquirect, exportExr, exportFaces);
    const compositeRefs = await writeImages('composite', flattened);

    entries['composite.json'] = strToU8(
      compositeJson({ preset: presetName, faceSize: exportSize, composite: compositeRefs }, composite),
    );
    const zipped = zipSync(entries, { level: 0 });
    downloadBlob(
      `${presetName}-layers-${exportSize}.zip`,
      new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }),
    );
    if (truncatedAfter) {
      alert(
        `Per-layer export stopped after ${truncatedAfter} of ${visibleLayers.length} layers — the zip hit the ~1 GB in-memory limit. ` +
        'Lower the resolution or formats and export again for the rest.',
      );
    }
  };

  const runExport = async () => {
    const scene = sceneRef.current;
    if (!scene || exporting) return;
    setExporting(true);
    try {
      const visibleLayers = layers.filter((_, i) => !hidden.has(i));
      if (exportBatch > 1) {
        await runBatchExport(visibleLayers, exportBatch);
        setExportOpen(false);
        return;
      }
      if (exportPerLayer) {
        await runPerLayerExport(visibleLayers);
        setExportOpen(false);
        return;
      }
      const { faces, equirect, exr } = await scene.bakeExport(
        visibleLayers,
        exportSize,
        exportEquirect || exportHdr,
        exportExr,
        exportFaces,
      );
      if (exportFaces) {
        downloadBlob(
          `${presetName}-${exportSize}-faces.zip`,
          await packageFacesZip(faces, exportSize, presetName),
        );
      }
      if (exportEquirect && equirect) {
        downloadBlob(
          `${presetName}-${exportSize}-equirect.png`,
          await floatToPngBlob(equirect.data, equirect.width, equirect.height),
        );
      }
      if (exportHdr && equirect) {
        downloadBlob(
          `${presetName}-${exportSize}-equirect.hdr`,
          encodeRadianceHdr(equirect.data, equirect.width, equirect.height),
        );
      }
      if (exportExr && exr) {
        downloadBlob(
          `${presetName}-${exportSize}-equirect.exr`,
          new Blob([exr.buffer as ArrayBuffer], { type: 'image/x-exr' }),
        );
      }
      setExportOpen(false);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setExporting(false);
      setBatchProgress('');
    }
  };

  /**
   * Sprite assets changed (upload, bake, delete): rebuild any layer whose
   * texture points at a user sprite so the viewport can't show stale content.
   */
  const refreshUserTextureLayers = () => {
    setSpriteVersion((v) => v + 1);
    layersRef.current.forEach((l, i) => {
      if ('texture' in l && typeof l.texture === 'string' && l.texture.startsWith('user:')) {
        sceneRef.current?.updateLayer(i, l);
      }
    });
  };

  const selectedLayer = layers[selected] as Layer | undefined;
  const presetNames = useMemo(() => Object.keys(presets).sort(), []);
  const userSpriteIds = useMemo(
    () => listSpriteAssets().map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spriteVersion],
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="titlebar">
          <h1>BinaryConstruct Skybox Editor<span className="tagline">Free procedural stellar skybox editor</span></h1>
          <span className="icon-links">
            <a href="https://github.com/BinaryConstruct/skyboxeditor" target="_blank" rel="noreferrer" title="Source on GitHub" aria-label="GitHub">
              <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
            <a href="https://patreon.com/binaryconstruct" target="_blank" rel="noreferrer" title="Support on Patreon" aria-label="Patreon">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M14.82 2.41c-3.96 0-7.18 3.22-7.18 7.18 0 3.94 3.22 7.15 7.18 7.15 3.94 0 7.15-3.21 7.15-7.15 0-3.96-3.21-7.18-7.15-7.18M2.03 21.6h3.5V2.41h-3.5Z" />
              </svg>
            </a>
          </span>
        </div>

        <div className="file-row">
          <span className="file-buttons">
            <button type="button" onClick={() => fileInputRef.current?.click()}>Open</button>
            <button type="button" disabled={saving} onClick={() => void saveProject()}>
              {saving ? '…' : 'Save'}
            </button>
            <button
              type="button"
              className={grid ? 'active' : ''}
              title="Toggle lat/lon reference grid (editor only, not exported)"
              onClick={() => {
                const next = !grid;
                setGrid(next);
                sceneRef.current?.setGridVisible(next);
              }}
            >
              Grid
            </button>
            <button
              type="button"
              className={exportOpen ? 'active' : ''}
              title="Bake and export the skybox"
              onClick={() => setExportOpen(!exportOpen)}
            >
              Export
            </button>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.json,.sspj,.zip"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <nav className="tabs">
          {(['layers', 'stars', 'sprites', 'script'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? 'active' : ''}
              onClick={() => setTab(t)}
            >
              {t === 'stars' ? 'PCG' : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        {exportOpen && (
          <div className="export-panel">
            <div className="field-row">
              <label>Resolution</label>
              <select value={exportSize} onChange={(e) => setExportSize(Number(e.target.value))}>
                {[512, 1024, 2048, 4096].map((s) => (
                  <option key={s} value={s}>{s} × {s} / face</option>
                ))}
              </select>
            </div>
            <div className="field-row">
              <label>Cube faces (.zip)</label>
              <input type="checkbox" checked={exportFaces} onChange={(e) => setExportFaces(e.target.checked)} />
            </div>
            <div className="field-row">
              <label>Equirect (.png)</label>
              <input type="checkbox" checked={exportEquirect} onChange={(e) => setExportEquirect(e.target.checked)} />
            </div>
            <div className="field-row">
              <label title="Radiance RGBE — imports as TextureCube in Unreal">Equirect (.hdr)</label>
              <input type="checkbox" checked={exportHdr} onChange={(e) => setExportHdr(e.target.checked)} />
            </div>
            <div className="field-row">
              <label title="OpenEXR — drop into Godot PanoramaSkyMaterial">Equirect (.exr)</label>
              <input type="checkbox" checked={exportExr} onChange={(e) => setExportExr(e.target.checked)} />
            </div>
            <div className="field-row">
              <label title="Each visible layer baked solo + composite.json blend recipe + star/billboard/galaxy layers as JSON/CSV particle data (Niagara / GPUParticles / MultiMesh)">Per-layer + data (.zip)</label>
              <input
                type="checkbox"
                checked={exportPerLayer}
                onChange={(e) => setExportPerLayer(e.target.checked)}
              />
            </div>
            <div className="field-row">
              <label title="Bake N deterministic seed variations of this preset into one zip (v01/, v02/, … + manifest.json)">Variations</label>
              <input
                className="num"
                type="number"
                min={1}
                max={32}
                step={1}
                value={exportBatch}
                onChange={(e) => {
                  const n = Math.trunc(Number(e.target.value));
                  if (Number.isFinite(n)) setExportBatch(Math.min(32, Math.max(1, n)));
                }}
              />
            </div>
            <button
              type="button"
              className="export-go"
              disabled={exporting || (!exportFaces && !exportEquirect && !exportHdr && !exportExr)}
              onClick={() => void runExport()}
            >
              {exporting
                ? batchProgress ? `Baking ${batchProgress}…` : 'Baking…'
                : exportBatch > 1 ? `Bake ${exportBatch} variations`
                : exportPerLayer ? 'Bake layers & data'
                : 'Bake & download'}
            </button>
            <p className="hint" style={{ margin: 0 }}>
              Bakes visible layers at full resolution. The grid is never
              included. Legacy .xml files can be opened but the native save is
              a .sspj bundle (json + sprites + preview).
            </p>
          </div>
        )}

        {tab === 'layers' && (
          <>
            <label className="field">
              Preset
              <select value={presetName} onChange={(e) => setPresetName(e.target.value)}>
                {presetNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>

            <LayerList
              layers={layers}
              selected={selected}
              hidden={hidden}
              onSelect={setSelected}
              onToggleVisible={toggleLayer}
              onMove={moveLayer}
              onDuplicate={duplicateLayer}
              onDelete={deleteLayer}
              onAdd={addLayer}
              onToggleLock={(i) => {
                const l = layers[i];
                if (l) updateLayer(i, { ...l, locked: l.locked ? undefined : true });
              }}
            />

            {selectedLayer && (
              <Inspector
                key={`${presetName}-${selected}-${selectedLayer.type}`}
                layer={selectedLayer}
                userSprites={userSpriteIds}
                onChange={(l) => updateLayer(selected, l)}
              />
            )}

            <p className="hint">
              Drag to look around · wheel to zoom. Edits re-bake only the
              changed layer.
            </p>
          </>
        )}

        {tab === 'stars' && (
          <StarsTab
            onSpritesChanged={refreshUserTextureLayers}
            onViewportPreview={(canvas, occludes) => sceneRef.current?.setPcgPreview(canvas, occludes)}
            onBackdrop={(showSky) => sceneRef.current?.setPcgBackdrop(showSky)}
            onAddToSky={addBakeToSky}
          />
        )}
        {tab === 'sprites' && (
          <SpritesTab version={spriteVersion} onChanged={refreshUserTextureLayers} />
        )}
        {tab === 'script' && (
          <ScriptTab layers={layers} onApply={(next) => loadLayers(next, true)} />
        )}
      </aside>

      <div
        className="viewport"
        ref={viewportRef}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-spacescape-sprite')) e.preventDefault();
        }}
        onDrop={onViewportDrop}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
