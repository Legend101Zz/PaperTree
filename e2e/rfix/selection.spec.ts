/**
 * RFIX R1 — a mouse drag that ENDS IN BLANK SPACE selects what the reader expects, on YOLO page 1.
 *
 * The defect (found by walking release/v0.1 in a real Chrome): a drag from the start of "We reframe
 * object detection …" to a point right of the short last line "present and where they are." left
 * `getSelection()` on unrelated earlier DOM text — the left column's last lines, the Figure 1
 * caption, the paragraph above — and Highlight / Ask would have captured that.
 *
 * Every drag here is a REAL mouse drag (`page.mouse`), ending over empty page. The assertions read
 * `getSelection().toString()`: where it starts, where it ends, and that it never holds text from
 * the other column or the figure caption.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '../harness/test';
import { REPO } from '../s4/support';
import { clearSelection, drag, openReader, revealText, spanBox, yolo } from './support';

const YOLO = yolo();

/** Strings that live OUTSIDE the paragraph / column under test on YOLO page 1. */
const LEFT_COLUMN = [
  'classifier for that object',
  'Humans glance at an image',
  'Current detection systems',
];
const CAPTION = ['Figure 1', 'The YOLO Detection System'];
const ABOVE_PARAGRAPH = ['methods to first generate', 'individual component must be trained'];

const norm = (value: string): string => value.replace(/\s+/gu, ' ').trim();

test.describe('RFIX R1 — drags that end in blank space', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF is not present (research/benchmarks/fresh/pdfs).',
  );

  test('right of a short last line, below a paragraph, in the gutter', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const note = (line: string): void => console.log(`[e2e rfix R1] ${line}`);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      YOLO as string,
      { width: 1440, height: 900 },
      'r1',
    );
    await revealText(page, 'We reframe object detection');
    await page.waitForTimeout(500);

    const selectedText = async (): Promise<string> =>
      norm(await page.evaluate(() => window.getSelection()?.toString() ?? ''));

    // ── A: ends right of the short last line "present and where they are." ──────────────────
    {
      const first = await spanBox(page, 'We reframe object detection');
      const last = await spanBox(page, 'present and where they are.');
      const from = { x: first.left + 0.5, y: (first.top + first.bottom) / 2 };
      const to = { x: last.right + 40, y: (last.top + last.bottom) / 2 };
      await drag(page, from, to);
      const text = await selectedText();
      note(
        `A (right of short last line): ${JSON.stringify(text.slice(0, 60))} … ${JSON.stringify(text.slice(-50))}`,
      );
      expect(text.startsWith('We reframe object detection')).toBe(true);
      expect(text.endsWith('where they are.')).toBe(true);
      for (const stranger of [...LEFT_COLUMN, ...CAPTION, ...ABOVE_PARAGRAPH])
        expect(text, `A must not contain ${stranger}`).not.toContain(stranger);
      expect(text.length).toBeLessThan(600);
      await clearSelection(page);
    }

    // ── A2: same drag, ending far to the right of the last line, in the page margin ────────
    {
      const first = await spanBox(page, 'We reframe object detection');
      const last = await spanBox(page, 'present and where they are.');
      await drag(
        page,
        { x: first.left + 0.5, y: (first.top + first.bottom) / 2 },
        { x: last.right + 200, y: (last.top + last.bottom) / 2 },
      );
      const text = await selectedText();
      note(`A2 (far right, still on the page): ${JSON.stringify(text.slice(-50))}`);
      expect(text.startsWith('We reframe object detection')).toBe(true);
      expect(text.endsWith('where they are.')).toBe(true);
      for (const stranger of [...LEFT_COLUMN, ...CAPTION, ...ABOVE_PARAGRAPH])
        expect(text, `A2 must not contain ${stranger}`).not.toContain(stranger);
      await clearSelection(page);
    }

    // ── B: ends BELOW a paragraph (under the Figure 1 caption, before the next paragraph) ──
    {
      const caption = await spanBox(page, 'with YOLO is simple and straightforward');
      const captionEnd = await spanBox(page, 'the model’s confidence.');
      const from = { x: caption.left + 0.5, y: (caption.top + caption.bottom) / 2 };
      const to = { x: captionEnd.right + 20, y: captionEnd.bottom + 14 };
      await drag(page, from, to);
      const text = await selectedText();
      note(
        `B (below caption): ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-50))}`,
      );
      expect(text.startsWith('with YOLO is simple')).toBe(true);
      expect(text.endsWith('the model’s confidence.')).toBe(true);
      for (const stranger of [
        ...LEFT_COLUMN,
        ...ABOVE_PARAGRAPH,
        'We reframe',
        'YOLO model processes',
      ])
        expect(text, `B must not contain ${stranger}`).not.toContain(stranger);
      await clearSelection(page);
    }

    // ── C: ends in the column GUTTER, from the left column ─────────────────────────────────
    {
      const start = await spanBox(page, 'Humans glance at an image');
      const line = await spanBox(page, 'ing us to perform complex tasks like driving with');
      const gutterX = 709;
      expect(gutterX).toBeGreaterThan(line.right);
      await drag(
        page,
        { x: start.left + 0.5, y: (start.top + start.bottom) / 2 },
        { x: gutterX, y: (line.top + line.bottom) / 2 },
      );
      const text = await selectedText();
      note(
        `C (gutter, left column): ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-50))}`,
      );
      expect(text.startsWith('Humans glance at an image')).toBe(true);
      expect(text.endsWith('driving with little con-')).toBe(true);
      for (const stranger of [
        ...CAPTION,
        'We reframe',
        'YOLO is refreshingly',
        'methods to first generate',
      ])
        expect(text, `C must not contain ${stranger}`).not.toContain(stranger);
      await clearSelection(page);
    }

    // ── D: ends in the gutter to the LEFT of a right-column line (drag leftwards, downwards) ─
    {
      const first = await spanBox(page, 'We reframe object detection');
      const line = await spanBox(page, 'look once (YOLO) at an image');
      await drag(
        page,
        { x: first.left + 0.5, y: (first.top + first.bottom) / 2 },
        { x: 709, y: (line.top + line.bottom) / 2 },
      );
      const text = await selectedText();
      note(
        `D (gutter, right column): ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-50))}`,
      );
      expect(text.startsWith('We reframe object detection')).toBe(true);
      expect(text).not.toContain('where they are.');
      for (const stranger of [...LEFT_COLUMN, ...CAPTION, ...ABOVE_PARAGRAPH])
        expect(text, `D must not contain ${stranger}`).not.toContain(stranger);
      await clearSelection(page);
    }

    // ── E: a drag that ends inside a word still works (the case that always worked) ─────────
    {
      const first = await spanBox(page, 'We reframe object detection');
      await drag(
        page,
        { x: first.left + 0.5, y: (first.top + first.bottom) / 2 },
        { x: first.left + 60, y: (first.top + first.bottom) / 2 },
      );
      const text = await selectedText();
      note(`E (inside a word): ${JSON.stringify(text)}`);
      expect(text.startsWith('We reframe')).toBe(true);
      expect(text.length).toBeLessThan(25);
      await clearSelection(page);
    }
  });
});

interface Line {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A second paper, so the fix is not tuned to YOLO's page: DDPM, page 1, generic line geometry. */
const DDPM = join(REPO, 'research', 'benchmarks', 'fresh', 'pdfs', 'ddpm-2006.11239.pdf');

test.describe('RFIX R1 — DDPM', () => {
  test.skip(
    !existsSync(DDPM),
    'SKIPPED: the DDPM PDF is not present (research/benchmarks/fresh/pdfs).',
  );

  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`a drag from one line to blank space past the margin ends at that line, ${String(size.width)}px`, async ({
      browser,
      stack,
    }) => {
      test.setTimeout(600_000);
      const { page } = await openReader(
        browser,
        stack.apiUrl,
        DDPM,
        size,
        `r1-ddpm-${String(size.width)}`,
        1,
        size.width < 600 ? 'fit-width' : '1.25',
      );
      // Three consecutive full lines of one paragraph on page 1: the widest spans, in reading order.
      const lines = await page.evaluate(() => {
        const spans = Array.from(
          document.querySelectorAll(
            '.papertree-page[data-page-index="0"] .papertree-text-layer span[data-item-index]',
          ),
        )
          .map((s) => {
            const r = s.getBoundingClientRect();
            return {
              text: s.textContent ?? '',
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
            };
          })
          .filter((s) => s.text.trim().length > 40 && s.right - s.left > 200);
        for (let i = 0; i + 2 < spans.length; i += 1) {
          const a = spans[i] as Line;
          const b = spans[i + 1] as Line;
          const c = spans[i + 2] as Line;
          const sameColumn = Math.abs(a.left - b.left) < 3 && Math.abs(b.left - c.left) < 3;
          const adjacent = b.top > a.top && c.top > b.top && c.top - a.top < 5 * (a.bottom - a.top);
          if (sameColumn && adjacent && a.top > 150) return [a, b, c];
        }
        return null;
      });
      if (lines === null) throw new Error('no three consecutive lines found on DDPM page 1');
      const [a, b, c] = lines as [Line, Line, Line];
      const columnRight = Math.max(a.right, b.right, c.right);
      await drag(
        page,
        { x: a.left + 0.5, y: (a.top + a.bottom) / 2 },
        { x: Math.min(columnRight + 12, size.width - 4), y: (c.top + c.bottom) / 2 },
      );
      const text = (await page.evaluate(() => window.getSelection()?.toString() ?? ''))
        .replace(/\s+/gu, ' ')
        .trim();
      console.log(
        `[e2e rfix R1] DDPM ${String(size.width)}px: ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-40))}`,
      );
      expect(text.startsWith(a.text.trim().slice(0, 12))).toBe(true);
      expect(text).toContain(b.text.trim().slice(0, 20));
      expect(text.endsWith(c.text.trim().slice(-12))).toBe(true);
      expect(text.length).toBeLessThan((a.text.length + b.text.length + c.text.length) * 1.3);
    });
  }
});
