/**
 * Sprites tab: fixed texture assets — the bundled flare set plus user
 * uploads. Uploads persist inside project bundles (assets/), and layers
 * reference them via "user:<filename>" texture ids.
 */
import { useRef } from 'react';
import { addSpriteAsset, listSpriteAssets, removeSpriteAsset } from '../assets/spriteStore';
import { mimeForFileName } from '../export/projectBundle';

export const BUNDLED_SPRITES = [
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
];

interface SpritesTabProps {
  /** bumped by the parent so the list re-renders after add/remove */
  version: number;
  onChanged: () => void;
}

export function SpritesTab({ onChanged }: SpritesTabProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const userSprites = listSpriteAssets();

  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const data = new Uint8Array(await file.arrayBuffer());
      addSpriteAsset(file.name, data, file.type || mimeForFileName(file.name));
    }
    onChanged();
  };

  return (
    <div className="asset-tab">
      <div className="layer-panel-head">
        <h2>Your sprites</h2>
        <span className="add-buttons">
          <button type="button" onClick={() => fileRef.current?.click()}>Upload…</button>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {userSprites.length === 0 && (
        <p className="hint">
          Upload PNG/JPEG/WebP flare textures, or bake one in the PCG tab —
          both land here as draggable cards, save inside the project bundle,
          and appear in flare layers' Texture picker as "user: …".
        </p>
      )}
      <div className="asset-grid">
        {userSprites.map((a) => (
          <figure key={a.id} className="asset-card">
            <img
              src={a.url}
              alt={a.fileName}
              draggable
              title={a.occludes
                ? 'Drag into the viewport to place on the sky (occludes what\'s behind it)'
                : 'Drag into the viewport to place on the sky'}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-spacescape-sprite', a.id);
                // solid PCG/planet/sun bakes occlude the sky — carry that through
                // the drop so the placed sprite gets the right blend factors
                e.dataTransfer.setData('application/x-spacescape-occludes', a.occludes ? 'true' : 'false');
              }}
            />
            <figcaption title={a.fileName}>
              {a.occludes ? '● ' : ''}{a.fileName}
            </figcaption>
            <button
              type="button"
              className="dice"
              title="Remove sprite"
              onClick={() => {
                removeSpriteAsset(a.id);
                onChanged();
              }}
            >
              ✕
            </button>
          </figure>
        ))}
      </div>

      <h2>Bundled flares</h2>
      <div className="asset-grid">
        {BUNDLED_SPRITES.map((name) => (
          <figure key={name} className="asset-card">
            <img
              src={`${import.meta.env.BASE_URL}media/textures/${name}`}
              alt={name}
              draggable
              title="Drag into the viewport to place on the sky"
              onDragStart={(e) => e.dataTransfer.setData('application/x-spacescape-sprite', name)}
            />
            <figcaption title={name}>{name.replace(/\.png$/, '')}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
