'use client';

/**
 * board/components/tree/SpanMenu — the mini menu on selected words in an answer (P4 step 9, V3-22):
 * Ask about this… · Simpler · Example · Diagram · Keep as note. Enter is Ask about this; 1 to 4
 * are Simpler, Example, Diagram, Keep as note. Escape closes it (the board's Escape order).
 *
 * It lives in the stage, not in the zoomed board, so it is always full size, and `placeMenu`
 * keeps it inside the pane: below the words, above when there is no room below, shifted sideways
 * rather than cut off (#349).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { QUICK_ASKS, type QuickAsk } from '../../model/askPayload';
import { placeMenu } from '../../model/panes';
import { useBranch } from '../BranchContext';

import type { MenuState } from '../../model/ui';

const FALLBACK = { w: 216, h: 188 };

/** The items, in key order. */
const ITEMS: readonly {
  readonly key: string;
  readonly quick: QuickAsk | 'note';
  readonly label: string;
}[] = [
  { key: '1', quick: 'simpler', label: QUICK_ASKS.simpler.label },
  { key: '2', quick: 'example', label: QUICK_ASKS.example.label },
  { key: '3', quick: 'diagram', label: QUICK_ASKS.diagram.label },
  { key: '4', quick: 'note', label: 'Keep as note' },
];

/** What a key does with the menu open, or null for a key the menu leaves alone. */
export function menuKey(key: string): QuickAsk | 'note' | 'ask' | null {
  if (key === 'Enter') return 'ask';
  return ITEMS.find((item) => item.key === key)?.quick ?? null;
}

/** The menu for the open selection. */
export function SpanMenu({ menu }: { readonly menu: MenuState }): ReactNode {
  const branch = useBranch();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(FALLBACK);
  const stage = branch.stage.current;

  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const next = { w: el.offsetWidth || FALLBACK.w, h: el.offsetHeight || FALLBACK.h };
    setSize((s) => (s.w === next.w && s.h === next.h ? s : next));
  }, [menu]);

  const run = (what: QuickAsk | 'note' | 'ask'): void => {
    if (what === 'ask') branch.control.openAsk(menu.cardId, { span: menu.span });
    else if (what === 'note') void branch.keepNote(menu.cardId, menu.span);
    else void branch.quick(menu.cardId, menu.span, what);
    window.getSelection()?.removeAllRanges();
  };

  // Enter and 1 to 4 act on the menu while it is open (not while the reader is typing somewhere).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]') !== null
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const what = menuKey(event.key);
      if (what === null) return;
      event.preventDefault();
      run(what);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `run` closes over the open menu only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);

  const pane = { w: stage?.clientWidth ?? 1024, h: stage?.clientHeight ?? 768 };
  const place = placeMenu(menu.anchor, size, pane);

  return (
    <div
      ref={box}
      className="pt-span-menu"
      role="menu"
      tabIndex={-1}
      aria-label="On the selected words"
      data-flipped={place.flipped}
      style={{ insetInlineStart: place.left, insetBlockStart: place.top }}
      // Pressing a menu item must not clear the selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="pt-span-menu__item"
        onClick={() => run('ask')}
      >
        Ask about this…
        <kbd aria-hidden="true">Enter</kbd>
      </button>
      {ITEMS.slice(0, 3).map((item) => (
        <button
          key={item.quick}
          type="button"
          role="menuitem"
          className="pt-span-menu__item"
          onClick={() => run(item.quick)}
        >
          {item.label}
          <kbd aria-hidden="true">{item.key}</kbd>
        </button>
      ))}
      <span className="pt-span-menu__rule" aria-hidden="true" />
      <button
        type="button"
        role="menuitem"
        className="pt-span-menu__item"
        onClick={() => run('note')}
      >
        Keep as note
        <kbd aria-hidden="true">4</kbd>
      </button>
    </div>
  );
}
