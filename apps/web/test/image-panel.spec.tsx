/**
 * image-panel: the explain panel on a picture (v0.3 #348, item 3). Explain on a figure starts an
 * `image` thread (the body the API accepts), the crop is at the top of the exchange for as long as
 * the thread is, the answer is the tutor shape, and a follow-up is an ordinary follow-up (the server
 * attaches the crop again). Ask… waits for the reader's own question and then sends it as an image
 * thread; a paragraph selected with the figure goes as `with_text_anchor`.
 *
 * Only `fetch` and the three reader actions are fakes; the controller and the panel are real.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { useMemo, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { indexDocument, type Anchor, type PaperSource } from '@papertree/anchoring';

import { useExplainActions } from '@/components/explain';
import { ReaderActionsProvider, type ReaderActions } from '@/components/reader/actions';
import { cropQuery } from '@/lib/api/crops';
import { buildImageAnchor } from '@/lib/imageAnchor';
import { clearCropCache } from '@/lib/useCropUrl';

import { HeaderAndPanel } from './explain-toggle';
import { TestQueryProvider } from './query-client';
import { stubDesktop } from './s6-harness';
import {
  anchorFixture,
  done,
  installFetch,
  jsonResponse,
  PAPER,
  run,
  sseResponse,
  text,
} from './s6-support';

const doc = indexDocument(
  JSON.parse(
    readFileSync(`${process.cwd()}/test/fixtures/real-resnet-p1-2.ir.json`, 'utf8'),
  ) as PaperSource,
  'image-panel-spec',
);
const BOX: [number, number, number, number] = [309, 224, 545, 347];
const FIGURE = buildImageAnchor({
  doc,
  page: 0,
  box: BOX,
  kind: 'figure',
  block: doc.byId.get('blk_3pzzcn4luvb5qmpc')!,
  id: 'fig-anchor',
  at: '2026-11-20T10:00:00.000Z',
  client: 'test',
});
const CAPTION = 'Figure 1. Training error (left) and test error (right) on CIFAR-10.';
const WORDS: Anchor = anchorFixture('words');
const CROP_PATH = `/papers/${PAPER}/crop-url?${cropQuery({ page: 0, box: BOX })}`;
const CROP = {
  url: 'https://crops.example/fig1.png?sig=abc',
  expires_at: '2999-01-01T00:00:00+00:00',
  dpi: 410,
  width: 1400,
  height: 740,
};

function Body(): ReactNode {
  const explain = useExplainActions({ paperId: PAPER });
  const { openExplain, askAbout } = explain;
  const actions = useMemo<ReaderActions>(
    () => ({
      openExplain,
      askAbout,
      sendToCanvas: async () => undefined,
      focusAnchor: () => undefined,
    }),
    [openExplain, askAbout],
  );
  const image = { label: 'Figure 1', caption: CAPTION };
  return (
    <ReaderActionsProvider value={actions}>
      <button type="button" onClick={() => openExplain({ anchor: FIGURE, quote: '', image })}>
        explain figure
      </button>
      <button type="button" onClick={() => askAbout?.({ anchor: FIGURE, quote: '', image })}>
        ask about figure
      </button>
      <button
        type="button"
        onClick={() =>
          openExplain({
            anchor: FIGURE,
            quote: 'The paragraph that names it.',
            image: { ...image, withText: { anchor: WORDS, quote: 'The paragraph that names it.' } },
          })
        }
      >
        explain figure and paragraph
      </button>
      <HeaderAndPanel explain={explain} />
    </ReaderActionsProvider>
  );
}

const ANSWER =
  '## TL;DR\nThe curves show that depth hurt.\n\n## In plain words\nThe 56-layer net is worse.';

beforeEach(() => {
  stubDesktop();
  clearCropCache();
  window.localStorage.setItem('papertree.session', 'test-token');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routes() {
  return {
    [`GET ${CROP_PATH}`]: () => jsonResponse(200, CROP),
    [`POST /papers/${PAPER}/threads`]: (_c: unknown, signal: AbortSignal | null) =>
      sseResponse([run(), text(ANSWER), done()], { signal }),
    [`POST /papers/${PAPER}/threads/thr_1/messages`]: (_c: unknown, signal: AbortSignal | null) =>
      sseResponse(
        [
          run({ message_id: 'msg_f' }),
          text('Because of the degradation problem.'),
          done('complete', null, 'msg_f'),
        ],
        {
          signal,
        },
      ),
  };
}

describe('Explain on a figure', () => {
  it('starts an image thread with the picture anchor and the default question, and shows the crop', async () => {
    const { calls } = installFetch(routes());
    render(
      <TestQueryProvider>
        <Body />
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'explain figure' }));
    await waitFor(() => expect(screen.getByText(/The curves show that depth hurt/)).toBeTruthy());

    const create = calls.find((c) => c.method === 'POST' && c.path === `/papers/${PAPER}/threads`);
    expect(create?.body).toEqual({ kind: 'image', anchor: FIGURE, level: 'familiar' });

    // The crop sits at the top of the exchange, with its caption and its page.
    const head = document.querySelector<HTMLElement>('[data-explain-crop]');
    expect(head).not.toBeNull();
    await waitFor(() => expect(within(head!).getByRole('img')).toBeTruthy());
    const img = within(head!).getByRole('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(CROP.url);
    expect(img.getAttribute('alt')).toBe(CAPTION);
    expect(head!.textContent).toContain('Figure 1 · p. 1');
    expect(
      head!.compareDocumentPosition(screen.getByText(/The curves show/)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The call slip asks what the server asks, and the answer is the tutor's.
    expect(screen.getByText('Explain this figure.')).toBeTruthy();
    expect(screen.getByText('The 56-layer net is worse.')).toBeTruthy();
  });

  it('the crop is a thumbnail (240 px tall at most, aspect kept); a click shows it large, Esc puts it back and keeps the panel', async () => {
    installFetch(routes());
    render(
      <TestQueryProvider>
        <Body />
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'explain figure' }));
    await waitFor(() => expect(screen.getByText(/The curves show/)).toBeTruthy());

    const css = readFileSync(
      `${process.cwd()}/src/features/explain/components/imageHead.css`,
      'utf8',
    );
    expect(css).toMatch(/--pt-explain-crop-max: 240px/);
    expect(css).toMatch(
      /\[data-large='false'\] \.pt-crop \{[^}]*max-block-size: var\(--pt-explain-crop-max\);[^}]*object-fit: contain;/,
    );

    const head = document.querySelector<HTMLElement>('[data-explain-crop]')!;
    expect(head.getAttribute('data-large')).toBe('false');
    const toggle = within(head).getByRole('button', { name: 'Show the picture larger' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(head.getAttribute('data-large')).toBe('true');
    const shrink = within(head).getByRole('button', { name: 'Show the picture smaller' });
    expect(shrink.getAttribute('aria-expanded')).toBe('true');

    // Esc from the picture closes the picture, and the panel stays open.
    fireEvent.keyDown(shrink, { key: 'Escape' });
    expect(head.getAttribute('data-large')).toBe('false');
    expect(screen.getByText(/The curves show/)).toBeTruthy();
    expect(document.querySelector('[data-explain-crop]')).not.toBeNull();
  });

  it('a follow-up is an ordinary follow-up in the same thread, and the crop stays', async () => {
    const { calls } = installFetch(routes());
    render(
      <TestQueryProvider>
        <Body />
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'explain figure' }));
    await waitFor(() => expect(screen.getByText(/The curves show/)).toBeTruthy());
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Why is the deeper net worse?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/degradation problem/)).toBeTruthy());
    const follow = calls.find((c) => c.path === `/papers/${PAPER}/threads/thr_1/messages`);
    expect(follow?.body).toMatchObject({ question: 'Why is the deeper net worse?' });
    expect(document.querySelectorAll('[data-explain-crop]')).toHaveLength(1);
  });

  it('a figure and a paragraph together send with_text_anchor and quote the paragraph', async () => {
    const { calls } = installFetch(routes());
    render(
      <TestQueryProvider>
        <Body />
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'explain figure and paragraph' }));
    await waitFor(() => expect(screen.getByText(/The curves show/)).toBeTruthy());
    const create = calls.find((c) => c.method === 'POST' && c.path === `/papers/${PAPER}/threads`);
    expect(create?.body).toEqual({
      kind: 'image',
      anchor: FIGURE,
      level: 'familiar',
      with_text_anchor: WORDS,
    });
    expect(screen.getByText(/The paragraph that names it\./)).toBeTruthy();
  });
});

describe('Ask… on a figure', () => {
  it('opens on the crop, sends nothing, and the reader’s own question starts the image thread', async () => {
    const { calls } = installFetch(routes());
    render(
      <TestQueryProvider>
        <Body />
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ask about figure' }));
    await waitFor(() => expect(document.querySelector('[data-explain-crop]')).not.toBeNull());
    expect(screen.getByText('Type your question about this picture below.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.path === `/papers/${PAPER}/threads`)).toBe(
      false,
    );

    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Why is the deeper net worse?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByText(/The curves show/)).toBeTruthy());
    const create = calls.find((c) => c.method === 'POST' && c.path === `/papers/${PAPER}/threads`);
    expect(create?.body).toEqual({
      kind: 'image',
      anchor: FIGURE,
      question: 'Why is the deeper net worse?',
      level: 'familiar',
    });
  });

  it('says so in words when the crop cannot be made, and the exchange still reads', async () => {
    installFetch({
      ...routes(),
      [`GET ${CROP_PATH}`]: () =>
        jsonResponse(404, { detail: 'x', code: 'not_found', retryable: false }),
    });
    render(
      <TestQueryProvider>
        <Body />
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'explain figure' }));
    await waitFor(() => expect(screen.getByText(/The picture could not be loaded/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/The curves show/)).toBeTruthy());
  });
});
