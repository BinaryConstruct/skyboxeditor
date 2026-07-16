import { describe, expect, it } from 'vitest';
import { buildSceneJsonSchema } from './io';

describe('published scene JSON schema', () => {
  it('matches the FIELDS/OPTIONAL tables (regenerate with vitest -u)', async () => {
    const json = JSON.stringify(buildSceneJsonSchema(), null, 2) + '\n';
    await expect(json).toMatchFileSnapshot('../../public/schema/scene.v2.schema.json');
  });
});
