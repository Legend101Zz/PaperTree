/**
 * s4-navigator — the Contents panel's Outline shows every section's title, and the unanchored tray
 * says what its Delete removes (s4-review.md F4 and the tray note).
 *
 * F4 was a class tie: the parent-section toggle carried `w-full` (the row's base) and `w-11` (its
 * own), Tailwind resolved it by stylesheet order, and the toggle — holding only "▾" — took the whole
 * row, so "1. Introduction" existed only in an `aria-label`. happy-dom lays nothing out, so this
 * pins the cause (the toggle's classes) and the effect a layout-free DOM can show (the title is a
 * button's visible text); `e2e/s4/journey-b` measures the rendered widths.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { indexDocument, resolveAnchor, captureAnchor, type PaperSource } from '@papertree/anchoring';

import { Navigator } from '@/components/reader/Navigator';
import { UnanchoredTray } from '@/components/reader/UnanchoredTray';

const source = JSON.parse(
  readFileSync(`${process.cwd()}/../../packages/document-ir/fixtures/resnet-cvpr-2col.paperir.json`, 'utf8'),
) as PaperSource;
const doc = indexDocument(source, 's4-navigator.spec');

afterEach(() => {
  cleanup();
});

describe('s4: the Contents panel', () => {
  it('every outline row with children shows its title as a button’s visible text, beside a compact toggle', () => {
    render(
      <Navigator
        doc={doc}
        pages={doc.pages.map((p) => ({ index: p.index, width: p.width, height: p.height }))}
        open
        onClose={() => undefined}
        onNavigateToBlock={() => undefined}
        onNavigateToPage={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Contents' })).toBeTruthy();
    const outline = screen.getByRole('navigation', { name: 'Document outline' });
    const toggles = within(outline).getAllByRole('button', { name: /^(Collapse|Expand) / });
    expect(toggles.length, 'the fixture has sections with subsections').toBeGreaterThan(0);
    for (const toggle of toggles) {
      const title = (toggle.getAttribute('aria-label') ?? '').replace(/^(Collapse|Expand) /, '');
      // The toggle is compact: its own width, never the row's full width.
      expect(toggle.className.split(/\s+/)).toContain('w-11');
      expect(toggle.className.split(/\s+/)).not.toContain('w-full');
      // The title is VISIBLE text on the navigate button beside it.
      const row = toggle.parentElement as HTMLElement;
      const navigate = Array.from(row.querySelectorAll('button')).find((b) => b !== toggle);
      expect(navigate?.textContent).toContain(title);
      expect(navigate?.className.split(/\s+/)).toContain('flex-1');
    }
  });
});

describe('s4: the unanchored tray', () => {
  const block = doc.blocks.find((b) => b.type === 'paragraph' && b.textCodePoints.length > 80);
  if (block === undefined) throw new Error('fixture has no paragraph');
  const anchor = captureAnchor({
    doc,
    blockId: block.id,
    startOffset: 0,
    endOffset: 30,
    targetKind: 'text',
    id: '6f0e4f8e-0000-4000-8000-0000000000aa',
    at: '2026-09-26T00:00:00.000Z',
    client: 'test',
  });
  const item = { anchor, resolution: resolveAnchor(anchor, doc), highlightId: 'hl_x' };

  it('says Delete removes the WHOLE highlight when other passages of it still paint', () => {
    render(<UnanchoredTray items={[{ ...item, placedElsewhere: 2 }]} onJumpToPage={() => undefined} onForget={() => undefined} />);
    screen.getByRole('button', { name: /could not be placed/ }).click();
    return Promise.resolve().then(() => {
      expect(screen.getByRole('button', { name: 'Delete the whole highlight' })).toBeTruthy();
      expect(screen.getByText(/other 2 passages of this highlight are still on the page/)).toBeTruthy();
    });
  });

  it('keeps the plain label when nothing else of it is on the page', () => {
    render(<UnanchoredTray items={[item]} onJumpToPage={() => undefined} onForget={() => undefined} />);
    screen.getByRole('button', { name: /could not be placed/ }).click();
    return Promise.resolve().then(() => {
      expect(screen.getByRole('button', { name: 'Delete highlight' })).toBeTruthy();
    });
  });
});
