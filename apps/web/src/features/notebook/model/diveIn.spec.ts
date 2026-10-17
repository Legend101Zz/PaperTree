/**
 * diveIn.spec — Dive in's pure half (S5e, #210): the derived page id that makes a second Dive in
 * open the same page, the motion plan from the tokens and its reduced path, the FLIP keyframe,
 * the pairing of panel cards with page cards, and the one-shot hand-off.
 */
import { describe, expect, it } from 'vitest';

import {
  createHandoffSlot,
  diveInPageId,
  diveMotion,
  durationMs,
  flipTransform,
  onScreen,
  pairFlights,
} from './diveIn';

import type { DiveCard } from './diveIn';

const box = (x: number, y: number, width = 100, height = 50) => ({ x, y, width, height });

describe('diveInPageId', () => {
  it('derives the page from the answer, the same id every time', () => {
    const id = diveInPageId('msg_01M508X9PCVH6CHJJDJEGDTC7V');
    expect(id).toBe('np_01M508X9PCVH6CHJJDJEGDTC7V');
    expect(diveInPageId('msg_01M508X9PCVH6CHJJDJEGDTC7V')).toBe(id);
    expect(diveInPageId('msg_01M508XKD9YJG2677H8WJK902S')).not.toBe(id);
  });

  it('has the API client-id shape, or is null when the message id cannot give one', () => {
    expect(diveInPageId('msg_01M508X9PCVH6CHJJDJEGDTC7V')).toMatch(
      /^[a-z]{2,4}_[0-9A-Za-z-]{8,64}$/,
    );
    expect(diveInPageId('msg_short')).toBeNull();
    expect(diveInPageId('msg_has spaces in it')).toBeNull();
  });
});

describe('diveMotion', () => {
  it('lifts for --pt-dur-quick, then slides for the rest of --pt-dur-open (120 → 360)', () => {
    expect(diveMotion({ quick: 120, open: 480 }, false)).toEqual({
      liftMs: 120,
      slideMs: 360,
      fadeMs: 0,
    });
  });

  it('follows the tokens, not constants', () => {
    expect(diveMotion({ quick: 100, open: 400 }, false)).toEqual({
      liftMs: 100,
      slideMs: 300,
      fadeMs: 0,
    });
    expect(diveMotion({ quick: 200, open: 100 }, false).slideMs).toBe(0);
  });

  it('with reduced motion: one quick cross-fade, nothing lifts or travels', () => {
    expect(diveMotion({ quick: 120, open: 120 }, true)).toEqual({
      liftMs: 0,
      slideMs: 0,
      fadeMs: 120,
    });
  });
});

describe('durationMs', () => {
  it('reads ms and s, with the spaces a computed custom property keeps', () => {
    expect(durationMs('120ms', 0)).toBe(120);
    expect(durationMs(' 480ms', 0)).toBe(480);
    expect(durationMs('0.36s', 0)).toBe(360);
  });

  it('falls back when the token is missing or not a duration', () => {
    expect(durationMs('', 120)).toBe(120);
    expect(durationMs('quick', 480)).toBe(480);
  });
});

describe('pairFlights', () => {
  const from: DiveCard[] = [
    { key: 'call', box: box(900, -200) },
    { key: 'ai', box: box(900, 100) },
    { key: 'passage-1', box: box(900, 600) },
    { key: 'passage-2', box: box(900, 700) },
  ];
  const to: DiveCard[] = [
    { key: 'call', box: box(100, 200) },
    { key: 'ai', box: box(100, 300) },
    { key: 'passage-1', box: box(100, 650) },
    { key: 'passage-2', box: box(400, 1200) },
    { key: 'passage-3', box: box(700, 650) },
  ];

  it('flies a card only when it is on screen in the panel and where it lands', () => {
    const flights = pairFlights(from, to, 1440, 900);
    // call: scrolled out of the panel; passage-2: lands below the fold; passage-3: not in the panel.
    expect(flights.map((f) => f.key)).toEqual(['ai', 'passage-1']);
    expect(flights[1]).toEqual({ key: 'passage-1', from: box(900, 600), to: box(100, 650) });
  });

  it('counts a box as on screen when any of it shows, and an empty box never', () => {
    expect(onScreen(box(-50, 10), 1440, 900)).toBe(true);
    expect(onScreen(box(1440, 10), 1440, 900)).toBe(false);
    expect(onScreen(box(10, 10, 0, 0), 1440, 900)).toBe(false);
  });
});

describe('flipTransform', () => {
  it('starts the card at its panel box, inside a page that starts slideX to the right', () => {
    const f = { key: 'ai', from: box(900, 100), to: box(100, 300) };
    // screen: +800 x, -200 y; the page itself starts 300 px right, so the card goes 500 back.
    expect(flipTransform(f, 300, 1)).toBe('translate(500px, -200px)');
  });

  it('turns screen px into the scaled layer’s units, and never stretches the paper', () => {
    const f = { key: 'ai', from: box(900, 100, 500, 600), to: box(100, 300, 600, 140) };
    expect(flipTransform(f, 300, 2)).toBe('translate(250px, -100px)');
    expect(flipTransform(f, 0, 0)).toBe('translate(800px, -200px)');
  });
});

describe('createHandoffSlot', () => {
  it('hands the panel’s cards to their page once', () => {
    const slot = createHandoffSlot(1000);
    slot.put({ pageId: 'np_a', cards: [{ key: 'ai', box: box(0, 0) }], at: 0 });
    expect(slot.waiting('np_b', 10)).toBe(false);
    expect(slot.take('np_b', 10)).toBeNull();
    expect(slot.waiting('np_a', 10)).toBe(true);
    expect(slot.take('np_a', 10)?.cards).toHaveLength(1);
    expect(slot.take('np_a', 20)).toBeNull();
  });

  it('lets a stale hand-off go: a page opened later from a link just appears', () => {
    const slot = createHandoffSlot(1000);
    slot.put({ pageId: 'np_a', cards: [], at: 0 });
    expect(slot.waiting('np_a', 1001)).toBe(false);
    expect(slot.take('np_a', 1001)).toBeNull();
  });
});
