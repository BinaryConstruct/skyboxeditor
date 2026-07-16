/**
 * Stars tab: procedural generation workbench. Pick a generator (star flare,
 * spiral galaxy, planet), tune its parameters with a live preview, and
 * "Bake to Sprites" — the result registers as a sprite asset (persisted in
 * .sspj bundles, selectable in flare layers' Texture picker).
 */
import { useEffect, useMemo, useState } from 'react';
import { addSpriteAsset } from '../assets/spriteStore';
import {
  DEFAULT_FLARE, DEFAULT_GALAXY, DEFAULT_PLANET, DEFAULT_RING, DEFAULT_SUN,
  SUN_STYLE_DEFAULTS,
  applyBakeModeToCanvas, bakeFlareGen, bakeGalaxyGen, bakePlanetGen, bakeSunGen,
  type BakeMode, type FlareGenParams, type GalaxyGenParams, type GalaxyMorphology,
  type PlanetGenParams, type PlanetStyle, type RingParams, type SunGenParams, type SunStyle,
} from '../gen/generators';
import {
  DEFAULT_NEBULA, NEBULA_STYLE_DEFAULTS, bakeNebulaGen,
  type NebulaGenParams, type NebulaStyle,
} from '../gen/nebulaGen';
import {
  ANOMALY_STYLE_DEFAULTS, DEFAULT_ANOMALY, bakeAnomalyGen,
  type AnomalyGenParams, type AnomalyStyle,
} from '../gen/anomalyGen';
import { bodyAlphaCanvas, ditherCanvas, makeCanvas, windowSpriteEdges, zoomCanvas } from '../gen/genCommon';
import { composePcgObject, type PcgObjectSpec } from '../gen/pcgSpec';
import {
  defaultLayerParams, pcgLayerDescriptor, pcgLayerDescriptors,
} from '../gen/pcgLayers';
import { PCG_PRESETS, pcgPresetSpec } from '../gen/pcgPresets';
import { PROCEDURAL_FLARES, bakeFlareCanvas } from '../render/proceduralFlares';
import { ColorField, Group, SeedField, SelectField, SliderField, TextField } from './controls';

type GenKind = 'flare' | 'sun' | 'galaxy' | 'planet' | 'nebula' | 'anomaly' | 'pcg';

/** composePcgObject throws on a transient invalid stack — never crash preview. */
function safeCompose(spec: PcgObjectSpec, size: number): HTMLCanvasElement {
  try {
    return composePcgObject(spec, size);
  } catch {
    return makeCanvas(size).canvas;
  }
}

interface StarsTabProps {
  onSpritesChanged: () => void;
  /** live full-size preview quad in the main viewport (null on unmount) */
  onViewportPreview?: (canvas: HTMLCanvasElement | null, occludes?: boolean) => void;
  /** preview over the current skybox (true) or over black (false) */
  onBackdrop?: (showSky: boolean) => void;
  /** add the last bake to the skybox as a sprite layer */
  onAddToSky?: (textureId: string, baseName: string, occludes?: boolean) => void;
}

export function StarsTab({ onSpritesChanged, onViewportPreview, onBackdrop, onAddToSky }: StarsTabProps) {
  const [kind, setKind] = useState<GenKind>('galaxy');
  const [flare, setFlare] = useState<FlareGenParams>(DEFAULT_FLARE);
  const [galaxy, setGalaxy] = useState<GalaxyGenParams>(DEFAULT_GALAXY);
  // the workbench starts on the rocky style; DEFAULT_PLANET itself stays
  // style-less for back-compat (positional planet layers keep the legacy look)
  const [planet, setPlanet] = useState<PlanetGenParams>({ ...DEFAULT_PLANET, style: 'rocky' });
  const [nebula, setNebula] = useState<NebulaGenParams>(DEFAULT_NEBULA);
  const [sun, setSun] = useState<SunGenParams>(DEFAULT_SUN);
  const [anomaly, setAnomaly] = useState<AnomalyGenParams>(DEFAULT_ANOMALY);
  const [pcgClass, setPcgClass] = useState('star');
  const [pcgSubtype, setPcgSubtype] = useState('g-class');
  const [pcgSpec, setPcgSpec] = useState<PcgObjectSpec>(() => pcgPresetSpec('star', 'g-class', 12)!);
  const [name, setName] = useState('my-galaxy');
  const [bakeMode, setBakeMode] = useState<BakeMode>('color');
  const [zoom, setZoom] = useState(1);
  const [bakedMsg, setBakedMsg] = useState('');
  const [showSky, setShowSky] = useState(true);
  const [lastBaked, setLastBaked] = useState<{ id: string; base: string; occludes: boolean } | null>(null);


  /** zoom + edge containment + (for solid bodies) opaque-disc alpha */
  const finishBake = (canvas: HTMLCanvasElement) => {
    zoomCanvas(canvas, zoom);
    windowSpriteEdges(canvas);
    // ±1 LSB dither: smooth glow gradients band badly in 8-bit, and the
    // bands shift hue per channel when the sprite is magnified on a quad
    ditherCanvas(canvas);
    // solid bodies carry opaque-disc alpha so they occlude the sky:
    // sun/planet kinds, and pcg star/planet objects (photosphere radius)
    const pcgBody = kind === 'pcg' && (pcgClass === 'star' || pcgClass === 'planet');
    if (kind === 'planet' || kind === 'sun' || pcgBody) {
      let discFrac = 0.42;
      if (kind === 'sun') discFrac = sun.discRadius ?? 0.16;
      else if (kind === 'planet') {
        const maxOuter = planet.rings.reduce((m, r) => Math.max(m, r.outer), 0);
        discFrac = maxOuter > 0 ? 0.47 / maxOuter : 0.42;
      } else {
        const body = pcgSpec.layers.find((l) => l.type === 'photosphere' && l.enabled);
        discFrac = typeof body?.params.radius === 'number' ? body.params.radius : 0.16;
      }
      // disc fraction is relative to the sprite, whatever its resolution
      bodyAlphaCanvas(canvas, discFrac * canvas.width * zoom);
    }
    return canvas;
  };

  const preview = useMemo(() => {
    const canvas =
      kind === 'flare' ? bakeFlareGen(flare)
      : kind === 'sun' ? bakeSunGen(sun)
      : kind === 'galaxy' ? bakeGalaxyGen(galaxy)
      : kind === 'planet' ? bakePlanetGen(planet)
      : kind === 'anomaly' ? bakeAnomalyGen(anomaly)
      : kind === 'pcg' ? safeCompose(pcgSpec, 192)
      : bakeNebulaGen(nebula, 192); // reduced res for interactive preview
    // zoom + containment + solid-body alpha, identical to the bake path
    finishBake(canvas);
    applyBakeModeToCanvas(canvas, bakeMode);
    return { url: canvas.toDataURL(), canvas };
    // finishBake closes over zoom, so it IS a real dependency of this memo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, flare, sun, galaxy, planet, nebula, anomaly, pcgSpec, bakeMode, zoom]);

  // first-class preview: mirror the generator into the main viewport
  useEffect(() => {
    onViewportPreview?.(preview.canvas, kind === 'planet' || kind === 'sun' || (kind === 'pcg' && (pcgClass === 'star' || pcgClass === 'planet')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  useEffect(() => {
    onBackdrop?.(showSky);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSky]);
  useEffect(() => () => onViewportPreview?.(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  const bake = async () => {
    const canvas =
      kind === 'flare' ? bakeFlareGen(flare)
      : kind === 'sun' ? bakeSunGen(sun)
      : kind === 'galaxy' ? bakeGalaxyGen(galaxy)
      : kind === 'planet' ? bakePlanetGen(planet)
      : kind === 'anomaly' ? bakeAnomalyGen(anomaly)
      : kind === 'pcg' ? safeCompose(pcgSpec, 512)
      : bakeNebulaGen(nebula, 512);
    finishBake(canvas);
    applyBakeModeToCanvas(canvas, bakeMode);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return;
    const fileName = `${name.trim() || kind}.png`;
    const occludes = kind === 'planet' || kind === 'sun' || (kind === 'pcg' && (pcgClass === 'star' || pcgClass === 'planet'));
    const asset = addSpriteAsset(fileName, new Uint8Array(await blob.arrayBuffer()), 'image/png', occludes);
    onSpritesChanged();
    setLastBaked({ id: asset.id, base: fileName.replace(/\.png$/, ''), occludes });
    setBakedMsg(`Baked "${fileName}" — find it in Sprites and in flare Texture pickers.`);
  };

  const updateRing = (i: number, patch: Partial<RingParams>) =>
    setPlanet((p) => ({ ...p, rings: p.rings.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRing = () =>
    setPlanet((p) => ({ ...p, rings: [...p.rings, { ...DEFAULT_RING, bandSeed: p.rings.length + 1 }] }));
  const removeRing = (i: number) =>
    setPlanet((p) => ({ ...p, rings: p.rings.filter((_, j) => j !== i) }));

  // --- PCG-object (spec-driven) layer stack editing ---
  const applyPcgSubtype = (classId: string, subtypeId: string) => {
    setPcgClass(classId);
    setPcgSubtype(subtypeId);
    const seeded = pcgPresetSpec(classId, subtypeId, pcgSpec.seed);
    if (seeded) setPcgSpec(seeded);
  };
  const patchLayers = (fn: (layers: PcgObjectSpec['layers']) => PcgObjectSpec['layers']) =>
    setPcgSpec((s) => ({ ...s, layers: fn(s.layers) }));
  const toggleLayer = (i: number) =>
    patchLayers((ls) => ls.map((l, j) => (j === i ? { ...l, enabled: !l.enabled } : l)));
  const moveLayer = (i: number, dir: -1 | 1) =>
    patchLayers((ls) => {
      const j = i + dir;
      if (j < 0 || j >= ls.length) return ls;
      const next = ls.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const removeLayer = (i: number) => patchLayers((ls) => ls.filter((_, j) => j !== i));
  const updateLayerParam = (i: number, key: string, value: number | string) =>
    patchLayers((ls) => ls.map((l, j) => (j === i ? { ...l, params: { ...l.params, [key]: value } } : l)));
  const addLayer = (type: string) =>
    patchLayers((ls) => {
      const base = type.split('-')[0];
      let n = 1;
      while (ls.some((l) => l.id === `${base}${n}`)) n++;
      return [...ls, {
        id: `${base}${n}`, type, enabled: true, seed: ls.length + 1,
        blendMode: pcgLayerDescriptor(type)?.blend ?? 'add', params: defaultLayerParams(type),
      }];
    });
  const pcgSubtypes = PCG_PRESETS.filter((p) => p.classId === pcgClass);
  const pcgClasses = [...new Set(PCG_PRESETS.map((p) => p.classId))];

  return (
    <div className="asset-tab">
      <Group title="Generator">
        <SelectField
          label="Type"
          value={kind}
          options={[
            { value: 'flare', label: 'star' },
            { value: 'sun', label: 'sun (close-up)' },
            { value: 'galaxy', label: 'galaxy' },
            { value: 'nebula', label: 'nebula' },
            { value: 'planet', label: 'planet' },
            { value: 'anomaly', label: 'anomaly' },
            { value: 'pcg', label: 'PCG object (layers)' },
          ]}
          onChange={(v) => setKind(v as GenKind)}
        />
        <SliderField label="Zoom" value={zoom} min={0.4} max={2} step={0.05} onChange={setZoom} />
      </Group>

      <img className="gen-preview" src={preview.url} alt="generator preview" />

      <div className="field-row">
        <label title="Preview in the main viewport over the current skybox, or over black">Show skybox</label>
        <input type="checkbox" checked={showSky} onChange={(e) => setShowSky(e.target.checked)} />
      </div>

      {kind === 'flare' && (
        <Group title="Star">
          <SliderField label="Core" value={flare.coreRadius} min={10} max={140} integer onChange={(coreRadius) => setFlare({ ...flare, coreRadius })} />
          <SliderField label="Spikes" value={flare.spikes} min={0} max={8} integer onChange={(spikes) => setFlare({ ...flare, spikes })} />
          <SliderField label="Spike len" value={flare.spikeLength} min={20} max={190} integer onChange={(spikeLength) => setFlare({ ...flare, spikeLength })} />
          <SliderField label="Angle°" value={flare.spikeAngle} min={0} max={90} integer onChange={(spikeAngle) => setFlare({ ...flare, spikeAngle })} />
          <SliderField label="Halo" value={flare.halo} min={0} max={1} onChange={(halo) => setFlare({ ...flare, halo })} />
          <SliderField label="Temp K" value={flare.kelvin} min={2000} max={20000} step={100} onChange={(kelvin) => setFlare({ ...flare, kelvin })} />
        </Group>
      )}

      {kind === 'sun' && (
        <Group title="Sun">
          <SelectField
            label="Style"
            value={sun.style ?? 'g'}
            options={[
              { value: 'o', label: 'O — blue supergiant' },
              { value: 'b', label: 'B — blue-white' },
              { value: 'a', label: 'A — white' },
              { value: 'f', label: 'F — yellow-white' },
              { value: 'g', label: 'G — Sun-like' },
              { value: 'k', label: 'K — orange' },
              { value: 'm', label: 'M — red dwarf/giant' },
              { value: 'white-dwarf', label: 'white dwarf' },
              { value: 'red-dwarf', label: 'red dwarf' },
              { value: 'brown-dwarf', label: 'brown dwarf' },
              { value: 'red-giant', label: 'red giant' },
              { value: 'red-supergiant', label: 'red supergiant' },
              { value: 'blue-giant', label: 'blue giant' },
              { value: 'pulsar', label: 'pulsar (→ anomaly)' },
              { value: 'dust-ring', label: 'dust ring (debris)' },
              { value: 'solar-system', label: 'solar system (protoplanetary)' },
            ]}
            onChange={(v) =>
              // reset to base first: partial presets must not inherit style-
              // specific params from the previous style (e.g. ionizedShell)
              setSun({ ...DEFAULT_SUN, seed: sun.seed, style: v as SunStyle, ...SUN_STYLE_DEFAULTS[v as SunStyle] })
            }
          />
          <SeedField label="Seed" value={sun.seed} onChange={(seed) => setSun({ ...sun, seed })} />
          <SliderField label="Temp K" value={sun.kelvin} min={1000} max={40000} step={100} onChange={(kelvin) => setSun({ ...sun, kelvin })} />
          <SliderField label="Disc size" value={sun.discRadius} min={0.03} max={0.3} step={0.005} onChange={(discRadius) => setSun({ ...sun, discRadius })} />
          <SliderField label="Limb dark" value={sun.limbDarkening} min={0} max={1} onChange={(limbDarkening) => setSun({ ...sun, limbDarkening })} />
          <SliderField label="Granules" value={sun.granulation} min={0} max={1} onChange={(granulation) => setSun({ ...sun, granulation })} />
          <SliderField label="Granule scale" value={sun.granuleScale ?? 14} min={2} max={40} step={0.5} onChange={(granuleScale) => setSun({ ...sun, granuleScale })} />
          <SliderField label="Corona" value={sun.corona} min={0} max={1} onChange={(corona) => setSun({ ...sun, corona })} />
          <SliderField label="Cor. extent" value={sun.coronaExtent} min={0.3} max={2.5} step={0.05} onChange={(coronaExtent) => setSun({ ...sun, coronaExtent })} />
          <SliderField label="Prominences" value={sun.prominences} min={0} max={1} onChange={(prominences) => setSun({ ...sun, prominences })} />
          <SliderField label="Glow" value={sun.glow} min={0} max={1} onChange={(glow) => setSun({ ...sun, glow })} />
          <SliderField label="Ambient wisp" value={sun.ambientWisp ?? 0} min={0} max={1} onChange={(ambientWisp) => setSun({ ...sun, ambientWisp })} />
          <SliderField label="Spikes" value={sun.spikes ?? 0} min={0} max={8} integer onChange={(spikes) => setSun({ ...sun, spikes })} />

          {sun.style === 'brown-dwarf' && (
            <SliderField label="Magenta mix" value={sun.magentaMix ?? 0.35} min={0} max={1} onChange={(magentaMix) => setSun({ ...sun, magentaMix })} />
          )}
          {sun.style === 'white-dwarf' && (
            <SliderField label="Ionized shell" value={sun.ionizedShell ?? 0} min={0} max={1} onChange={(ionizedShell) => setSun({ ...sun, ionizedShell })} />
          )}
          {sun.style === 'dust-ring' && (<>
            <SliderField label="Ring inner" value={sun.ringInner ?? 6} min={3} max={12} step={0.1} onChange={(ringInner) => setSun({ ...sun, ringInner })} />
            <SliderField label="Ring outer" value={sun.ringOuter ?? 8} min={3.5} max={14} step={0.1} onChange={(ringOuter) => setSun({ ...sun, ringOuter })} />
            <SliderField label="Ring tilt°" value={sun.ringTilt ?? 55} min={10} max={80} integer onChange={(ringTilt) => setSun({ ...sun, ringTilt })} />
            <SliderField label="Ring opacity" value={sun.ringOpacity ?? 0.3} min={0} max={1} onChange={(ringOpacity) => setSun({ ...sun, ringOpacity })} />
            <SliderField label="Ring K" value={sun.ringKelvin ?? 5000} min={2000} max={12000} step={100} onChange={(ringKelvin) => setSun({ ...sun, ringKelvin })} />
            <SliderField label="Scatter" value={sun.scatter ?? 0.5} min={0} max={1} onChange={(scatter) => setSun({ ...sun, scatter })} />
          </>)}
          {sun.style === 'solar-system' && (<>
            <SliderField label="Disc tilt°" value={sun.discTilt ?? 50} min={0} max={70} integer onChange={(discTilt) => setSun({ ...sun, discTilt })} />
            <SliderField label="Disc PA°" value={sun.discPA ?? 30} min={0} max={180} integer onChange={(discPA) => setSun({ ...sun, discPA })} />
            <SliderField label="Gaps" value={sun.gapCount ?? 5} min={0} max={6} integer onChange={(gapCount) => setSun({ ...sun, gapCount })} />
            <SliderField label="Gap ratio" value={sun.gapRatio ?? 1.55} min={1.35} max={1.9} step={0.01} onChange={(gapRatio) => setSun({ ...sun, gapRatio })} />
            <SliderField label="Gap width" value={sun.gapWidth ?? 0.07} min={0.04} max={0.12} step={0.005} onChange={(gapWidth) => setSun({ ...sun, gapWidth })} />
            <SliderField label="Disc bright" value={sun.discBrightness ?? 1} min={0} max={2} step={0.05} onChange={(discBrightness) => setSun({ ...sun, discBrightness })} />
            <SliderField label="Scatter" value={sun.scatter ?? 0.35} min={0} max={0.6} onChange={(scatter) => setSun({ ...sun, scatter })} />
            <SliderField label="Planets" value={sun.planets ?? 2} min={0} max={3} integer onChange={(planets) => setSun({ ...sun, planets })} />
            <SliderField label="Disc K" value={sun.discKelvin ?? 3800} min={2000} max={8000} step={100} onChange={(discKelvin) => setSun({ ...sun, discKelvin })} />
          </>)}
        </Group>
      )}

      {kind === 'galaxy' && (
        <Group title="Galaxy">
          <SelectField
            label="Style"
            value={galaxy.morphology ?? 'spiral'}
            options={[
              { value: 'spiral', label: 'spiral' },
              { value: 'elliptical', label: 'elliptical / S0' },
              { value: 'edge-on', label: 'edge-on disk' },
              { value: 'globular', label: 'globular cluster' },
              { value: 'interacting', label: 'interacting pair' },
              { value: 'deep-field', label: 'deep field (JWST)' },
            ]}
            onChange={(v) => setGalaxy({ ...galaxy, morphology: v as GalaxyMorphology })}
          />
          <SeedField label="Seed" value={galaxy.seed} onChange={(seed) => setGalaxy({ ...galaxy, seed })} />

          {(galaxy.morphology ?? 'spiral') === 'spiral' && (<>
            <SliderField label="Arms" value={galaxy.arms} min={1} max={6} integer onChange={(arms) => setGalaxy({ ...galaxy, arms })} />
            <SliderField label="Windings" value={galaxy.windings} min={0.3} max={2} step={0.05} onChange={(windings) => setGalaxy({ ...galaxy, windings })} />
            <SliderField label="Tilt°" value={galaxy.tiltDeg} min={0} max={80} integer onChange={(tiltDeg) => setGalaxy({ ...galaxy, tiltDeg })} />
            <SliderField label="Bulge" value={galaxy.bulgeSize} min={0.1} max={0.6} onChange={(bulgeSize) => setGalaxy({ ...galaxy, bulgeSize })} />
            <SliderField label="Spread" value={galaxy.spread} min={0} max={1} onChange={(spread) => setGalaxy({ ...galaxy, spread })} />
            <SliderField label="Dust" value={galaxy.dust} min={0} max={1} onChange={(dust) => setGalaxy({ ...galaxy, dust })} />
            <SliderField label="Particles" value={galaxy.particles} min={500} max={8000} integer onChange={(particles) => setGalaxy({ ...galaxy, particles })} />
          </>)}

          {galaxy.morphology === 'elliptical' && (<>
            <SliderField label="Sérsic n" value={galaxy.sersicN ?? 4} min={0.8} max={5} step={0.1} onChange={(sersicN) => setGalaxy({ ...galaxy, sersicN })} />
            <SliderField label="Axis ratio" value={galaxy.axisRatio ?? 0.7} min={0.45} max={0.95} step={0.01} onChange={(axisRatio) => setGalaxy({ ...galaxy, axisRatio })} />
            <SliderField label="Angle°" value={galaxy.paDeg ?? 30} min={0} max={180} integer onChange={(paDeg) => setGalaxy({ ...galaxy, paDeg })} />
            <SliderField label="Size (Re)" value={galaxy.bulgeSize} min={0.1} max={0.6} onChange={(bulgeSize) => setGalaxy({ ...galaxy, bulgeSize })} />
          </>)}

          {galaxy.morphology === 'edge-on' && (<>
            <SliderField label="Angle°" value={galaxy.paDeg ?? 0} min={0} max={180} integer onChange={(paDeg) => setGalaxy({ ...galaxy, paDeg })} />
            <SliderField label="Thickness" value={galaxy.scaleHeight ?? 0.14} min={0.05} max={0.3} step={0.01} onChange={(scaleHeight) => setGalaxy({ ...galaxy, scaleHeight })} />
            <SliderField label="Dust depth" value={galaxy.dustDepth ?? 2.4} min={0} max={4} step={0.1} onChange={(dustDepth) => setGalaxy({ ...galaxy, dustDepth })} />
            <SliderField label="Lane offset" value={galaxy.laneOffset ?? -0.15} min={-0.5} max={0.5} step={0.05} onChange={(laneOffset) => setGalaxy({ ...galaxy, laneOffset })} />
            <SliderField label="Warp" value={galaxy.warpAmount ?? 0.25} min={0} max={1} step={0.05} onChange={(warpAmount) => setGalaxy({ ...galaxy, warpAmount })} />
            <SliderField label="Bulge" value={galaxy.bulgeSize} min={0.1} max={0.6} onChange={(bulgeSize) => setGalaxy({ ...galaxy, bulgeSize })} />
          </>)}

          {galaxy.morphology === 'globular' && (<>
            <SliderField label="Core radius" value={galaxy.coreRadius ?? 0.12} min={0.04} max={0.25} step={0.005} onChange={(coreRadius) => setGalaxy({ ...galaxy, coreRadius })} />
            <SliderField label="Tidal ratio" value={galaxy.tidalRatio ?? 11} min={6} max={16} step={0.5} onChange={(tidalRatio) => setGalaxy({ ...galaxy, tidalRatio })} />
            <SliderField label="Stars" value={galaxy.stars ?? 2200} min={400} max={4000} integer onChange={(stars) => setGalaxy({ ...galaxy, stars })} />
            <SliderField label="Core glow" value={galaxy.coreGlow ?? 0.7} min={0} max={1} onChange={(coreGlow) => setGalaxy({ ...galaxy, coreGlow })} />
            <SliderField label="Blue frac" value={galaxy.blueFraction ?? 0.02} min={0} max={0.1} step={0.005} onChange={(blueFraction) => setGalaxy({ ...galaxy, blueFraction })} />
          </>)}

          {galaxy.morphology === 'interacting' && (<>
            <SliderField label="Mass ratio" value={galaxy.massRatio ?? 0.6} min={0.2} max={1} step={0.05} onChange={(massRatio) => setGalaxy({ ...galaxy, massRatio })} />
            <SliderField label="Pericenter" value={galaxy.periDistance ?? 0.28} min={0.15} max={0.6} step={0.01} onChange={(periDistance) => setGalaxy({ ...galaxy, periDistance })} />
            <SliderField label="Phase" value={galaxy.phase ?? 0.6} min={0} max={1} step={0.05} onChange={(phase) => setGalaxy({ ...galaxy, phase })} />
          </>)}

          {galaxy.morphology === 'deep-field' && (<>
            <SliderField label="Galaxies" value={galaxy.stars ?? 2200} min={400} max={4000} integer onChange={(stars) => setGalaxy({ ...galaxy, stars })} />
            <SliderField label="Blue frac" value={galaxy.spread} min={0} max={1} onChange={(spread) => setGalaxy({ ...galaxy, spread })} />
          </>)}

          {galaxy.morphology !== 'spiral' && galaxy.morphology !== undefined && (<>
            <SliderField label="Warm K" value={galaxy.bulgeKelvin} min={2500} max={8000} step={100} onChange={(bulgeKelvin) => setGalaxy({ ...galaxy, bulgeKelvin })} />
            {galaxy.morphology !== 'elliptical' && (
              <SliderField label="Cool K" value={galaxy.armKelvin} min={5000} max={20000} step={100} onChange={(armKelvin) => setGalaxy({ ...galaxy, armKelvin })} />
            )}
          </>)}

          {(galaxy.morphology ?? 'spiral') === 'spiral' && (<>
            <SliderField label="Core K" value={galaxy.bulgeKelvin} min={2500} max={8000} step={100} onChange={(bulgeKelvin) => setGalaxy({ ...galaxy, bulgeKelvin })} />
            <SliderField label="Arm K" value={galaxy.armKelvin} min={5000} max={20000} step={100} onChange={(armKelvin) => setGalaxy({ ...galaxy, armKelvin })} />
          </>)}
        </Group>
      )}

      {kind === 'planet' && (
        <Group title="Planet">
          <SelectField
            label="Style"
            value={planet.style ?? 'rocky'}
            options={[
              { value: 'rocky', label: 'rocky (cratered)' },
              { value: 'terran', label: 'earth-like (ocean + clouds)' },
              { value: 'gas', label: 'gas giant (bands + storms)' },
            ]}
            onChange={(v) => setPlanet({ ...planet, style: v as PlanetStyle })}
          />
          {(planet.style ?? 'rocky') === 'rocky' && (
            <SliderField label="Craters" value={planet.craters ?? 0.5} min={0} max={1} onChange={(craters) => setPlanet({ ...planet, craters })} />
          )}
          {planet.style === 'terran' && (
            <SliderField label="Clouds" value={planet.clouds ?? 0.45} min={0} max={1} onChange={(clouds) => setPlanet({ ...planet, clouds })} />
          )}
          <SeedField label="Seed" value={planet.seed} onChange={(seed) => setPlanet({ ...planet, seed })} />
          <ColorField label="Base" value={planet.baseColor} onChange={(baseColor) => setPlanet({ ...planet, baseColor })} />
          <ColorField label="Detail" value={planet.secondColor} onChange={(secondColor) => setPlanet({ ...planet, secondColor })} />
          <SliderField label="Noise scale" value={planet.noiseScale} min={1} max={8} step={0.1} onChange={(noiseScale) => setPlanet({ ...planet, noiseScale })} />
          <SliderField label="Octaves" value={planet.octaves} min={2} max={7} integer onChange={(octaves) => setPlanet({ ...planet, octaves })} />
          <SliderField label="Banding" value={planet.banding} min={0} max={1} onChange={(banding) => setPlanet({ ...planet, banding })} />
          <SliderField label="Light°" value={planet.lightAngleDeg} min={-90} max={90} integer onChange={(lightAngleDeg) => setPlanet({ ...planet, lightAngleDeg })} />
          <ColorField label="Atmo" value={planet.atmosphereColor} onChange={(atmosphereColor) => setPlanet({ ...planet, atmosphereColor })} />
          <SliderField label="Atmo width" value={planet.atmosphereWidth} min={0} max={0.25} step={0.005} onChange={(atmosphereWidth) => setPlanet({ ...planet, atmosphereWidth })} />

          {planet.rings.map((rg, i) => (
            <details className="group" open key={i}>
              <summary>Ring {i + 1}</summary>
              <div className="group-body">
                <div className="field-row">
                  <label>Set {i + 1}</label>
                  <button type="button" className="del" onClick={() => removeRing(i)}>remove</button>
                </div>
                <SliderField label="Inner" value={rg.inner} min={1.15} max={3.4} step={0.05}
                  onChange={(inner) => updateRing(i, { inner, outer: Math.max(rg.outer, inner + 0.15) })} />
                <SliderField label="Outer" value={rg.outer} min={1.3} max={3.5} step={0.05}
                  onChange={(outer) => updateRing(i, { outer, inner: Math.min(rg.inner, outer - 0.15) })} />
                <SliderField label="Rotate°" value={rg.rotationDeg} min={0} max={180} integer
                  onChange={(rotationDeg) => updateRing(i, { rotationDeg })} />
                <SliderField label="Tilt°" value={rg.tiltDeg} min={5} max={85} integer
                  onChange={(tiltDeg) => updateRing(i, { tiltDeg })} />
                <SliderField label="Opacity" value={rg.opacity} min={0} max={1}
                  onChange={(opacity) => updateRing(i, { opacity })} />
                <ColorField label="Color" value={rg.color} onChange={(color) => updateRing(i, { color })} />
                <SeedField label="Band seed" value={rg.bandSeed} onChange={(bandSeed) => updateRing(i, { bandSeed })} />
              </div>
            </details>
          ))}
          <div className="field-row">
            <label>Rings</label>
            <button type="button" className="export-go" onClick={addRing}>+ ring</button>
          </div>
        </Group>
      )}

      {kind === 'nebula' && (
        <Group title="Nebula">
          <SeedField label="Seed" value={nebula.seed} onChange={(seed) => setNebula({ ...nebula, seed })} />
          <SelectField
            label="Style"
            value={nebula.style}
            options={[
              { value: 'nursery', label: 'star nursery (emission)' },
              { value: 'dark-dust', label: 'dark dust lane' },
              { value: 'wisp', label: 'reflection wisp' },
              { value: 'shell', label: 'planetary shell' },
            ]}
            onChange={(v) =>
              setNebula({ ...nebula, style: v as NebulaStyle, ...NEBULA_STYLE_DEFAULTS[v as NebulaStyle] })
            }
          />
          <ColorField label="Color A" value={nebula.colorA} onChange={(colorA) => setNebula({ ...nebula, colorA })} />
          <ColorField label="Color B" value={nebula.colorB} onChange={(colorB) => setNebula({ ...nebula, colorB })} />
          <SliderField label="Scale" value={nebula.scale} min={1.5} max={8} step={0.1} onChange={(scale) => setNebula({ ...nebula, scale })} />
          <SliderField label="Octaves" value={nebula.octaves} min={3} max={7} integer onChange={(octaves) => setNebula({ ...nebula, octaves })} />
          <SliderField label="Warp" value={nebula.warp} min={0} max={2} onChange={(warp) => setNebula({ ...nebula, warp })} />
          <SliderField label="Density" value={nebula.density} min={0} max={1} onChange={(density) => setNebula({ ...nebula, density })} />
          <SliderField label="Contrast" value={nebula.contrast} min={0.5} max={3} step={0.05} onChange={(contrast) => setNebula({ ...nebula, contrast })} />
          <SliderField label="Dust" value={nebula.dust} min={0} max={1} onChange={(dust) => setNebula({ ...nebula, dust })} />
          <SliderField label="Bright stars" value={nebula.brightStars} min={0} max={12} integer onChange={(brightStars) => setNebula({ ...nebula, brightStars })} />
          <SliderField label="Star glow" value={nebula.starGlow} min={0} max={1} onChange={(starGlow) => setNebula({ ...nebula, starGlow })} />
        </Group>
      )}

      {kind === 'anomaly' && (
        <Group title="Anomaly">
          <SelectField
            label="Style"
            value={anomaly.style}
            options={[
              { value: 'black-hole', label: 'black hole' },
              { value: 'tde', label: 'tidal disruption event' },
              { value: 'multiple', label: 'multiple (binary/trinary)' },
              { value: 'nova', label: 'nova' },
              { value: 'supernova', label: 'supernova' },
              { value: 'kilonova', label: 'kilonova' },
              { value: 'quasar', label: 'quasar' },
              { value: 'smbh-torus', label: 'SMBH + dusty torus' },
              { value: 'magnetar', label: 'magnetar' },
              { value: 'pulsar', label: 'pulsar (neutron star)' },
            ]}
            onChange={(v) =>
              setAnomaly({ ...DEFAULT_ANOMALY, seed: anomaly.seed, style: v as AnomalyStyle, ...ANOMALY_STYLE_DEFAULTS[v as AnomalyStyle] })
            }
          />
          <SeedField label="Seed" value={anomaly.seed} onChange={(seed) => setAnomaly({ ...anomaly, seed })} />

          {(anomaly.style === 'black-hole' || anomaly.style === 'tde') && (<>
            <SliderField label="Horizon" value={anomaly.horizonRadius ?? 0.1} min={0.04} max={0.16} step={0.005} onChange={(horizonRadius) => setAnomaly({ ...anomaly, horizonRadius })} />
            <SliderField label="Disc inner" value={anomaly.discInner ?? 2.2} min={1.5} max={4} step={0.1} onChange={(discInner) => setAnomaly({ ...anomaly, discInner, discOuter: Math.max(anomaly.discOuter ?? 6, discInner + 0.5) })} />
            <SliderField label="Disc outer" value={anomaly.discOuter ?? 6} min={3} max={9} step={0.1} onChange={(discOuter) => setAnomaly({ ...anomaly, discOuter, discInner: Math.min(anomaly.discInner ?? 2.2, discOuter - 0.5) })} />
            <SliderField label="Disc K" value={anomaly.discKelvin ?? 12000} min={6000} max={30000} step={200} onChange={(discKelvin) => setAnomaly({ ...anomaly, discKelvin })} />
            <SliderField label="Doppler" value={anomaly.doppler ?? 0.7} min={0} max={1} onChange={(doppler) => setAnomaly({ ...anomaly, doppler })} />
            <SliderField label="Tilt°" value={anomaly.tilt ?? 75} min={55} max={85} integer onChange={(tilt) => setAnomaly({ ...anomaly, tilt })} />
            <SliderField label="Photon ring" value={anomaly.photonRing ?? 1} min={0} max={1} onChange={(photonRing) => setAnomaly({ ...anomaly, photonRing })} />
            <SliderField label="Hat" value={anomaly.hat ?? 0.7} min={0} max={1} onChange={(hat) => setAnomaly({ ...anomaly, hat })} />
          </>)}
          {anomaly.style === 'tde' && (<>
            <SliderField label="Wraps" value={anomaly.wraps ?? 1.5} min={0.8} max={2.5} step={0.05} onChange={(wraps) => setAnomaly({ ...anomaly, wraps })} />
            <SliderField label="Stream width" value={anomaly.streamWidth ?? 6} min={2} max={12} step={0.5} onChange={(streamWidth) => setAnomaly({ ...anomaly, streamWidth })} />
            <SliderField label="Star K" value={anomaly.starKelvin ?? 5200} min={3500} max={6500} step={100} onChange={(starKelvin) => setAnomaly({ ...anomaly, starKelvin })} />
            <SliderField label="Hotspot" value={anomaly.hotspot ?? 1} min={0} max={1} onChange={(hotspot) => setAnomaly({ ...anomaly, hotspot })} />
          </>)}
          {anomaly.style === 'multiple' && (<>
            <SliderField label="Count" value={anomaly.count ?? 2} min={2} max={3} integer onChange={(count) => setAnomaly({ ...anomaly, count })} />
            <SliderField label="Separation" value={anomaly.separation ?? 0.28} min={0.15} max={0.4} step={0.01} onChange={(separation) => setAnomaly({ ...anomaly, separation })} />
            <SliderField label="Star A K" value={anomaly.kelvinA ?? 9500} min={2500} max={30000} step={200} onChange={(kelvinA) => setAnomaly({ ...anomaly, kelvinA })} />
            <SliderField label="Star B K" value={anomaly.kelvinB ?? 4200} min={2500} max={30000} step={200} onChange={(kelvinB) => setAnomaly({ ...anomaly, kelvinB })} />
            <SliderField label="Contact" value={anomaly.contact ?? 0} min={0} max={1} onChange={(contact) => setAnomaly({ ...anomaly, contact })} />
            <SliderField label="Spikes" value={anomaly.spikes ?? 4} min={0} max={8} integer onChange={(spikes) => setAnomaly({ ...anomaly, spikes })} />
            <SliderField label="Circumbin. ring" value={anomaly.circumbinaryRing ?? 0} min={0} max={1} onChange={(circumbinaryRing) => setAnomaly({ ...anomaly, circumbinaryRing })} />
          </>)}
          {anomaly.style === 'nova' && (<>
            <SliderField label="Shell radius" value={anomaly.shellRadius ?? 0.25} min={0.1} max={0.4} step={0.01} onChange={(shellRadius) => setAnomaly({ ...anomaly, shellRadius })} />
            <SliderField label="Shell age" value={anomaly.shellAge ?? 0.4} min={0} max={1} onChange={(shellAge) => setAnomaly({ ...anomaly, shellAge })} />
            <SliderField label="Streaks" value={anomaly.streaks ?? 0.5} min={0} max={1} onChange={(streaks) => setAnomaly({ ...anomaly, streaks })} />
            <SliderField label="Core K" value={anomaly.kelvin ?? 8000} min={5000} max={15000} step={200} onChange={(kelvin) => setAnomaly({ ...anomaly, kelvin })} />
            <SliderField label="Spikes" value={anomaly.spikes ?? 5} min={0} max={8} integer onChange={(spikes) => setAnomaly({ ...anomaly, spikes })} />
          </>)}
          {anomaly.style === 'supernova' && (<>
            <SliderField label="Shell radius" value={anomaly.shellRadius ?? 0.34} min={0.15} max={0.44} step={0.01} onChange={(shellRadius) => setAnomaly({ ...anomaly, shellRadius })} />
            <SliderField label="Ejecta" value={anomaly.ejectaAmount ?? 0.7} min={0} max={1.5} step={0.05} onChange={(ejectaAmount) => setAnomaly({ ...anomaly, ejectaAmount })} />
            <SliderField label="Rays" value={anomaly.rays ?? 16} min={0} max={24} integer onChange={(rays) => setAnomaly({ ...anomaly, rays })} />
            <SliderField label="Filament" value={anomaly.filamentContrast ?? 1.4} min={0.8} max={2.5} step={0.05} onChange={(filamentContrast) => setAnomaly({ ...anomaly, filamentContrast })} />
            <SliderField label="Core bright" value={anomaly.coreBrightness ?? 1} min={0} max={1.5} step={0.05} onChange={(coreBrightness) => setAnomaly({ ...anomaly, coreBrightness })} />
          </>)}
          {anomaly.style === 'kilonova' && (<>
            <SliderField label="Phase" value={anomaly.phase ?? 0.35} min={0} max={1} onChange={(phase) => setAnomaly({ ...anomaly, phase })} />
            <SliderField label="Axis°" value={anomaly.axisDeg ?? 20} min={0} max={90} integer onChange={(axisDeg) => setAnomaly({ ...anomaly, axisDeg })} />
            <SliderField label="Torus tilt°" value={anomaly.torusTilt ?? 65} min={40} max={80} integer onChange={(torusTilt) => setAnomaly({ ...anomaly, torusTilt })} />
            <SliderField label="Blue" value={anomaly.blueAmount ?? 0.8} min={0} max={1.5} step={0.05} onChange={(blueAmount) => setAnomaly({ ...anomaly, blueAmount })} />
            <SliderField label="Red" value={anomaly.redAmount ?? 0.8} min={0} max={1.5} step={0.05} onChange={(redAmount) => setAnomaly({ ...anomaly, redAmount })} />
          </>)}
          {anomaly.style === 'quasar' && (<>
            <SliderField label="Jet length" value={anomaly.jetLength ?? 0.42} min={0.2} max={0.48} step={0.01} onChange={(jetLength) => setAnomaly({ ...anomaly, jetLength })} />
            <SliderField label="Jet angle°" value={anomaly.jetAngleDeg ?? 20} min={0} max={180} integer onChange={(jetAngleDeg) => setAnomaly({ ...anomaly, jetAngleDeg })} />
            <SliderField label="Jet width" value={anomaly.jetWidth ?? 5} min={2} max={12} step={0.5} onChange={(jetWidth) => setAnomaly({ ...anomaly, jetWidth })} />
            <SliderField label="Knots" value={anomaly.knots ?? 4} min={0} max={6} integer onChange={(knots) => setAnomaly({ ...anomaly, knots })} />
            <SliderField label="Asymmetry" value={anomaly.jetAsymmetry ?? 0.65} min={0} max={1} onChange={(jetAsymmetry) => setAnomaly({ ...anomaly, jetAsymmetry })} />
            <SliderField label="Bend" value={anomaly.bend ?? 0.15} min={0} max={0.5} step={0.01} onChange={(bend) => setAnomaly({ ...anomaly, bend })} />
            <SliderField label="Host glow" value={anomaly.hostGlow ?? 0.4} min={0} max={1} onChange={(hostGlow) => setAnomaly({ ...anomaly, hostGlow })} />
            <SliderField label="Core K" value={anomaly.coreKelvin ?? 16000} min={8000} max={30000} step={200} onChange={(coreKelvin) => setAnomaly({ ...anomaly, coreKelvin })} />
          </>)}
          {anomaly.style === 'smbh-torus' && (<>
            <SliderField label="Torus radius" value={anomaly.torusRadius ?? 0.26} min={0.15} max={0.35} step={0.01} onChange={(torusRadius) => setAnomaly({ ...anomaly, torusRadius })} />
            <SliderField label="Torus thick" value={anomaly.torusThickness ?? 0.09} min={0.04} max={0.16} step={0.005} onChange={(torusThickness) => setAnomaly({ ...anomaly, torusThickness })} />
            <SliderField label="Tilt°" value={anomaly.tilt ?? 45} min={25} max={60} integer onChange={(tilt) => setAnomaly({ ...anomaly, tilt })} />
            <SliderField label="Clumpiness" value={anomaly.clumpiness ?? 0.5} min={0} max={1} onChange={(clumpiness) => setAnomaly({ ...anomaly, clumpiness })} />
            <SliderField label="Cone angle°" value={anomaly.coneAngle ?? 42} min={20} max={60} integer onChange={(coneAngle) => setAnomaly({ ...anomaly, coneAngle })} />
            <SliderField label="Cone amount" value={anomaly.coneAmount ?? 0.5} min={0} max={1} onChange={(coneAmount) => setAnomaly({ ...anomaly, coneAmount })} />
            <SliderField label="Jet amount" value={anomaly.jetAmount ?? 0.5} min={0} max={1} onChange={(jetAmount) => setAnomaly({ ...anomaly, jetAmount })} />
          </>)}
          {anomaly.style === 'magnetar' && (<>
            <SliderField label="Field lines" value={anomaly.lines ?? 6} min={3} max={8} integer onChange={(lines) => setAnomaly({ ...anomaly, lines })} />
            <SliderField label="Loop scale" value={anomaly.loopScale ?? 0.14} min={0.08} max={0.24} step={0.005} onChange={(loopScale) => setAnomaly({ ...anomaly, loopScale })} />
            <SliderField label="Axis°" value={anomaly.axisDeg ?? 20} min={0} max={180} integer onChange={(axisDeg) => setAnomaly({ ...anomaly, axisDeg })} />
            <SliderField label="Twist" value={anomaly.twist ?? 0.4} min={0} max={1} onChange={(twist) => setAnomaly({ ...anomaly, twist })} />
            <SliderField label="Hotspots" value={anomaly.hotspots ?? 1} min={0} max={2} integer onChange={(hotspots) => setAnomaly({ ...anomaly, hotspots })} />
          </>)}
          {anomaly.style === 'pulsar' && (<>
            <SliderField label="Beam angle°" value={anomaly.beamAngle ?? 55} min={0} max={180} integer onChange={(beamAngle) => setAnomaly({ ...anomaly, beamAngle })} />
            <SliderField label="Beam length" value={anomaly.beamLength ?? 0.45} min={0.25} max={0.48} step={0.01} onChange={(beamLength) => setAnomaly({ ...anomaly, beamLength })} />
            <SliderField label="Beam width°" value={anomaly.beamWidthDeg ?? 9} min={3} max={18} integer onChange={(beamWidthDeg) => setAnomaly({ ...anomaly, beamWidthDeg })} />
            <SliderField label="Misalign°" value={anomaly.misalignDeg ?? 25} min={10} max={40} integer onChange={(misalignDeg) => setAnomaly({ ...anomaly, misalignDeg })} />
            <SliderField label="Hollowness" value={anomaly.hollowness ?? 0.6} min={0} max={1} onChange={(hollowness) => setAnomaly({ ...anomaly, hollowness })} />
            <SliderField label="Wind torus" value={anomaly.windTorus ?? 0.4} min={0} max={1} onChange={(windTorus) => setAnomaly({ ...anomaly, windTorus })} />
          </>)}
          <p className="hint" style={{ margin: 0 }}>
            Additive art: the black-hole "shadow" only reads against the sprite's
            own disc — for a BH that occludes/lenses the sky use the positional
            black-hole layer (+b.hole).
          </p>
        </Group>
      )}

      {kind === 'pcg' && (
        <Group title="PCG object">
          <SelectField
            label="Class"
            value={pcgClass}
            options={pcgClasses.map((cid) => ({ value: cid, label: cid }))}
            onChange={(cid) => {
              const first = PCG_PRESETS.find((p) => p.classId === cid);
              if (first) applyPcgSubtype(cid, first.subtypeId);
            }}
          />
          <SelectField
            label="Style"
            value={pcgSubtype}
            options={pcgSubtypes.map((p) => ({ value: p.subtypeId, label: p.label }))}
            onChange={(sid) => applyPcgSubtype(pcgClass, sid)}
          />
          <SeedField label="Seed" value={pcgSpec.seed} onChange={(seed) => setPcgSpec((s) => ({ ...s, seed }))} />
          <button type="button" className="del" onClick={() => applyPcgSubtype(pcgClass, pcgSubtype)}>
            reset stack to Style default
          </button>

          {pcgSpec.layers.map((layer, i) => {
            const desc = pcgLayerDescriptor(layer.type);
            return (
              <details className="group" open key={layer.id}>
                <summary>{desc?.label ?? layer.type}{layer.enabled ? '' : ' (off)'}</summary>
                <div className="group-body">
                  <div className="field-row">
                    <label>{layer.id} · {layer.blendMode}</label>
                    <button type="button" className="dice" title="Enable/disable" onClick={() => toggleLayer(i)}>{layer.enabled ? '◉' : '○'}</button>
                    <button type="button" className="dice" title="Move up" onClick={() => moveLayer(i, -1)}>↑</button>
                    <button type="button" className="dice" title="Move down" onClick={() => moveLayer(i, 1)}>↓</button>
                    <button type="button" className="del" title="Remove" onClick={() => removeLayer(i)}>✕</button>
                  </div>
                  {(desc?.params ?? []).map((param) =>
                    param.type === 'enum' ? (
                      <SelectField
                        key={param.id}
                        label={param.label}
                        value={String(layer.params[param.id] ?? param.default)}
                        options={(param.options ?? []).map((o) => ({ value: o, label: o }))}
                        onChange={(v) => updateLayerParam(i, param.id, v)}
                      />
                    ) : (
                      <SliderField
                        key={param.id}
                        label={param.label}
                        value={Number(layer.params[param.id] ?? param.default)}
                        min={param.min ?? 0}
                        max={param.max ?? 1}
                        step={param.step ?? 0.01}
                        onChange={(v) => updateLayerParam(i, param.id, v)}
                      />
                    ),
                  )}
                </div>
              </details>
            );
          })}

          <div className="field-row">
            <label htmlFor="pcg-add">Add layer</label>
            <select
              id="pcg-add"
              value=""
              onChange={(e) => { if (e.target.value) { addLayer(e.target.value); e.target.value = ''; } }}
            >
              <option value="">+ add component layer…</option>
              {pcgLayerDescriptors().map((d) => (
                <option key={d.type} value={d.type}>{d.label}</option>
              ))}
            </select>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            A PCG object is a stack of reusable component layers (§8) composed on
            one sprite. Toggle, reorder, remove, or tune each layer; add more from
            the picker. Dust-lane multiplies to darken layers beneath it.
          </p>
        </Group>
      )}

      <Group title="Bake">
        <TextField label="Name" value={name} onChange={setName} />
        <SelectField
          label="Output"
          value={bakeMode}
          options={[
            { value: 'color', label: 'full color' },
            { value: 'lightness', label: 'lightness only (tint via layer color)' },
            { value: 'dark', label: 'dark (multiply — dark lanes)' },
          ]}
          onChange={(v) => setBakeMode(v as BakeMode)}
        />
        {bakeMode === 'dark' && (
          <p className="hint" style={{ margin: 0 }}>
            Bakes inverted: white sky, dark cloud. In the flares layer set
            blend src = dest_colour, dest = zero, and the layer colors to
            white — the sprite then darkens what's behind it.
          </p>
        )}
        <button type="button" className="export-go" onClick={() => void bake()}>
          Bake to Sprites
        </button>
        {bakedMsg && <p className="hint" style={{ margin: 0 }}>{bakedMsg}</p>}
        {lastBaked && onAddToSky && (
          <button
            type="button"
            className="export-go"
            title="Create a sprite layer with this bake at the current view center — drag it in the viewport to place"
            onClick={() => onAddToSky(lastBaked.id, lastBaked.base, lastBaked.occludes)}
          >
            Add "{lastBaked.base}" to skybox
          </button>
        )}
      </Group>

      <h2>Fixed procedural flares</h2>
      <div className="asset-grid">
        {PROCEDURAL_FLARES.map((id) => (
          <figure key={id} className="asset-card">
            <img src={bakeFlareCanvas(id)?.toDataURL() ?? ''} alt={id} />
            <figcaption>{id.replace('proc:', '')}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
