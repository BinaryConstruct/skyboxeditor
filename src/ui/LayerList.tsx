/**
 * Layer stack: select, toggle visibility, reorder, duplicate, delete, add.
 * File order = draw order (first = furthest back).
 */
import type { Layer, LayerType } from '../core/layers';

const TYPE_LABELS: Record<LayerType, string> = {
  noise: 'nebula',
  points: 'stars',
  billboards: 'flares',
  volumetric: 'volume',
  galaxy: 'galaxy',
  sun: 'sun',
  planet: 'planet',
  blackhole: 'b-hole',
  sprite: 'sprite',
};

interface LayerListProps {
  layers: Layer[];
  selected: number;
  hidden: ReadonlySet<number>;
  onSelect: (index: number) => void;
  onToggleVisible: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onAdd: (type: LayerType) => void;
  onToggleLock: (index: number) => void;
}

/** layers with spherical placement — the ones the viewport can drag */
const isPositional = (layer: Layer): boolean => 'dirLonDeg' in layer;

export function LayerList({
  layers, selected, hidden,
  onSelect, onToggleVisible, onMove, onDuplicate, onDelete, onAdd, onToggleLock,
}: LayerListProps) {
  return (
    <div className="layer-panel">
      <div className="layer-panel-head">
        <h2>Layers</h2>
      </div>
      <div className="add-layer-grid">
        <button type="button" title="Add nebula layer" onClick={() => onAdd('noise')}>+nebula</button>
        <button type="button" title="Add star layer" onClick={() => onAdd('points')}>+stars</button>
        <button type="button" title="Add flare layer" onClick={() => onAdd('billboards')}>+flares</button>
        <button type="button" title="Add volumetric nebula layer" onClick={() => onAdd('volumetric')}>+volume</button>
        <button type="button" title="Add hero galaxy layer" onClick={() => onAdd('galaxy')}>+galaxy</button>
        <button type="button" title="Add positional sun layer (add two for a binary)" onClick={() => onAdd('sun')}>+sun</button>
        <button type="button" title="Add positional planet layer" onClick={() => onAdd('planet')}>+planet</button>
        <button type="button" title="Add black hole (lenses the layers below it)" onClick={() => onAdd('blackhole')}>+b.hole</button>
        <button type="button" title="Add sprite quad (PCG bakes / uploads) — drag it in the viewport to place" onClick={() => onAdd('sprite')}>+sprite</button>
      </div>

      <ol className="layer-list">
        {layers.map((layer, i) => (
          <li
            key={i}
            className={[
              i === selected ? 'selected' : '',
              hidden.has(i) ? 'hidden-layer' : '',
            ].join(' ')}
            onClick={() => onSelect(i)}
          >
            <button
              type="button"
              className="eye"
              title={hidden.has(i) ? 'Show layer' : 'Hide layer'}
              onClick={(e) => { e.stopPropagation(); onToggleVisible(i); }}
            >
              {hidden.has(i) ? '◌' : '●'}
            </button>
            <span className={`badge badge-${layer.type}`}>{TYPE_LABELS[layer.type]}</span>
            <span className="layer-name" title={layer.name}>{layer.name}</span>
            <span className="row-actions">
              {isPositional(layer) && (
                <button
                  type="button"
                  className={layer.locked ? 'lock-on' : ''}
                  title={layer.locked ? 'Unlock position (allow viewport drag)' : 'Lock position (prevent viewport drag)'}
                  onClick={(e) => { e.stopPropagation(); onToggleLock(i); }}
                >
                  {layer.locked ? '🔒' : '🔓'}
                </button>
              )}
              <button type="button" title="Move back" disabled={i === 0}
                onClick={(e) => { e.stopPropagation(); onMove(i, -1); }}>↑</button>
              <button type="button" title="Move forward" disabled={i === layers.length - 1}
                onClick={(e) => { e.stopPropagation(); onMove(i, 1); }}>↓</button>
              <button type="button" title="Duplicate"
                onClick={(e) => { e.stopPropagation(); onDuplicate(i); }}>⧉</button>
              <button type="button" title="Delete"
                onClick={(e) => { e.stopPropagation(); onDelete(i); }}>✕</button>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
