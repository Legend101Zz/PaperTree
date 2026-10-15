'use client';

/**
 * explain/RichText — the small subset of Markdown a model answer uses, rendered as React nodes
 * (never as HTML), with its `[bN]` handles turned into citation chips.
 *
 * WHAT IT HANDLES: paragraphs, `-`/`*`/`1.` lists, `**bold**`, `` `code` ``, and the handles.
 * Anything else is text. There is no raw-HTML path.
 *
 * HANDLES. The model writes `[b3]` or `[b3, b4]`; the `citations` event (or the stored message)
 * says what each one points at. A handle with no citation is DROPPED, not shown: a reader cannot
 * act on "b9". While an answer is still streaming the citations have not arrived, so its handles
 * are hidden, and a half-typed `[b` at the end of the text never flashes on screen. A citation
 * whose handle the text never mentions is appended after the text, so no verified source is lost.
 */
import { Fragment, type ReactNode } from 'react';

import type { Citation } from '@/lib/api/types';

import { CitationChip } from './CitationChip';

export interface RichTextProps {
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly streaming?: boolean;
  readonly onCite: (citation: Citation) => void;
}

const HANDLE = String.raw`\s*\[b\d+(?:\s*,\s*b\d+)*\]`;
const INLINE = new RegExp(String.raw`(\*\*[^*\n]+\*\*|` + '`[^`\\n]+`' + `|${HANDLE})`);
const HANDLE_ONLY = new RegExp(`^${HANDLE}$`);
const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
/** A handle cut off by the end of a streaming chunk: `[`, `[b`, `[b12`, `[b1, b`. */
const PARTIAL_TAIL = /\s*\[(?:b\d*(?:\s*,\s*b?\d*)*)?$/;

type Block =
  | { readonly kind: 'p'; readonly text: string }
  | { readonly kind: 'ul' | 'ol'; readonly items: readonly string[] };

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list !== null) blocks.push(list);
    list = null;
  };
  for (const line of text.split('\n')) {
    const bullet = BULLET.exec(line);
    const numbered = bullet === null ? NUMBERED.exec(line) : null;
    const item = bullet ?? numbered;
    if (item !== null) {
      flushParagraph();
      const kind = bullet !== null ? 'ul' : 'ol';
      if (list === null || list.kind !== kind) {
        flushList();
        list = { kind, items: [] };
      }
      list.items.push(item[1] ?? '');
    } else if (line.trim().length === 0) {
      flushParagraph();
      flushList();
    } else if (list !== null && /^\s+\S/.test(line)) {
      // A wrapped list item continues the previous one.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** The handles a text mentions, in order (`b3`, `b4`). */
export function handlesIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/\[(b\d+(?:\s*,\s*b\d+)*)\]/g)) {
    for (const part of (match[1] ?? '').split(',')) out.push(part.trim());
  }
  return out;
}

function Inline({
  text,
  byMarker,
  streaming,
  onCite,
}: {
  readonly text: string;
  readonly byMarker: ReadonlyMap<string, Citation>;
  readonly streaming: boolean;
  readonly onCite: (citation: Citation) => void;
}): ReactNode {
  const parts = text.split(INLINE);
  return (
    <>
      {parts.map((part, index) => {
        if (part === '') return null;
        const key = `${String(index)}`;
        if (HANDLE_ONLY.test(part)) {
          if (streaming) return null;
          const markers = (/\[(.*)\]/.exec(part)?.[1] ?? '').split(',').map((m) => m.trim());
          const chips = markers.flatMap((marker) => {
            const citation = byMarker.get(marker);
            if (citation === undefined) return [];
            return [citation];
          });
          if (chips.length === 0) return null;
          return (
            <span className="pt-chips" key={key}>
              {chips.map((citation) => (
                <CitationChip key={citation.citation_id} citation={citation} onFocus={onCite} />
              ))}
            </span>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <code key={key}>{part.slice(1, -1)}</code>;
        }
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

export function RichText({ text, citations, streaming = false, onCite }: RichTextProps): ReactNode {
  const byMarker = new Map(citations.map((c) => [c.marker, c] as const));
  const cleaned = streaming ? text.replace(PARTIAL_TAIL, '') : text;
  const blocks = parseBlocks(cleaned);
  const inline = (value: string): ReactNode => (
    <Inline text={value} byMarker={byMarker} streaming={streaming} onCite={onCite} />
  );
  const body = blocks.map((block, index) =>
    block.kind === 'p' ? (
      <p key={index}>{inline(block.text)}</p>
    ) : block.kind === 'ul' ? (
      <ul key={index}>
        {block.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    ) : (
      <ol key={index}>
        {block.items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ol>
    ),
  );
  const mentioned = new Set(handlesIn(cleaned));
  const loose = streaming ? [] : citations.filter((c) => !mentioned.has(c.marker));
  return (
    <div className="pt-explain__prose">
      {body}
      {loose.length > 0 ? (
        <p className="pt-explain__loose">
          <span className="pt-chips">
            {loose.map((citation) => (
              <CitationChip key={citation.citation_id} citation={citation} onFocus={onCite} />
            ))}
          </span>
        </p>
      ) : null}
    </div>
  );
}
