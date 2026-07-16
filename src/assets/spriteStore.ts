/**
 * User-uploaded sprite assets (flare textures). Layers reference them by the
 * id "user:<filename>"; project bundles persist them under assets/.
 */
import { invalidateFlareTexture, setUserSpriteResolver } from '../render/flareTextures';

export interface SpriteAsset {
  /** texture id, e.g. "user:myflare.png" */
  id: string;
  fileName: string;
  data: Uint8Array;
  mime: string;
  url: string;
  /**
   * True for baked solid bodies (planet/sun/PCG star or planet) that carry an
   * opaque-disc alpha and should occlude the sky. Used as the default blend
   * hint when the sprite is dragged onto the viewport. Uploads default false.
   */
  occludes?: boolean;
}

const assets = new Map<string, SpriteAsset>();
setUserSpriteResolver((id) => assets.get(id)?.url);

export function addSpriteAsset(
  fileName: string,
  data: Uint8Array,
  mime: string,
  occludes = false,
): SpriteAsset {
  const id = `user:${fileName}`;
  const old = assets.get(id);
  if (old) URL.revokeObjectURL(old.url);

  const url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: mime }));
  const asset: SpriteAsset = { id, fileName, data, mime, url, occludes };
  assets.set(id, asset);
  invalidateFlareTexture(id);
  return asset;
}

export function removeSpriteAsset(id: string): void {
  const asset = assets.get(id);
  if (!asset) return;
  URL.revokeObjectURL(asset.url);
  assets.delete(id);
  invalidateFlareTexture(id);
}

export function getSpriteAsset(id: string): SpriteAsset | undefined {
  return assets.get(id);
}

export function listSpriteAssets(): SpriteAsset[] {
  return [...assets.values()];
}

export function clearSpriteAssets(): void {
  for (const a of assets.values()) URL.revokeObjectURL(a.url);
  assets.clear();
}
