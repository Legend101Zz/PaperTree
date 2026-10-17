/**
 * Ink latency probe (S5d, #209): draws scripted 200-point strokes on a live notebook page and
 * reports how long the pen's samples take to reach the live path. The arithmetic is the feature's
 * own `src/features/notebook/model/latency.ts`, loaded into the page as is. Run it against a
 * PRODUCTION build (`next build` + `next start`): a dev build is several times slower.
 *
 *   node apps/web/scripts/ink-latency.mjs --web http://127.0.0.1:18904 --token <session> \
 *     --page /paper/<paper_id>/notebook/<page_id> [--runs 3] [--hz 240]
 *
 * What each number is, and is not:
 * - `written`: from a pointer sample's `timeStamp` to the moment the live path's `d` is set, seen by
 *   a MutationObserver. The path is rewritten once per animation frame, so this is about one frame.
 * - `script work`: from the frame's start (its rAF time) to that write. JavaScript only: it ends
 *   BEFORE style, layout, paint and raster, so it is not the whole cost of drawing a frame (a
 *   performance trace would show the rest).
 * - `next frame`: the next rAF timestamp after the write. In headless Chromium there is no display
 *   and no vsync, so this is a PROXY for "on screen", not a measurement of glass-to-pixel time.
 * - Drivers: `cdp` is Playwright's mouse (trusted input through the browser's pipeline; it sends one
 *   move per frame, so each lands just after a frame and waits a whole one). `page` dispatches
 *   untrusted PointerEvents from a timer on the main thread at `--hz`: no real coalescing and no
 *   input-to-main-thread delay, so its `written` numbers are optimistic; read `cdp` first.
 * Needs Node 22.13+ (`stripTypeScriptTypes`) and the repo's Playwright Chromium.
 */
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { loadavg } from 'node:os';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    web: { type: 'string' },
    token: { type: 'string' },
    page: { type: 'string' },
    runs: { type: 'string', default: '3' },
    hz: { type: 'string', default: '240' },
  },
});
if (!args.web || !args.token || !args.page || typeof stripTypeScriptTypes !== 'function') {
  console.error('usage: --web <url> --token <session> --page /paper/<id>/notebook/<page_id>');
  console.error('(Node 22.13 or later)');
  process.exit(2);
}
const runs = Number(args.runs);
const hz = Number(args.hz);
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const model = new URL('../src/features/notebook/model/latency.ts', import.meta.url);
const helper = stripTypeScriptTypes(readFileSync(model, 'utf8')).replace(/^export /gm, '');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => localStorage.setItem('papertree.session', t), args.token);
await ctx.addInitScript(`${helper}\nwindow.__inkLatency = { summarise, eventToFrame };`);
const page = await ctx.newPage();
await page.goto(new URL(args.page, args.web).href, { waitUntil: 'networkidle' });
const load0 = loadavg();

/** Watches the live path and the frames in the page, while one stroke is drawn. */
async function watch() {
  await page.evaluate(() => {
    const st = { events: [], writes: [], next: [], starts: [], on: true };
    window.__probe = st;
    const tick = (ts) => {
      st.starts.push(ts);
      if (st.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__probeMove = (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.pt-nb-surface')) return;
      const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const c of list.length ? list : [e]) st.events.push(c.timeStamp);
    };
    document.addEventListener('pointermove', window.__probeMove, true);
    const path = document.querySelector('.pt-nb-ink--live path');
    window.__probeObs = new MutationObserver(() => {
      if (!path.getAttribute('d')) return;
      const i = st.writes.push(performance.now()) - 1;
      requestAnimationFrame((ts) => {
        st.next[i] = ts;
      });
    });
    window.__probeObs.observe(path, { attributes: true, attributeFilter: ['d'] });
  });
}

/** Draws one 200-point stroke with the given driver. */
async function draw(driver, x0, y0) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  if (driver === 'cdp') {
    const t0 = performance.now();
    for (let i = 1; i <= 200; i++) {
      await page.mouse.move(x0 + i * 1.5, y0 + Math.sin(i / 10) * 25);
      const due = t0 + (i * 1000) / hz;
      while (performance.now() < due) await new Promise((res) => setTimeout(res, 0));
    }
  } else {
    await page.evaluate(
      async ([x, y, rate]) => {
        const el = document.querySelector('.pt-nb-surface');
        const t0 = performance.now();
        for (let i = 1; i <= 200; i++) {
          while (performance.now() < t0 + (i * 1000) / rate) {
            await new Promise((r) => setTimeout(r, 0));
          }
          const at = { clientX: x + i * 1.5, clientY: y + Math.sin(i / 10) * 25 };
          const init = { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons: 1, ...at };
          el.dispatchEvent(new PointerEvent('pointermove', { ...init, isPrimary: true }));
        }
      },
      [x0, y0, hz],
    );
  }
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** One run: pick up the pen, draw, read the numbers. */
async function probe(driver, run) {
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await watch();
  const box = await page.locator('.pt-nb-surface').boundingBox();
  await draw(driver, box.x + 560, box.y + 330 + run * 50);
  const res = await page.evaluate(() => {
    const p = window.__probe;
    p.on = false;
    document.removeEventListener('pointermove', window.__probeMove, true);
    window.__probeObs.disconnect();
    const L = window.__inkLatency;
    const work = p.writes.map((w) => w - Math.max(...p.starts.filter((s) => s <= w)));
    return {
      samples: p.events.length,
      frames: p.writes.length,
      written: L.summarise(L.eventToFrame(p.events, p.writes)),
      next: L.summarise(L.eventToFrame(p.events, p.writes, p.next)),
      work: L.summarise(work.filter(Number.isFinite)),
    };
  });
  await page.keyboard.press('Escape');
  return res;
}

const f = (s) => `median ${s.median.toFixed(1)} p95 ${s.p95.toFixed(1)} max ${s.max.toFixed(1)}`;
for (const driver of ['cdp', 'page']) {
  for (let r = 0; r < runs; r++) {
    const x = await probe(driver, r);
    console.log(
      `${driver} run ${r + 1}: ${x.samples} samples, ${x.frames} frames | ` +
        `event->written ${f(x.written)} | event->next frame (proxy) ${f(x.next)} | ` +
        `script work in frame ${f(x.work)} ms`,
    );
  }
}
const loads = (l) => l.map((v) => v.toFixed(2)).join(' ');
console.log(
  `load averages before ${loads(load0)}, after ${loads(loadavg())} ` +
    `(${hz} Hz, headless Chromium, 1440x900)`,
);
await browser.close();
