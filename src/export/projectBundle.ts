/**
 * Native project format (.sspj): a zip bundle containing project.json
 * (JSON v2 layers), assets/<user sprites>, and preview.png. Legacy
 * Spacescape .xml stays import-only.
 */
import { unzipSync, zipSync } from 'fflate';
import { fromJsonString, toJsonString, type ImportResult } from '../core/io';
import type { Layer } from '../core/layers';
import type { SpriteAsset } from '../assets/spriteStore';

export function buildProjectBundle(
  layers: Layer[],
  assets: SpriteAsset[],
  previewPng: Uint8Array | null,
): Blob {
  const entries: Record<string, Uint8Array> = {
    'project.json': new TextEncoder().encode(toJsonString(layers)),
  };
  for (const a of assets) {
    entries[`assets/${a.fileName}`] = a.data;
  }
  // per-asset flags the image bytes can't carry (occluding solid bodies keep
  // their sky-occluding drag default across save/reopen)
  const occluding = assets.filter((a) => a.occludes).map((a) => a.fileName);
  if (occluding.length) {
    entries['assets-meta.json'] = new TextEncoder().encode(JSON.stringify({ occludes: occluding }));
  }
  if (previewPng) entries['preview.png'] = previewPng;

  const zipped = zipSync(entries, { level: 6 });
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
}

export interface BundleContents extends ImportResult {
  assets: Array<{ fileName: string; data: Uint8Array; occludes: boolean }>;
}

export function openProjectBundle(data: Uint8Array): BundleContents {
  const files = unzipSync(data);
  const projectEntry = files['project.json'];
  if (!projectEntry) throw new Error('not a Spacescape project bundle (missing project.json)');

  const result = fromJsonString(new TextDecoder().decode(projectEntry));

  let occluding: string[] = [];
  const metaEntry = files['assets-meta.json'];
  if (metaEntry) {
    try {
      const meta: unknown = JSON.parse(new TextDecoder().decode(metaEntry));
      const list = (meta as { occludes?: unknown }).occludes;
      if (Array.isArray(list)) occluding = list.filter((x): x is string => typeof x === 'string');
    } catch {
      // damaged meta only loses the drag-blend hint; the bundle still opens
    }
  }

  const assets: BundleContents['assets'] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith('assets/') && bytes.length > 0) {
      const fileName = path.slice('assets/'.length);
      assets.push({ fileName, data: bytes, occludes: occluding.includes(fileName) });
    }
  }
  return { ...result, assets };
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export function mimeForFileName(name: string): string {
  return MIME_BY_EXT[name.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream';
}
