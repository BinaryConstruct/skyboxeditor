import { describe, expect, it } from 'vitest';
import { buildProjectBundle, openProjectBundle } from './projectBundle';
import type { SpriteAsset } from '../assets/spriteStore';

function asset(fileName: string, occludes: boolean): SpriteAsset {
  return {
    id: `user:${fileName}`,
    fileName,
    data: new Uint8Array([1, 2, 3]),
    mime: 'image/png',
    url: '',
    occludes,
  };
}

async function roundTrip(assets: SpriteAsset[]) {
  const blob = buildProjectBundle([], assets, null);
  return openProjectBundle(new Uint8Array(await blob.arrayBuffer()));
}

describe('project bundle asset metadata', () => {
  it('persists the occludes flag across save and reopen', async () => {
    const bundle = await roundTrip([asset('body.png', true), asset('flare.png', false)]);
    const byName = Object.fromEntries(bundle.assets.map((a) => [a.fileName, a.occludes]));
    expect(byName).toEqual({ 'body.png': true, 'flare.png': false });
  });

  it('opens bundles without assets-meta.json with occludes false', async () => {
    const bundle = await roundTrip([asset('flare.png', false)]);
    expect(bundle.assets[0].occludes).toBe(false);
  });
});
