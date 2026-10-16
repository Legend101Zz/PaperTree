'use client';

/**
 * explain — the explain panel (contracts.md §5). Owned by S6.
 *
 * A right drawer from 768 px up, a bottom `Sheet` below it. It is mounted once by
 * `ReaderWorkspace`, takes the controller as one prop, and reaches the reader only through
 * `useReaderActions()` (`focusAnchor` for a chip, `sendToCanvas` for the canvas), so it knows
 * nothing about the PDF.
 *
 * WHAT IS ON SCREEN, top to bottom: the selected passage in the paper's own register
 * (`PaperText`), the conversation (model text in `AiText` with the ⊙ and its "AI interpretation"
 * label), and a composer. "Summarize paper" swaps the conversation for the summary. Closed, a small
 * "Ask AI" button is the entry for a free question or the summary, since both exist without a
 * selection.
 */
import { PaperText, Sheet, type SheetDetent } from '@papertree/ui';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { useReaderActions } from '@/components/reader/actions';
import { ThreadReadFailure } from '@/features/explain/components/ThreadReadFailure';
import { useThreads } from '@/features/explain/hooks/useThreads';
import type { Citation } from '@/lib/api/types';
import { dehyphenate, truncateAtWord } from '@/lib/markdown';

import { AnswerView } from './AnswerView';
import { SummaryView } from './SummaryView';
import type { ExplainController } from './useExplainActions';

export type { ExplainController, ExplainRequest } from './useExplainActions';
export { useExplainActions } from './useExplainActions';

export interface ExplainPanelProps {
  readonly controller: ExplainController;
}

const DESKTOP = '(min-width: 768px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** `p. 4` for the quote's attribution, from the anchor's page selector. */
function quotePage(anchor: unknown): string | undefined {
  const selectors = (anchor as { selectors?: { type?: string; index?: number }[] }).selectors ?? [];
  const page = selectors.find((s) => s.type === 'PageSelector');
  return page?.index === undefined ? undefined : `p. ${String(page.index + 1)}`;
}

const QUOTE_FOLD = 320;

function Quote({
  quote: raw,
  anchor,
}: {
  readonly quote: string;
  readonly anchor: unknown;
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  // Display only: the selection keeps the PDF's line-end hyphens ("sin- gle"); the stored
  // Anchor's TextQuote is untouched.
  const quote = dehyphenate(raw).replace(/\s+/g, ' ').trim();
  const long = quote.length > QUOTE_FOLD;
  const shown = long && !expanded ? truncateAtWord(quote, QUOTE_FOLD) : quote;
  const page = quotePage(anchor);
  return (
    <section className="pt-explain__quote" aria-label="Selected passage" data-explain-quote>
      <PaperText as="blockquote" {...(page === undefined ? {} : { pageLabel: page })}>
        {shown}
      </PaperText>
      {long ? (
        <button
          type="button"
          className="pt-btn pt-explain__fold"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show all'}
        </button>
      ) : null}
    </section>
  );
}

function Composer({
  busy,
  disabled,
  onSend,
  onStop,
}: {
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onSend: (question: string) => void;
  readonly onStop: () => void;
}): ReactNode {
  const [value, setValue] = useState('');
  const submit = (): void => {
    const question = value.trim();
    if (question.length === 0 || busy || disabled) return;
    onSend(question);
    setValue('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form
      className="pt-explain__composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="pt-explain__sr" htmlFor="pt-explain-question">
        Ask a question about this paper
      </label>
      <textarea
        id="pt-explain-question"
        className="pt-field pt-explain__input"
        rows={1}
        maxLength={2000}
        value={value}
        placeholder="Ask a follow-up, or any question about the paper"
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {busy ? (
        <button type="button" className="pt-btn pt-btn--outline" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button
          type="submit"
          className="pt-btn pt-btn--primary"
          disabled={disabled || value.trim().length === 0}
        >
          Ask
        </button>
      )}
    </form>
  );
}

function Body({
  controller,
  onCite,
}: {
  readonly controller: ExplainController;
  readonly onCite: (citation: Citation) => void;
}): ReactNode {
  const actions = useReaderActions();
  const { state, paperId } = controller;
  // The stored threads: an empty panel opens on the newest one, and a settled answer is re-read
  // so its locators and coverage replace the live copy (#202).
  const threads = useThreads(controller);
  const scroller = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const busy = state.messages.some((m) => m.status === 'streaming');

  // Follow the answer as it grows, unless the reader has scrolled up to read.
  const last = state.messages[state.messages.length - 1];
  const growth = `${String(state.messages.length)}:${String(last?.text.length ?? 0)}:${last?.status ?? ''}:${String(last?.stopped ?? false)}:${String(last?.citations.length ?? 0)}`;
  const epoch = state.epoch;
  useEffect(() => {
    // A new ask or a different view starts at the TOP: the passage and the "AI interpretation"
    // label first, not the end of whatever was there. The view follows the answer only once the
    // reader has sent a question of their own (below), so a short sheet does not open past the quote.
    stick.current = false;
    if (scroller.current !== null) scroller.current.scrollTop = 0;
  }, [state.view, epoch]);
  const questions = state.messages.filter((m) => m.role === 'user').length;
  useEffect(() => {
    if (questions > 0) stick.current = true;
  }, [questions]);
  useEffect(() => {
    const el = scroller.current;
    if (el !== null && stick.current) el.scrollTop = el.scrollHeight;
  }, [growth, state.view]);

  const sendToCanvas = useCallback(
    (messageId: string) => actions.sendToCanvas({ kind: 'explanation', messageId }),
    [actions],
  );

  const offline = paperId === null;
  const inSummary = state.view === 'summary';

  return (
    <div className="pt-explain__body" data-explain-view={state.view}>
      <div className="pt-explain__toolbar">
        {inSummary ? (
          <button type="button" className="pt-btn" onClick={() => controller.setView('thread')}>
            Back to conversation
          </button>
        ) : (
          <button
            type="button"
            className="pt-btn pt-btn--outline"
            disabled={offline}
            onClick={() => controller.summarize()}
          >
            Summarize paper
          </button>
        )}
      </div>

      <div
        className="pt-explain__scroll"
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {inSummary ? (
          <SummaryView
            state={state.summary}
            onCite={onCite}
            onRetry={() => {
              controller.summarize();
            }}
            onRegenerate={() => {
              controller.summarize({ regenerate: true });
            }}
            onStop={controller.stopSummary}
          />
        ) : (
          <>
            {state.request !== null ? (
              <Quote quote={state.request.quote} anchor={state.request.anchor} />
            ) : null}
            {offline ? (
              <p className="pt-explain__empty" role="note">
                This is a sample paper, and a sample has no server to ask. Upload a PDF to ask
                questions about it.
              </p>
            ) : threads.failure !== null && state.messages.length === 0 ? (
              <ThreadReadFailure
                kind={threads.failure.kind}
                of={threads.failure.of}
                onRetry={threads.retry}
                {...(threads.failure.of === 'thread'
                  ? { onStartFresh: controller.startFresh }
                  : {})}
              />
            ) : state.messages.length === 0 && state.request === null ? (
              <p className="pt-explain__empty">
                Select a passage in the paper and press Ask, or type a question about the whole
                paper below.
              </p>
            ) : null}
            {state.messages.map((message) =>
              message.role === 'user' ? (
                <p className="pt-explain__question" key={message.key} data-user-message>
                  {message.text}
                </p>
              ) : (
                <AnswerView
                  key={message.key}
                  message={message}
                  onCite={onCite}
                  onRetry={controller.retry}
                  onSendToCanvas={sendToCanvas}
                />
              ),
            )}
          </>
        )}
      </div>

      {inSummary ? null : (
        <Composer busy={busy} disabled={offline} onSend={controller.ask} onStop={controller.stop} />
      )}
    </div>
  );
}

export function ExplainPanel({ controller }: ExplainPanelProps) {
  const actions = useReaderActions();
  const desktop = useMediaQuery(DESKTOP);
  const [detent, setDetent] = useState<SheetDetent>('half');
  const asideRef = useRef<HTMLElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  const { state, closeExplain } = controller;

  // Closing (Esc, the Close button, a dismissed sheet) hands focus back to the "Ask AI" launcher.
  // Without this the panel's own element unmounts and focus falls to <body>, so a keyboard reader
  // starts again from the top of the page.
  useEffect(() => {
    if (wasOpen.current && !state.open) launcherRef.current?.focus({ preventScroll: true });
    wasOpen.current = state.open;
  }, [state.open]);

  // A new ask opens at the readable height, not wherever the last one was left.
  useEffect(() => {
    if (state.open) setDetent('half');
  }, [state.open, state.epoch]);

  useEffect(() => {
    if (state.open && desktop) asideRef.current?.focus({ preventScroll: true });
  }, [state.open, state.epoch, desktop]);

  // The drawer must not sit on the paper it is explaining: while it is open on a wide screen the
  // page makes room (a rule in `@papertree/ui` keyed on this attribute), so a flashed passage is
  // never under the drawer.
  useEffect(() => {
    if (!state.open || !desktop) return undefined;
    const root = document.documentElement;
    root.setAttribute('data-pt-explain', 'open');
    return () => root.removeAttribute('data-pt-explain');
  }, [state.open, desktop]);

  const onCite = useCallback(
    (citation: Citation) => {
      // On a phone the sheet covers the page: lower it so the flashed passage is in view.
      if (!desktop) setDetent('peek');
      actions.focusAnchor(citation.anchor, { flash: true });
    },
    [actions, desktop],
  );

  if (!state.open) {
    if (controller.paperId === null) return null;
    return (
      <button
        ref={launcherRef}
        type="button"
        className="pt-explain__launch pt-btn pt-btn--primary"
        data-explain-launch
        onClick={controller.openPanel}
      >
        Ask AI
      </button>
    );
  }

  if (!desktop) {
    return (
      <Sheet
        open
        title="Explain"
        detent={detent}
        onDetentChange={setDetent}
        onDismiss={closeExplain}
        className="pt-explain-sheet"
      >
        <Body controller={controller} onCite={onCite} />
      </Sheet>
    );
  }

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      aria-label="Explain"
      data-explain-panel="drawer"
      className="pt-explain"
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeExplain();
      }}
    >
      <header className="pt-explain__header">
        <h2 className="pt-explain__title">Explain</h2>
        <button
          type="button"
          className="pt-btn"
          aria-label="Close explain panel"
          onClick={closeExplain}
        >
          Close
        </button>
      </header>
      <Body controller={controller} onCite={onCite} />
    </aside>
  );
}
