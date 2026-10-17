/**
 * The shelf (#195): one tab stop with arrow navigation, spine names, search that dims and never
 * reorders, the catalogue card's open state, and axe on the whole shelf.
 */
import axe from 'axe-core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Shelf, matchPapers, type ShelfPaper } from '@/features/library';

afterEach(cleanup);

const PAPERS: readonly ShelfPaper[] = [
  {
    id: 'ppr_att',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
    pageCount: 15,
    processing: 'complete',
    addedAt: '2026-10-01T00:00:00Z',
    year: 2017,
    arxivCategory: 'cs.CL',
    reading: {
      last_page: 3,
      furthest_page: 3,
      page_count: 15,
      opened_at: '2026-10-10T00:00:00Z',
      finished_at: null,
      state: 'reading',
    },
  },
  {
    id: 'ppr_flash',
    title: 'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness',
    authors: ['Tri Dao', 'Daniel Y. Fu'],
    pageCount: 34,
    processing: 'complete',
    addedAt: '2026-10-02T00:00:00Z',
    year: 2022,
  },
  {
    id: 'ppr_lora',
    title: 'LoRA: Low-Rank Adaptation of Large Language Models',
    authors: ['Edward Hu'],
    pageCount: 0,
    processing: 'parsing',
    addedAt: '2026-10-03T00:00:00Z',
  },
  {
    id: 'ppr_glue',
    title: 'SuperGLUE',
    authors: [],
    pageCount: 29,
    processing: 'failed',
    addedAt: '2026-10-04T00:00:00Z',
  },
];

function renderShelf(overrides: Partial<Parameters<typeof Shelf>[0]> = {}) {
  const onActivate = vi.fn();
  // The card the open spine controls; the library renders the real one (CatalogueCard).
  const view = render(
    <>
      <Shelf
        papers={PAPERS}
        arrangement="topic"
        matches={null}
        openId={null}
        cardId="card"
        onActivate={onActivate}
        {...overrides}
      />
      <section id="card" aria-label="Catalogue card" />
    </>,
  );
  const spines = () =>
    within(screen.getByRole('toolbar', { name: 'Shelf' })).getAllByRole('button');
  return { ...view, onActivate, spines };
}

describe('the shelf is one tab stop', () => {
  it('has exactly one spine in the tab order, the first by default', () => {
    const { spines } = renderShelf();
    const stops = spines().filter((spine) => spine.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('data-paper-id')).toBe('ppr_att');
  });

  it('walks with the arrows, jumps with Home and End, and stops at the ends', () => {
    const { spines } = renderShelf();
    const toolbar = screen.getByRole('toolbar', { name: 'Shelf' });
    const at = () => document.activeElement?.getAttribute('data-paper-id');
    spines()[0]?.focus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(at()).toBe('ppr_flash');
    fireEvent.keyDown(toolbar, { key: 'End' });
    expect(at()).toBe('ppr_glue');
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(at()).toBe('ppr_glue');
    fireEvent.keyDown(toolbar, { key: 'Home' });
    expect(at()).toBe('ppr_att');
    fireEvent.keyDown(toolbar, { key: 'ArrowLeft' });
    expect(at()).toBe('ppr_att');
    // The tab stop follows focus, so Tab back into the shelf lands where you left it.
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(
      spines()
        .filter((s) => s.tabIndex === 0)
        .map((s) => s.dataset['paperId']),
    ).toEqual(['ppr_flash']);
  });
});

describe('spines', () => {
  it('are named with the title, authors, year and state', () => {
    renderShelf();
    expect(
      screen.getByRole('button', {
        name: 'Attention Is All You Need, Vaswani et al., 2017, reading now, p. 4 of 15',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^LoRA: Low-Rank .*, Hu, being read$/ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'SuperGLUE, could not read' })).toBeTruthy();
  });

  it('print the short title, and show the ribbon, kraft wrap and torn label', () => {
    const { container } = renderShelf();
    const spine = (id: string) =>
      container.querySelector<HTMLElement>(`[data-paper-id="${id}"]`) as HTMLElement;
    expect(spine('ppr_flash').textContent).toContain('FlashAttention');
    expect(spine('ppr_flash').textContent).not.toContain('IO-Awareness');
    expect(spine('ppr_att').querySelector('.pt-spine__ribbon')).not.toBeNull();
    expect(spine('ppr_flash').querySelector('.pt-spine__ribbon')).toBeNull();
    expect(spine('ppr_lora').className).toContain('pt-spine--kraft');
    expect(spine('ppr_lora').textContent).toContain('being read');
    expect(spine('ppr_glue').className).toContain('pt-spine--torn');
    expect(spine('ppr_glue').textContent).toContain('could not read');
  });

  it('stand in a group named for their holder', () => {
    renderShelf();
    expect(screen.getByRole('group', { name: 'Unshelved, 4 papers' })).toBeTruthy();
  });

  it('call back on activation and say which one is open', () => {
    const { onActivate } = renderShelf({ openId: 'ppr_flash' });
    fireEvent.click(screen.getByRole('button', { name: /^Attention/ }));
    expect(onActivate).toHaveBeenCalledWith('ppr_att');
    const open = screen.getByRole('button', { name: /^FlashAttention/ });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.getAttribute('aria-controls')).toBe('card');
    expect(screen.getByRole('button', { name: /^Attention/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});

describe('search lights the shelf in place', () => {
  it('dims what does not match, lights what does, and reorders nothing', () => {
    const { spines, rerender, onActivate } = renderShelf();
    const order = spines().map((s) => s.dataset['paperId']);
    expect(spines().every((s) => s.dataset['match'] === undefined)).toBe(true);

    const matches = matchPapers(PAPERS, 'atten');
    expect(matches?.size).toBe(2);
    rerender(
      <>
        <Shelf
          papers={PAPERS}
          arrangement="topic"
          matches={matches}
          openId={null}
          cardId="card"
          onActivate={onActivate}
        />
        <section id="card" aria-label="Catalogue card" />
      </>,
    );
    expect(spines().map((s) => s.dataset['paperId'])).toEqual(order);
    expect(
      Object.fromEntries(spines().map((s) => [s.dataset['paperId'], s.dataset['match']])),
    ).toEqual({ ppr_att: 'true', ppr_flash: 'true', ppr_lora: 'false', ppr_glue: 'false' });
    expect(screen.getByRole('toolbar').getAttribute('data-searching')).toBe('true');
  });
});

describe('axe', () => {
  it('finds no violations on the shelf (layout-bound rules need a browser; see a11y.spec)', async () => {
    const { container } = renderShelf({ openId: 'ppr_att' });
    const results = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    });
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(results.passes.some((p) => p.id === 'button-name')).toBe(true);
  });
});
