/**
 * Writes the reviewed fixtures as static SVG files, drawn by the real layout and drawing code, so
 * a before/after comparison can be looked at. A no-op unless `PT_DIAGRAM_SVG_DIR` names the folder:
 *
 *   PT_DIAGRAM_SVG_DIR=/path/after pnpm --filter papertree-web exec vitest run test/diagram-render-fixtures.spec.tsx
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LayeredDrawing } from '@/features/diagram/components/LayeredDrawing';
import { parseDiagramFence } from '@/features/diagram/model/fence';
import { layoutLayered } from '@/features/diagram/model/layered';

const OUT = process.env['PT_DIAGRAM_SVG_DIR'];

const RULES = (page: string, ink: string): string => `
  .pt-dg { --pt-ink: ${ink}; --pt-page: ${page}; --pt-font-paper: 'Libre Caslon Text', Georgia, serif; }
  .pt-plate__box { fill: var(--pt-page); stroke: var(--pt-ink); }
  .pt-plate__rule { fill: none; stroke: var(--pt-ink); stroke-width: 0.8; }
  .pt-plate__hatch { stroke: var(--pt-ink); opacity: 0.55; }
  .pt-plate__label { font-family: var(--pt-font-paper); font-weight: 700; fill: var(--pt-ink); }
  .pt-dg__part[data-kind='input'] .pt-plate__label { font-style: italic; }
  .pt-plate__route polyline { fill: none; stroke: var(--pt-ink); stroke-width: 1.4; }
  .pt-plate__route path { fill: var(--pt-ink); }
  .pt-dg__route[data-feedback='true'] polyline { stroke-dasharray: 5 3; }
  .pt-dg__elabel { font: italic 13px var(--pt-font-paper); fill: var(--pt-ink); paint-order: stroke; stroke: var(--pt-page); stroke-width: 4px; stroke-linejoin: round; }
  .pt-dg__math { display: flex; align-items: center; justify-content: center; height: 100%; text-align: center; font-family: var(--pt-font-paper); font-weight: 700; line-height: 1.15; color: var(--pt-ink); overflow: hidden; }
  .pt-dg__math[data-kind='input'] { font-style: italic; }
  svg.pt-dg { background: var(--pt-page); }
`;

describe.skipIf(OUT === undefined)('render the reviewed fixtures to static SVG', () => {
  it('writes one svg per fixture and width', () => {
    const dir = OUT as string;
    mkdirSync(dir, { recursive: true });
    const katexDir = dirname(createRequire(import.meta.url).resolve('katex/package.json'));
    const katexCss = readFileSync(join(katexDir, 'dist/katex.min.css'), 'utf8').replaceAll(
      'url(fonts/',
      `url(file://${join(katexDir, 'dist/fonts')}/`,
    );
    const rows = readFileSync(`${process.cwd()}/test/fixtures/diagram-review-fences.jsonl`, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { id: string; paper: string; kind: string; fence: string });
    const index: string[] = [];
    for (const row of rows) {
      const fig = parseDiagramFence(row.fence.replace(/^```diagram\n/, '').replace(/\n```$/, ''));
      expect(fig).not.toBeNull();
      if (fig === null) continue;
      for (const width of [520, 300]) {
        const layout = layoutLayered(fig.parts, fig.links, width);
        const svg = renderToStaticMarkup(<LayeredDrawing layout={layout} title={fig.title} />)
          .replaceAll('&nbsp;', '&#160;')
          .replace(
            /<defs>/,
            `<style>${RULES('#faf8f3', '#2a2521')}\n${katexCss}\n@media (prefers-color-scheme: dark) { ${RULES('#2c251f', '#ede4d3')} }</style><defs>`,
          );
        const name = `${row.id}-${width === 520 ? 'panel' : 'card'}.svg`;
        writeFileSync(join(dir, name), `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`);
      }
      index.push(
        `<section><h3>${row.id}: ${row.paper} (${row.kind})</h3><div class="row"><img src="${row.id}-panel.svg" alt=""><img src="${row.id}-card.svg" alt=""></div></section>`,
      );
    }
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Layered diagrams, after</title><style>body{font:14px system-ui;margin:24px;background:#eee}section{margin:0 0 28px}.row{display:flex;gap:24px;align-items:flex-start}img{border:1px solid #999;background:#faf8f3}</style><h2>After: panel width (520) and card width (300)</h2>${index.join('')}`,
    );
  });
});
