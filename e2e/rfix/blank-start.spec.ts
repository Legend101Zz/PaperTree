/**
 * RFIX2 R1b — a drag that STARTS in blank space, a Shift+click into blank space, a drag into the
 * left page margin, and a slow drag whose toolbar would open under the pointer. YOLO page 1.
 *
 * The first round (PR #170) snapped only drags that began on text, without Shift. A press 40 px
 * right of "present and where they are." let the browser pick its own anchor from DOM order, and the
 * selection came back as "classifier for that object ... trained separately." (1090 characters).
 * Every case is a REAL mouse gesture (`page.mouse`); the assertions read `getSelection()`.
 */
import { expect, test } from '../harness/test';
import { clearSelection, drag, gutterX, openReader, revealText, spanBox, yolo } from './support';

const YOLO = yolo();

const LEFT_COLUMN = [
  'classifier for that object',
  'Humans glance at an image',
  'Current detection systems',
];
const CAPTION = ['Figure 1', 'The YOLO Detection System'];
const ABOVE_PARAGRAPH = ['methods to first generate', 'individual component must be trained'];

const norm = (value: string): string => value.replace(/\s+/gu, ' ').trim();

test.describe('RFIX2 R1b — blank-space starts', () => {
  test.skip(
    YOLO === null,
    'SKIPPED: the YOLO PDF is not present (research/benchmarks/fresh/pdfs).',
  );

  test('press right of the short last line then drag up-left; Shift+click into blank space; left margin; slow drag', async ({
    browser,
    stack,
  }) => {
    test.setTimeout(600_000);
    const note = (line: string): void => console.log(`[e2e rfix2 R1b] ${line}`);
    const { page } = await openReader(
      browser,
      stack.apiUrl,
      YOLO as string,
      { width: 1440, height: 900 },
      'r1b',
    );
    await revealText(page, 'We reframe object detection');
    await page.waitForTimeout(500);
    const selectedText = async (): Promise<string> =>
      norm(await page.evaluate(() => window.getSelection()?.toString() ?? ''));
    const strangers = [...LEFT_COLUMN, ...CAPTION, ...ABOVE_PARAGRAPH];

    // ── A: press 40 px right of "present and where they are.", drag up-left to "We reframe" ──
    {
      const first = await spanBox(page, 'We reframe object detection');
      const last = await spanBox(page, 'present and where they are.');
      await drag(
        page,
        { x: last.right + 40, y: (last.top + last.bottom) / 2 },
        { x: first.left + 0.5, y: (first.top + first.bottom) / 2 },
      );
      const text = await selectedText();
      note(
        `A (press in blank space): ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-40))}`,
      );
      expect.soft(text.startsWith('We reframe object detection')).toBe(true);
      expect.soft(text.endsWith('where they are.')).toBe(true);
      for (const stranger of strangers)
        expect.soft(text, `A must not contain ${stranger}`).not.toContain(stranger);
      expect.soft(text.length).toBeLessThan(600);
      await clearSelection(page);
    }

    // ── B: click the start of "We reframe", Shift+click 40 px right of the last line ─────────
    {
      const first = await spanBox(page, 'We reframe object detection');
      const last = await spanBox(page, 'present and where they are.');
      await page.mouse.click(first.left + 0.5, (first.top + first.bottom) / 2);
      await page.keyboard.down('Shift');
      await page.mouse.click(last.right + 40, (last.top + last.bottom) / 2);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(300);
      const text = await selectedText();
      note(
        `B (Shift+click into blank space): ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-40))}`,
      );
      expect.soft(text.startsWith('We reframe object detection')).toBe(true);
      expect.soft(text.endsWith('where they are.')).toBe(true);
      for (const stranger of strangers)
        expect.soft(text, `B must not contain ${stranger}`).not.toContain(stranger);
      await clearSelection(page);
    }

    // ── C: a leftward drag into the left page margin ends near the pointer's line ──────────
    {
      const lines = await page.evaluate(() => {
        const layer = document.querySelector(
          '.papertree-page[data-page-index="0"] .papertree-text-layer',
        ) as HTMLElement;
        const page = layer.getBoundingClientRect();
        return Array.from(layer.querySelectorAll('span[data-item-index]'))
          .map((s) => {
            const r = s.getBoundingClientRect();
            return {
              text: (s.textContent ?? '').trim(),
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
            };
          })
          .filter(
            (s) =>
              s.text.length > 25 &&
              s.left < page.left + page.width * 0.45 &&
              s.top > 300 &&
              s.bottom < 880,
          )
          .sort((a, b) => a.top - b.top);
      });
      expect(lines.length).toBeGreaterThan(8);
      const l1 = lines[1] as (typeof lines)[number];
      const l4 = lines[4] as (typeof lines)[number];
      const l8 = lines[8] as (typeof lines)[number];
      const margin = await page.evaluate(() => {
        const layer = document.querySelector(
          '.papertree-page[data-page-index="0"] .papertree-text-layer',
        ) as HTMLElement;
        return layer.getBoundingClientRect().left + 10;
      });
      expect(margin).toBeLessThan(l4.left - 5);
      await drag(
        page,
        { x: l1.right - 3, y: (l1.top + l1.bottom) / 2 },
        { x: margin, y: (l4.top + l4.bottom) / 2 },
      );
      const text = await selectedText();
      note(
        `C (left margin, line 4): ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-40))}`,
      );
      expect
        .soft(text, 'C reaches the line before the pointer')
        .toContain(lines[3]?.text.slice(-12) ?? '?');
      expect.soft(text, 'C must not include the pointer line').not.toContain(l4.text.slice(0, 20));
      expect.soft(text, 'C must not run to a far line').not.toContain(l8.text.slice(0, 20));
      await clearSelection(page);
    }

    // ── D: a SLOW drag (the toolbar's debounce elapses mid-drag) ends where the pointer is ────
    {
      const first = await spanBox(page, 'We reframe object detection');
      const line = await spanBox(page, 'look once (YOLO) at an image');
      const gutter = await gutterX(page);
      await page.mouse.move(first.left + 0.5, (first.top + first.bottom) / 2);
      await page.mouse.down();
      const steps = 8;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        await page.mouse.move(
          first.left + 0.5 + (gutter - first.left - 0.5) * t,
          (first.top + first.bottom) / 2 +
            ((line.top + line.bottom) / 2 - (first.top + first.bottom) / 2) * t,
        );
        await page.waitForTimeout(260);
      }
      await page.mouse.up();
      await page.waitForTimeout(300);
      const text = await selectedText();
      note(
        `D (slow drag): ${JSON.stringify(text.slice(0, 40))} … ${JSON.stringify(text.slice(-50))}`,
      );
      expect.soft(text.startsWith('We reframe object detection')).toBe(true);
      expect.soft(text).not.toContain('where they are.');
      expect.soft(text).not.toContain('Highlight');
      for (const stranger of strangers)
        expect.soft(text, `D must not contain ${stranger}`).not.toContain(stranger);
      await clearSelection(page);
    }
  });
});
