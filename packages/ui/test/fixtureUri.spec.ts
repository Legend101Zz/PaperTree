/**
 * @vitest-environment node
 *
 * Node, not happy-dom: this walks the fixture JSON off disk, and under the DOM environment
 * `import.meta.url` is a served URL rather than a `file:` one, so `fileURLToPath` cannot resolve it.
 * The resolver itself has no DOM dependency, which is the point — it is a string function.
 *
 * The resolver's claims, checked against the real fixture set rather than against examples I wrote.
 *
 * Every `image.uri` in `packages/document-ir/fixtures/*.json` is walked, resolved, and the result
 * checked to exist on disk under `fixtures/assets/`. That is the only assertion that can fail when
 * somebody adds a fourth paper whose slug or filename does not fit the whitelist — and failing here
 * is the whole point of throwing rather than returning a best-effort path.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isFixtureUri, parseFixtureUri, resolveFixtureUri } from '../src/fixtureUri.js';

const FIXTURE_DIR = fileURLToPath(new URL('../../document-ir/fixtures/', import.meta.url));

function everyFixtureUri(): readonly string[] {
  const uris = new Set<string>();
  for (const name of readdirSync(FIXTURE_DIR)) {
    if (!name.endsWith('.json')) continue;
    for (const match of readFileSync(join(FIXTURE_DIR, name), 'utf8').matchAll(/fixture:\/\/[^"]+/g)) {
      uris.add(match[0]);
    }
  }
  return [...uris].sort();
}

describe('resolveFixtureUri — against the real assets', () => {
  const uris = everyFixtureUri();

  it('finds the fixture URIs the brief says exist', () => {
    expect(uris.length).toBe(29);
  });

  it('resolves every one of them to a file that is actually there', () => {
    const missing: string[] = [];
    for (const uri of uris) {
      const url = resolveFixtureUri(uri);
      expect(url.startsWith('/fixtures/')).toBe(true);
      // `/fixtures/<slug>/<rest>` is the URL contract; `fixtures/assets/<slug>/<rest>` is where the
      // bytes are. Whatever serves them owns that mapping — this reproduces it to check the tail.
      if (!existsSync(join(FIXTURE_DIR, 'assets', url.slice('/fixtures/'.length)))) missing.push(uri);
    }
    expect(missing).toEqual([]);
  });

  it('honours a baseUrl and does not double its trailing slash', () => {
    const uri = 'fixture://resnet-cvpr-2col/pages/000@2x.png';
    expect(resolveFixtureUri(uri, 'https://cdn.example')).toBe(
      'https://cdn.example/fixtures/resnet-cvpr-2col/pages/000@2x.png',
    );
    expect(resolveFixtureUri(uri, 'https://cdn.example/')).toBe(
      'https://cdn.example/fixtures/resnet-cvpr-2col/pages/000@2x.png',
    );
  });

  it('leaves `@` unescaped — it is a legal path character and every crop filename uses it', () => {
    expect(resolveFixtureUri('fixture://neural-odes-mathheavy/equations/blk_izoxetonhyvkprln@8x.png')).toContain(
      '@8x.png',
    );
  });
});

describe('parseFixtureUri — malformed input throws, never returns a broken path', () => {
  it('splits slug from path', () => {
    expect(parseFixtureUri('fixture://resnet-cvpr-2col/pages/000@2x.png')).toEqual({
      slug: 'resnet-cvpr-2col',
      path: 'pages/000@2x.png',
    });
  });

  it.each([
    ['https://example.com/x.png', /expected it to start with/],
    ['fixture://', /names no slug/],
    ['fixture://slug', /no asset path/],
    ['fixture:///pages/000.png', /slug is empty/],
    ['fixture://slug/', /asset path is empty/],
    ['fixture://slug/pages//000.png', /empty segment/],
    ['fixture://slug/../../etc/passwd', /relative segment/],
    ['fixture://../etc/passwd', /relative segment/],
    ['fixture://slug/pages/000.png?v=2', /query strings and fragments/],
    ['fixture://slug/pages/a b.png', /outside/],
  ])('rejects %s', (uri, message) => {
    expect(() => parseFixtureUri(uri)).toThrow(message);
  });
});

describe('isFixtureUri', () => {
  it('is the guard callers use before reaching for the resolver', () => {
    expect(isFixtureUri('fixture://slug/a.png')).toBe(true);
    expect(isFixtureUri('https://example.com/a.png')).toBe(false);
    expect(isFixtureUri('')).toBe(false);
  });
});
