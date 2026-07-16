/**
 * Layer inspector: detailed controls for the selected layer, grouped into
 * collapsible sections per the modernization plan (Shape · Noise · Color ·
 * Mask · Blending).
 */
import { BLEND_FACTORS, type BillboardsLayer, type BlackHoleLayer, type GalaxyLayer, type Layer, type NoiseLayer, type PlanetLayer, type PointsLayer, type RampStop, type SpriteLayer, type SunLayer, type VolumetricLayer } from '../core/layers';
import { PALETTES } from '../core/palettes';
import { CheckField, ColorField, Group, SelectField, SeedField, SliderField, TextField } from './controls';

const BLEND_OPTIONS = BLEND_FACTORS.map((f) => ({ value: f, label: f.replaceAll('_', ' ') }));

const NOISE_TYPE_OPTIONS = [
  { value: 'fbm', label: 'fbm (smooth)' },
  { value: 'ridged', label: 'ridged' },
] as const;

const TEXTURE_SIZE_OPTIONS = ['64', '128', '256', '512', '1024'].map((v) => ({ value: v, label: v }));

/** Bundled flare textures (public/media/textures) + procedural bakes. */
const FLARE_OPTIONS = [
  { value: '', label: '(none)' },
  { value: 'proc:point', label: '✦ procedural: point' },
  { value: 'proc:halo', label: '✦ procedural: halo' },
  { value: 'proc:hubble', label: '✦ procedural: Hubble spikes' },
  { value: 'proc:jwst', label: '✦ procedural: JWST spikes' },
  { value: 'proc:galaxy-smudge', label: '✦ procedural: galaxy smudge' },
  { value: 'proc:galaxy-spiral', label: '✦ procedural: spiral galaxy' },
  { value: 'proc:galaxy-elliptical', label: '✦ procedural: elliptical galaxy' },
  { value: 'proc:galaxy-edgeon', label: '✦ procedural: edge-on galaxy' },
  { value: 'proc:galaxy-globular', label: '✦ procedural: globular cluster' },
  ...[
    'default.png',
    'flare-blue-purple1.png',
    'flare-blue-purple2.png',
    'flare-blue-purple3.png',
    'flare-blue-spikey1.png',
    'flare-green1.png',
    'flare-inverted-blue-purple3.png',
    'flare-red1.png',
    'flare-red-yellow1.png',
    'flare-white-small1.png',
    'sun.png',
    'hdr-flare-white.exr',
    'hdr-flare-white2.exr',
  ].map((v) => ({ value: v, label: v.replace(/\.(png|exr)$/, '') })),
];

interface InspectorProps {
  layer: Layer;
  /** user-uploaded sprite texture ids ("user:…") for the texture picker */
  userSprites?: string[];
  onChange: (layer: Layer) => void;
}

export function Inspector({ layer, userSprites = [], onChange }: InspectorProps) {
  // typed helper: patch a field on the current layer
  const set = <L extends Layer>(patch: Partial<L>) => onChange({ ...layer, ...patch } as Layer);

  return (
    <div className="inspector">
      <div className="inspector-head">Properties</div>
      <Group title="Layer">
        <TextField label="Name" value={layer.name} onChange={(name) => set({ name })} />
        <SeedField label="Seed" value={layer.seed} onChange={(seed) => set({ seed })} />
      </Group>

      {layer.type === 'noise' && <NoiseControls layer={layer} set={set} />}
      {layer.type === 'points' && <PointsControls layer={layer} set={set} />}
      {layer.type === 'billboards' && (
        <BillboardsControls layer={layer} set={set} userSprites={userSprites} />
      )}
      {layer.type === 'volumetric' && <VolumetricControls layer={layer} set={set} />}
      {layer.type === 'galaxy' && <GalaxyControls layer={layer} set={set} />}
      {layer.type === 'sun' && <SunControls layer={layer} set={set} />}
      {layer.type === 'sprite' && <SpriteControls layer={layer} set={set} userSprites={userSprites} />}
      {layer.type === 'planet' && <PlanetControls layer={layer} set={set} />}
      {layer.type === 'blackhole' && <BlackHoleControls layer={layer} set={set} />}

      {(layer.type === 'points' || layer.type === 'billboards') && (
        <MaskControls layer={layer} set={set} />
      )}

      <Group title="HDR">
        <SliderField
          label="Power"
          value={layer.hdrPower ?? 1}
          min={0.1}
          max={5}
          onChange={(v) => set({ hdrPower: v === 1 ? undefined : v })}
        />
        <SliderField
          label="Multiplier"
          value={layer.hdrMultiplier ?? 1}
          min={0}
          max={10}
          step={0.05}
          onChange={(v) => set({ hdrMultiplier: v === 1 ? undefined : v })}
        />
      </Group>

      <Group title="Blending">
        <SelectField
          label="Source"
          value={layer.sourceBlendFactor}
          options={BLEND_OPTIONS}
          onChange={(v) => set({ sourceBlendFactor: v as Layer['sourceBlendFactor'] })}
        />
        <SelectField
          label="Dest"
          value={layer.destBlendFactor}
          options={BLEND_OPTIONS}
          onChange={(v) => set({ destBlendFactor: v as Layer['destBlendFactor'] })}
        />
      </Group>
    </div>
  );
}

type Setter = (patch: Partial<Layer>) => void;

function NoiseControls({ layer, set }: { layer: NoiseLayer; set: Setter }) {
  return (
    <>
      <Group title="Noise">
        <SelectField
          label="Type"
          value={layer.noiseType}
          options={NOISE_TYPE_OPTIONS}
          onChange={(v) => set({ noiseType: v as NoiseLayer['noiseType'] })}
        />
        <SliderField label="Octaves" value={layer.octaves} min={1} max={16} integer onChange={(octaves) => set({ octaves })} />
        <SliderField label="Gain" value={layer.gain} min={0} max={2} onChange={(gain) => set({ gain })} />
        <SliderField label="Lacunarity" value={layer.lacunarity} min={1} max={4} onChange={(lacunarity) => set({ lacunarity })} />
        {layer.noiseType === 'ridged' && (
          <SliderField label="Offset" value={layer.offset} min={0} max={2} onChange={(offset) => set({ offset })} />
        )}
        <SliderField label="Scale" value={layer.scale} min={0.05} max={8} step={0.05} onChange={(scale) => set({ scale })} />
        <SliderField label="Power" value={layer.powerAmount} min={0.1} max={5} onChange={(powerAmount) => set({ powerAmount })} />
        <SliderField label="Shelf" value={layer.shelfAmount} min={0} max={0.95} onChange={(shelfAmount) => set({ shelfAmount })} />
        <SliderField label="Dither" value={layer.ditherAmount} min={0} max={0.5} onChange={(ditherAmount) => set({ ditherAmount })} />
        <SliderField label="Warp" value={layer.warpStrength} min={0} max={2} onChange={(warpStrength) => set({ warpStrength })} />
        {layer.warpStrength > 0 && (
          <SliderField label="Warp scale" value={layer.warpScale} min={0.1} max={4} step={0.05} onChange={(warpScale) => set({ warpScale })} />
        )}
      </Group>
      <Group title="Color">
        <CheckField
          label="Use ramp"
          value={!!layer.colorRamp}
          onChange={(on) =>
            set({
              colorRamp: on
                ? [
                    { t: 0, color: { ...layer.outerColor } },
                    { t: 1, color: { ...layer.innerColor } },
                  ]
                : undefined,
            })
          }
        />
        {!layer.colorRamp && (
          <>
            <ColorField label="Inner" value={layer.innerColor} onChange={(innerColor) => set({ innerColor })} />
            <ColorField label="Outer" value={layer.outerColor} onChange={(outerColor) => set({ outerColor })} />
          </>
        )}
        {layer.colorRamp && (
          <RampEditor
            stops={layer.colorRamp}
            onChange={(colorRamp) => set({ colorRamp })}
          />
        )}
      </Group>
      <Group title="Quality">
        <SelectField
          label="Preview res"
          value={String(layer.previewTextureSize)}
          options={TEXTURE_SIZE_OPTIONS}
          onChange={(v) => set({ previewTextureSize: Number(v) })}
        />
      </Group>
    </>
  );
}

function PointsControls({ layer, set }: { layer: PointsLayer; set: Setter }) {
  return (
    <>
      <Group title="Stars">
        <SliderField label="Count" value={layer.numPoints} min={0} max={100000} integer onChange={(numPoints) => set({ numPoints })} />
        <SliderField label="Size (px)" value={layer.pointSize} min={1} max={16} integer onChange={(pointSize) => set({ pointSize })} />
        <SliderField label="Size max" value={layer.pointSizeMax} min={0} max={16} integer onChange={(pointSizeMax) => set({ pointSizeMax })} />
      </Group>
      <Group title="Color">
        <SelectField
          label="Mode"
          value={layer.colorMode}
          options={[
            { value: 'legacy', label: 'near/far lerp (legacy)' },
            { value: 'blackbody', label: 'blackbody temperature' },
          ]}
          onChange={(v) => set({ colorMode: v as PointsLayer['colorMode'] })}
        />
        {layer.colorMode === 'legacy' ? (
          <>
            <ColorField label="Near" value={layer.nearColor} onChange={(nearColor) => set({ nearColor })} />
            <ColorField label="Far" value={layer.farColor} onChange={(farColor) => set({ farColor })} />
          </>
        ) : (
          <>
            <SliderField label="Temp min K" value={layer.tempMin} min={1000} max={20000} step={100} onChange={(tempMin) => set({ tempMin })} />
            <SliderField label="Temp max K" value={layer.tempMax} min={1000} max={30000} step={100} onChange={(tempMax) => set({ tempMax })} />
            <SliderField label="Mag power" value={layer.magnitudePower} min={0.5} max={6} step={0.1} onChange={(magnitudePower) => set({ magnitudePower })} />
          </>
        )}
      </Group>
      <Group title="Galactic band">
        <SliderField label="Strength" value={layer.bandStrength} min={0} max={1} onChange={(bandStrength) => set({ bandStrength })} />
        {layer.bandStrength > 0 && (
          <>
            <SliderField label="Squeeze" value={layer.bandConcentration} min={1} max={8} step={0.1} onChange={(bandConcentration) => set({ bandConcentration })} />
            <SliderField label="Tilt°" value={layer.bandAngleDeg} min={-90} max={90} integer onChange={(bandAngleDeg) => set({ bandAngleDeg })} />
          </>
        )}
      </Group>
    </>
  );
}

function BillboardsControls({ layer, set, userSprites }: { layer: BillboardsLayer; set: Setter; userSprites: string[] }) {
  const textureOptions = [
    ...FLARE_OPTIONS,
    ...userSprites.map((id) => ({ value: id, label: `⬆ ${id.replace(/^user:/, '')}` })),
  ];
  return (
    <>
      <Group title="Flares">
        <SliderField label="Count" value={layer.numBillboards} min={0} max={2000} integer onChange={(numBillboards) => set({ numBillboards })} />
        <SliderField label="Min size" value={layer.minSize} min={0} max={0.5} step={0.001} onChange={(minSize) => set({ minSize })} />
        <SliderField label="Max size" value={layer.maxSize} min={0} max={0.5} step={0.001} onChange={(maxSize) => set({ maxSize })} />
        <SelectField label="Texture" value={layer.texture} options={textureOptions} onChange={(texture) => set({ texture })} />
        <CheckField
          label="Mix set"
          value={!!layer.textureMix}
          onChange={(on) =>
            set({ textureMix: on ? [layer.texture || 'proc:galaxy-smudge', 'proc:galaxy-spiral'] : undefined })
          }
        />
        {layer.textureMix && (
          <>
            {layer.textureMix.map((tex, i) => (
              <div className="field-row" key={i}>
                <label>Mix {i + 1}</label>
                <select
                  value={tex}
                  onChange={(e) =>
                    set({ textureMix: layer.textureMix!.map((t, j) => (j === i ? e.target.value : t)) })
                  }
                >
                  {textureOptions.filter((o) => o.value).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="dice"
                  title="Remove from mix"
                  disabled={layer.textureMix!.length <= 2}
                  onClick={() => set({ textureMix: layer.textureMix!.filter((_, j) => j !== i) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => set({ textureMix: [...layer.textureMix!, 'proc:galaxy-elliptical'] })}
            >
              + add texture
            </button>
          </>
        )}
        <CheckField label="Random spin" value={layer.randomRotation} onChange={(randomRotation) => set({ randomRotation })} />
        <SliderField label="Squash" value={layer.aspectJitter} min={0} max={1} onChange={(aspectJitter) => set({ aspectJitter })} />
      </Group>
      <Group title="Color">
        <CheckField
          label="Hue mix"
          value={!!layer.huePalette}
          onChange={(on) =>
            set({
              huePalette: on
                ? [
                    { t: 3, color: { r: 1, g: 0.96, b: 0.85, a: 1 } }, // white/yellow
                    { t: 2, color: { r: 0.65, g: 0.78, b: 1, a: 1 } }, // blue
                    { t: 1, color: { r: 0.85, g: 0.65, b: 1, a: 1 } }, // purple
                    { t: 1, color: { r: 1, g: 0.55, b: 0.45, a: 1 } }, // red
                  ]
                : undefined,
            })
          }
        />
        {!layer.huePalette && (
          <>
            <ColorField label="Near" value={layer.nearColor} onChange={(nearColor) => set({ nearColor })} />
            <ColorField label="Far" value={layer.farColor} onChange={(farColor) => set({ farColor })} />
          </>
        )}
        {layer.huePalette && (
          <PaletteEditor stops={layer.huePalette} onChange={(huePalette) => set({ huePalette })} />
        )}
      </Group>
      <Group title="Star catalog">
        <CheckField
          label="HYG catalog"
          value={!!layer.dataFile}
          onChange={(on) => set({ dataFile: on ? 'stars.csv' : undefined })}
        />
        {layer.dataFile && (
          <p className="hint" style={{ margin: 0 }}>
            Positions, brightness and B−V colors come from the bundled star
            catalog; count/seed/mask are ignored.
          </p>
        )}
      </Group>
    </>
  );
}

function VolumetricControls({ layer, set }: { layer: VolumetricLayer; set: Setter }) {
  return (
    <>
      <Group title="Density field">
        <SelectField
          label="Type"
          value={layer.noiseType}
          options={NOISE_TYPE_OPTIONS}
          onChange={(v) => set({ noiseType: v as VolumetricLayer['noiseType'] })}
        />
        <SliderField label="Octaves" value={layer.octaves} min={1} max={12} integer onChange={(octaves) => set({ octaves })} />
        <SliderField label="Gain" value={layer.gain} min={0} max={2} onChange={(gain) => set({ gain })} />
        <SliderField label="Lacunarity" value={layer.lacunarity} min={1} max={4} onChange={(lacunarity) => set({ lacunarity })} />
        {layer.noiseType === 'ridged' && (
          <SliderField label="Offset" value={layer.offset} min={0} max={2} onChange={(offset) => set({ offset })} />
        )}
        <SliderField label="Scale" value={layer.scale} min={0.05} max={8} step={0.05} onChange={(scale) => set({ scale })} />
        <SliderField label="Power" value={layer.powerAmount} min={0.1} max={5} onChange={(powerAmount) => set({ powerAmount })} />
        <SliderField label="Shelf" value={layer.shelfAmount} min={0} max={0.95} onChange={(shelfAmount) => set({ shelfAmount })} />
        <SliderField label="Warp" value={layer.warpStrength} min={0} max={2} onChange={(warpStrength) => set({ warpStrength })} />
        {layer.warpStrength > 0 && (
          <SliderField label="Warp scale" value={layer.warpScale} min={0.1} max={4} step={0.05} onChange={(warpScale) => set({ warpScale })} />
        )}
      </Group>
      <Group title="Raymarch">
        <SliderField label="Steps" value={layer.steps} min={8} max={96} integer onChange={(steps) => set({ steps })} />
        <SliderField label="Density" value={layer.density} min={0} max={20} step={0.1} onChange={(density) => set({ density })} />
        <SliderField label="Absorption" value={layer.absorption} min={0} max={10} step={0.1} onChange={(absorption) => set({ absorption })} />
        <SliderField label="Shell inner" value={layer.shellInner} min={0.05} max={3} step={0.05} onChange={(shellInner) => set({ shellInner })} />
        <SliderField label="Shell outer" value={layer.shellOuter} min={0.1} max={4} step={0.05} onChange={(shellOuter) => set({ shellOuter })} />
      </Group>
      <Group title="Color">
        <CheckField
          label="Use ramp"
          value={!!layer.colorRamp}
          onChange={(on) =>
            set({
              colorRamp: on
                ? [
                    { t: 0, color: { ...layer.outerColor } },
                    { t: 1, color: { ...layer.innerColor } },
                  ]
                : undefined,
            })
          }
        />
        {!layer.colorRamp && (
          <>
            <ColorField label="Inner" value={layer.innerColor} onChange={(innerColor) => set({ innerColor })} />
            <ColorField label="Outer" value={layer.outerColor} onChange={(outerColor) => set({ outerColor })} />
          </>
        )}
        {layer.colorRamp && (
          <RampEditor stops={layer.colorRamp} onChange={(colorRamp) => set({ colorRamp })} />
        )}
      </Group>
      <Group title="Quality">
        <SelectField
          label="Preview res"
          value={String(layer.previewTextureSize)}
          options={TEXTURE_SIZE_OPTIONS}
          onChange={(v) => set({ previewTextureSize: Number(v) })}
        />
      </Group>
    </>
  );
}

function GalaxyControls({ layer, set }: { layer: GalaxyLayer; set: Setter }) {
  return (
    <>
      <Group title="Placement">
        <SliderField label="Longitude°" value={layer.dirLonDeg} min={-180} max={180} integer onChange={(dirLonDeg) => set({ dirLonDeg })} />
        <SliderField label="Latitude°" value={layer.dirLatDeg} min={-89} max={89} integer onChange={(dirLatDeg) => set({ dirLatDeg })} />
        <SliderField label="Size" value={layer.apparentSize} min={0.05} max={1.2} onChange={(apparentSize) => set({ apparentSize })} />
        <SliderField label="Tilt°" value={layer.tiltDeg} min={0} max={88} integer onChange={(tiltDeg) => set({ tiltDeg })} />
        <SliderField label="Spin°" value={layer.spinDeg} min={-180} max={180} integer onChange={(spinDeg) => set({ spinDeg })} />
        <CheckField label="Lock position" value={!!layer.locked} onChange={(locked) => set({ locked: locked || undefined })} />
      </Group>
      <Group title="Structure">
        <SliderField label="Arms" value={layer.arms} min={1} max={6} integer onChange={(arms) => set({ arms })} />
        <SliderField label="Windings" value={layer.windings} min={0.3} max={2.5} step={0.05} onChange={(windings) => set({ windings })} />
        <SliderField label="Spread" value={layer.spread} min={0} max={1} onChange={(spread) => set({ spread })} />
        <SliderField label="Bulge" value={layer.bulgeSize} min={0.05} max={0.6} onChange={(bulgeSize) => set({ bulgeSize })} />
        <SliderField label="Thickness" value={layer.thickness} min={0} max={0.3} step={0.005} onChange={(thickness) => set({ thickness })} />
      </Group>
      <Group title="Stars & color">
        <SliderField label="Stars" value={layer.numStars} min={1000} max={50000} integer onChange={(numStars) => set({ numStars })} />
        <SliderField label="Star px" value={layer.starSize} min={1} max={6} step={0.5} onChange={(starSize) => set({ starSize })} />
        <SliderField label="Core K" value={layer.bulgeKelvin} min={2500} max={8000} step={100} onChange={(bulgeKelvin) => set({ bulgeKelvin })} />
        <SliderField label="Arm K" value={layer.armKelvin} min={5000} max={20000} step={100} onChange={(armKelvin) => set({ armKelvin })} />
        <SliderField label="Core glow" value={layer.coreGlow} min={0} max={3} step={0.05} onChange={(coreGlow) => set({ coreGlow })} />
      </Group>
    </>
  );
}

/** Weighted hue populations: reuses RampStop with t = weight. */
function PaletteEditor({ stops, onChange }: { stops: RampStop[]; onChange: (stops: RampStop[]) => void }) {
  const update = (i: number, patch: Partial<RampStop>) =>
    onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="ramp-editor">
      {stops.map((s, i) => (
        <div className="field-row" key={i}>
          <input
            className="num"
            type="number"
            min={0}
            step={0.5}
            value={s.t}
            title="Weight"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) update(i, { t: Math.max(0, n) });
            }}
          />
          <input
            type="color"
            value={`#${[s.color.r, s.color.g, s.color.b]
              .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
              .join('')}`}
            onChange={(e) => {
              const hex = e.target.value;
              update(i, {
                color: {
                  ...s.color,
                  r: parseInt(hex.slice(1, 3), 16) / 255,
                  g: parseInt(hex.slice(3, 5), 16) / 255,
                  b: parseInt(hex.slice(5, 7), 16) / 255,
                },
              });
            }}
          />
          <button
            type="button"
            className="dice"
            title="Remove hue"
            disabled={stops.length <= 2}
            onClick={() => onChange(stops.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="dice"
        title="Add hue"
        onClick={() => onChange([...stops, { t: 1, color: { r: 1, g: 1, b: 1, a: 1 } }])}
      >
        + add hue
      </button>
    </div>
  );
}

function rampGradientCss(stops: RampStop[]): string {
  const parts = [...stops]
    .sort((a, b) => a.t - b.t)
    .map((s) => {
      const c = s.color;
      return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}) ${Math.round(s.t * 100)}%`;
    });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

function RampEditor({ stops, onChange }: { stops: RampStop[]; onChange: (stops: RampStop[]) => void }) {
  const update = (i: number, patch: Partial<RampStop>) =>
    onChange(stops.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="ramp-editor">
      <div className="field-row">
        <label>Palette</label>
        <select
          value=""
          onChange={(e) => {
            const p = PALETTES[e.target.value];
            if (p) onChange(p.map((s) => ({ t: s.t, color: { ...s.color } })));
          }}
        >
          <option value="">apply preset…</option>
          {Object.keys(PALETTES).map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>
      <div className="ramp-preview" style={{ background: rampGradientCss(stops) }} />
      {stops.map((s, i) => (
        <div className="field-row" key={i}>
          <input
            className="num"
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={s.t}
            title="Position (noise value)"
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) update(i, { t: Math.min(1, Math.max(0, n)) });
            }}
          />
          <input
            type="color"
            value={`#${[s.color.r, s.color.g, s.color.b]
              .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0'))
              .join('')}`}
            onChange={(e) => {
              const hex = e.target.value;
              update(i, {
                color: {
                  ...s.color,
                  r: parseInt(hex.slice(1, 3), 16) / 255,
                  g: parseInt(hex.slice(3, 5), 16) / 255,
                  b: parseInt(hex.slice(5, 7), 16) / 255,
                },
              });
            }}
          />
          <button
            type="button"
            className="dice"
            title="Remove stop"
            disabled={stops.length <= 2}
            onClick={() => onChange(stops.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="dice"
        title="Add stop"
        onClick={() => {
          const sorted = [...stops].sort((a, b) => a.t - b.t);
          const mid = sorted[Math.floor(sorted.length / 2)];
          onChange([...stops, { t: Math.min(1, mid.t + 0.1), color: { ...mid.color } }]);
        }}
      >
        + add stop
      </button>
    </div>
  );
}

function MaskControls({ layer, set }: { layer: PointsLayer | BillboardsLayer; set: Setter }) {
  return (
    <Group title="Noise mask">
      <CheckField label="Enabled" value={layer.maskEnabled} onChange={(maskEnabled) => set({ maskEnabled })} />
      {layer.maskEnabled && (
        <>
          <SelectField
            label="Type"
            value={layer.maskNoiseType}
            options={NOISE_TYPE_OPTIONS}
            onChange={(v) => set({ maskNoiseType: v as PointsLayer['maskNoiseType'] })}
          />
          <SeedField label="Seed" value={layer.maskSeed} onChange={(maskSeed) => set({ maskSeed })} />
          <SliderField label="Octaves" value={layer.maskOctaves} min={1} max={16} integer onChange={(maskOctaves) => set({ maskOctaves })} />
          <SliderField label="Gain" value={layer.maskGain} min={0} max={2} onChange={(maskGain) => set({ maskGain })} />
          <SliderField label="Lacunarity" value={layer.maskLacunarity} min={1} max={4} onChange={(maskLacunarity) => set({ maskLacunarity })} />
          {layer.maskNoiseType === 'ridged' && (
            <SliderField label="Offset" value={layer.maskOffset} min={0} max={2} onChange={(maskOffset) => set({ maskOffset })} />
          )}
          <SliderField label="Scale" value={layer.maskScale} min={0.05} max={8} step={0.05} onChange={(maskScale) => set({ maskScale })} />
          <SliderField label="Power" value={layer.maskPower} min={0.1} max={5} onChange={(maskPower) => set({ maskPower })} />
          <SliderField label="Threshold" value={layer.maskThreshold} min={0} max={1} onChange={(maskThreshold) => set({ maskThreshold })} />
          <SliderField label="Warp" value={layer.maskWarpStrength} min={0} max={2} onChange={(maskWarpStrength) => set({ maskWarpStrength })} />
          {layer.maskWarpStrength > 0 && (
            <SliderField label="Warp scale" value={layer.maskWarpScale} min={0.1} max={4} step={0.05} onChange={(maskWarpScale) => set({ maskWarpScale })} />
          )}
        </>
      )}
    </Group>
  );
}

function SunControls({ layer, set }: { layer: SunLayer; set: Setter }) {
  return (
    <>
      <Group title="Placement">
        <SliderField label="Longitude°" value={layer.dirLonDeg} min={-180} max={180} integer onChange={(dirLonDeg) => set({ dirLonDeg })} />
        <SliderField label="Latitude°" value={layer.dirLatDeg} min={-89} max={89} integer onChange={(dirLatDeg) => set({ dirLatDeg })} />
        <SliderField label="Size" value={layer.apparentSize} min={0.02} max={1} step={0.005} onChange={(apparentSize) => set({ apparentSize })} />
        <SliderField label="Rotation°" value={layer.rotationDeg} min={-180} max={180} integer onChange={(rotationDeg) => set({ rotationDeg })} />
        <CheckField label="Lock position" value={!!layer.locked} onChange={(locked) => set({ locked: locked || undefined })} />
      </Group>
      <Group title="Star">
        <SliderField label="Temp K" value={layer.kelvin} min={2000} max={30000} step={100} onChange={(kelvin) => set({ kelvin })} />
        <SliderField label="Limb dark" value={layer.limbDarkening} min={0} max={1} onChange={(limbDarkening) => set({ limbDarkening })} />
        <SliderField label="Granules" value={layer.granulation} min={0} max={1} onChange={(granulation) => set({ granulation })} />
        <SliderField label="Corona" value={layer.corona} min={0} max={1} onChange={(corona) => set({ corona })} />
        <SliderField label="Cor. extent" value={layer.coronaExtent} min={0.3} max={2.5} step={0.05} onChange={(coronaExtent) => set({ coronaExtent })} />
        <SliderField label="Prominences" value={layer.prominences} min={0} max={1} onChange={(prominences) => set({ prominences })} />
        <SliderField label="Glow" value={layer.glow} min={0} max={1} onChange={(glow) => set({ glow })} />
      </Group>
      <p className="hint">Add a second sun layer for a binary system.</p>
    </>
  );
}

function PlanetControls({ layer, set }: { layer: PlanetLayer; set: Setter }) {
  return (
    <>
      <Group title="Placement">
        <SliderField label="Longitude°" value={layer.dirLonDeg} min={-180} max={180} integer onChange={(dirLonDeg) => set({ dirLonDeg })} />
        <SliderField label="Latitude°" value={layer.dirLatDeg} min={-89} max={89} integer onChange={(dirLatDeg) => set({ dirLatDeg })} />
        <SliderField label="Size" value={layer.apparentSize} min={0.02} max={1} step={0.005} onChange={(apparentSize) => set({ apparentSize })} />
        <SliderField label="Rotation°" value={layer.rotationDeg} min={-180} max={180} integer onChange={(rotationDeg) => set({ rotationDeg })} />
        <CheckField label="Lock position" value={!!layer.locked} onChange={(locked) => set({ locked: locked || undefined })} />
      </Group>
      <Group title="Surface">
        <ColorField label="Base" value={layer.baseColor} onChange={(baseColor) => set({ baseColor })} />
        <ColorField label="Detail" value={layer.secondColor} onChange={(secondColor) => set({ secondColor })} />
        <SliderField label="Noise scale" value={layer.noiseScale} min={1} max={8} step={0.1} onChange={(noiseScale) => set({ noiseScale })} />
        <SliderField label="Octaves" value={layer.octaves} min={2} max={7} integer onChange={(octaves) => set({ octaves })} />
        <SliderField label="Banding" value={layer.banding} min={0} max={1} onChange={(banding) => set({ banding })} />
        <SliderField label="Light°" value={layer.lightAngleDeg} min={-90} max={90} integer onChange={(lightAngleDeg) => set({ lightAngleDeg })} />
      </Group>
      <Group title="Atmosphere">
        <ColorField label="Color" value={layer.atmosphereColor} onChange={(atmosphereColor) => set({ atmosphereColor })} />
        <SliderField label="Width" value={layer.atmosphereWidth} min={0} max={0.25} step={0.005} onChange={(atmosphereWidth) => set({ atmosphereWidth })} />
      </Group>
      <Group title="Rings">
        <SliderField label="Amount" value={layer.ringAmount} min={0} max={1} onChange={(ringAmount) => set({ ringAmount })} />
        {layer.ringAmount > 0 && (
          <>
            <SliderField label="Inner" value={layer.ringInner} min={1.15} max={2} step={0.05} onChange={(ringInner) => set({ ringInner, ringOuter: Math.max(layer.ringOuter, ringInner + 0.15) })} />
            <SliderField label="Outer" value={layer.ringOuter} min={1.3} max={3} step={0.05} onChange={(ringOuter) => set({ ringOuter, ringInner: Math.min(layer.ringInner, ringOuter - 0.15) })} />
            <SliderField label="Tilt°" value={layer.ringTiltDeg} min={5} max={80} integer onChange={(ringTiltDeg) => set({ ringTiltDeg })} />
            <ColorField label="Color" value={layer.ringColor} onChange={(ringColor) => set({ ringColor })} />
          </>
        )}
      </Group>
    </>
  );
}

function BlackHoleControls({ layer, set }: { layer: BlackHoleLayer; set: Setter }) {
  return (
    <>
      <Group title="Placement">
        <SliderField label="Longitude°" value={layer.dirLonDeg} min={-180} max={180} integer onChange={(dirLonDeg) => set({ dirLonDeg })} />
        <SliderField label="Latitude°" value={layer.dirLatDeg} min={-89} max={89} integer onChange={(dirLatDeg) => set({ dirLatDeg })} />
        <SliderField label="Horizon" value={layer.apparentSize} min={0.01} max={0.35} step={0.005} onChange={(apparentSize) => set({ apparentSize })} />
        <CheckField label="Lock position" value={!!layer.locked} onChange={(locked) => set({ locked: locked || undefined })} />
      </Group>
      <Group title="Lensing">
        <SliderField label="Strength" value={layer.lensStrength} min={0} max={1} onChange={(lensStrength) => set({ lensStrength })} />
        <SliderField label="Photon ring" value={layer.photonRing} min={0} max={1} onChange={(photonRing) => set({ photonRing })} />
      </Group>
      <Group title="Accretion disc">
        <SliderField label="Amount" value={layer.discAmount} min={0} max={1} onChange={(discAmount) => set({ discAmount })} />
        {layer.discAmount > 0 && (
          <>
            <SliderField label="Inner" value={layer.discInner} min={1.2} max={3} step={0.05} onChange={(discInner) => set({ discInner, discOuter: Math.max(layer.discOuter, discInner + 0.3) })} />
            <SliderField label="Outer" value={layer.discOuter} min={1.8} max={8} step={0.1} onChange={(discOuter) => set({ discOuter, discInner: Math.min(layer.discInner, discOuter - 0.3) })} />
            <SliderField label="Tilt°" value={layer.discTiltDeg} min={0} max={90} integer onChange={(discTiltDeg) => set({ discTiltDeg })} />
            <SliderField label="Spin°" value={layer.discSpinDeg} min={-180} max={180} integer onChange={(discSpinDeg) => set({ discSpinDeg })} />
            <SliderField label="Temp K" value={layer.discKelvin} min={2000} max={20000} step={100} onChange={(discKelvin) => set({ discKelvin })} />
            <SliderField label="Doppler" value={layer.discDoppler} min={0} max={1} onChange={(discDoppler) => set({ discDoppler })} />
          </>
        )}
      </Group>
      <p className="hint">
        The lens bends the layers below this one — keep it near the top of
        the stack.
      </p>
    </>
  );
}

function SpriteControls({ layer, set, userSprites }: { layer: SpriteLayer; set: Setter; userSprites: string[] }) {
  const textureOptions = [
    ...FLARE_OPTIONS,
    ...userSprites.map((id) => ({ value: id, label: `⬆ ${id.replace(/^user:/, '')}` })),
  ];
  return (
    <>
      <Group title="Sprite">
        <SelectField label="Texture" value={layer.texture} options={textureOptions} onChange={(texture) => set({ texture })} />
      </Group>
      <Group title="Placement">
        <SliderField label="Longitude°" value={layer.dirLonDeg} min={-180} max={180} onChange={(dirLonDeg) => set({ dirLonDeg })} />
        <SliderField label="Latitude°" value={layer.dirLatDeg} min={-89} max={89} onChange={(dirLatDeg) => set({ dirLatDeg })} />
        <SliderField label="Size" value={layer.apparentSize} min={0.01} max={1.5} step={0.005} onChange={(apparentSize) => set({ apparentSize })} />
        <SliderField label="Stretch" value={layer.aspect} min={0.2} max={5} step={0.05} onChange={(aspect) => set({ aspect })} />
        <SliderField label="Rotation°" value={layer.rotationDeg} min={-180} max={180} integer onChange={(rotationDeg) => set({ rotationDeg })} />
        <CheckField label="Lock position" value={!!layer.locked} onChange={(locked) => set({ locked: locked || undefined })} />
      </Group>
      <p className="hint">Drag the sprite directly in the viewport to place it.</p>
    </>
  );
}
