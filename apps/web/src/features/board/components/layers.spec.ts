/**
 * The header (and the "More board tools" menu that drops from it) paints over everything the
 * board puts on its stage: the legend, the minimap, the selected-thread bar and the "Link as"
 * picker. With the header at z 6 and the selected-thread bar at z 7, the bar covered the menu
 * and "Frame selected cards" could not be clicked while a thread was selected (#214, caught by
 * e2e/s7/canvas-journey). This reads the stylesheets, as `pins-contrast.spec` does.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = (file: string) => readFileSync(resolve(HERE, file), 'utf8');
const UI = readFileSync(resolve(HERE, '../../../../../../packages/ui/src/styles.css'), 'utf8');

/** The `z-index` of the first rule whose selector is exactly `selector`. */
function zIndex(sheet: string, selector: string): number {
  const start = sheet.indexOf(`\n${selector} {`);
  expect(start, `no ${selector} rule`).toBeGreaterThan(-1);
  const rule = sheet.slice(start, sheet.indexOf('\n}', start));
  const z = /z-index:\s*(\d+)/.exec(rule)?.[1];
  expect(z, `${selector} has no z-index`).toBeDefined();
  return Number(z);
}

describe('the header sits over the stage', () => {
  it('outranks the legend, the empty board, the selected-thread bar and the Link-as picker', () => {
    const header = zIndex(css('chrome.css'), '.pt-boardbar');
    const stage = {
      legend: zIndex(css('legend.css'), '.pt-legend'),
      'selected-thread bar': zIndex(UI, '.pt-cv__edgebar'),
      'empty board': zIndex(UI, '.pt-cv__empty'),
      'Link as picker': zIndex(css('linkAs.css'), '.pt-linkas'),
    };
    for (const [name, z] of Object.entries(stage)) {
      expect(
        header,
        `the header (${String(header)}) under the ${name} (${String(z)})`,
      ).toBeGreaterThan(z);
    }
  });
});

describe('the header title never runs under the tools', () => {
  // At 1440px the tools take the bar and the title is squeezed to a few px. The card counts are
  // `flex: none`, so without this they spilled out and sat under the Select tool.
  it('clips its title, and drops the counts when it has no room for them', () => {
    const sheet = css('chrome.css');
    const start = sheet.indexOf('\n.pt-boardbar__title {');
    const rule = sheet.slice(start, sheet.indexOf('\n}', start));
    expect(rule).toMatch(/overflow:\s*hidden;/);
    expect(rule).toMatch(/container-type:\s*inline-size;/);
    expect(sheet).toMatch(
      /@container \(max-width: \d+px\) \{\s*\.pt-boardbar__counts \{\s*display: none;/,
    );
    // ...and the heading stays for screen readers, never as a sliver of its first letter.
    const query = sheet.slice(sheet.indexOf('@container (max-width:'));
    expect(query.slice(0, query.indexOf('\n}'))).toMatch(
      /\.pt-boardbar__h1 \{[^}]*clip-path: inset\(50%\);/,
    );
  });
});

describe('a key hint on a filled button', () => {
  it('takes the button ink, not the dark hint ink (unreadable on the accent)', () => {
    expect(css('tree/tree.css')).toMatch(/\n\.pt-ask__send kbd \{[^}]*color: inherit;/);
  });
});
