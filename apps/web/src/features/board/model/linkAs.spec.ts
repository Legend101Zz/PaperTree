import { describe, expect, it } from 'vitest';

import { EDGE_KINDS, toFlowNode } from './flow';
import {
  PLAIN_LINK,
  endName,
  escapeKind,
  gridMove,
  kindChoices,
  kindForKey,
  linkedSentence,
  placePicker,
  portsHold,
  stop,
} from './linkAs';
import { PIN_TABLE, pinRefusal, type Port } from './pins';
import { cardRow, citation } from './test-data';

import type { CanvasNode } from '@/lib/api/types';

const KINDS = Object.keys(PIN_TABLE) as CanvasNode['kind'][];

describe('which kinds a pin pair takes (the server’s table)', () => {
  it('offers all seven, keys 1–7 in the design’s order, on every pair the server takes', () => {
    const choices = kindChoices(
      { kind: 'diagram', port: 'claim_out' },
      { kind: 'excerpt', port: 'evidence_in' },
    );
    expect(choices.map((c) => [c.key, c.label])).toEqual([
      ['1', 'supports'],
      ['2', 'contradicts'],
      ['3', 'derives from'],
      ['4', 'answers'],
      ['5', 'compares with'],
      ['6', 'references'],
      ['7', 'plain link'],
    ]);
    expect(choices.map((c) => c.kind)).toEqual(EDGE_KINDS.map((k) => k.kind));
    for (const from of KINDS)
      for (const to of KINDS)
        for (const out of PIN_TABLE[from].out)
          for (const into of PIN_TABLE[to].into) {
            const all = kindChoices({ kind: from, port: out }, { kind: to, port: into });
            expect(all.every((c) => c.enabled && c.why === null)).toBe(true);
          }
  });

  it('takes a thread with no pins (every v0.1 thread), as the server does', () => {
    expect(portsHold({ kind: 'question', port: null }, { kind: 'group', port: null })).toBe(true);
    const choices = kindChoices({ kind: 'note', port: null }, { kind: 'excerpt', port: null });
    expect(choices.every((c) => c.enabled)).toBe(true);
  });

  it('disables every kind on a pair the server refuses, and says why', () => {
    const refused: [CanvasNode['kind'], Port, CanvasNode['kind'], Port][] = [
      ['question', 'claim_out', 'excerpt', 'evidence_in'], // a question card has no out-pin
      ['note', 'answer_out', 'excerpt', 'evidence_in'], // only an explanation answers
      ['excerpt', 'claim_out', 'note', 'question_in'], // a note takes no question
    ];
    for (const [a, p, b, q] of refused) {
      const choices = kindChoices({ kind: a, port: p }, { kind: b, port: q });
      expect(choices.every((c) => !c.enabled && c.why === pinRefusal())).toBe(true);
    }
  });
});

describe('keys and Escape', () => {
  const ok = kindChoices(
    { kind: 'note', port: 'claim_out' },
    { kind: 'excerpt', port: 'evidence_in' },
  );
  const refused = kindChoices(
    { kind: 'question', port: 'claim_out' },
    { kind: 'excerpt', port: 'evidence_in' },
  );

  it('maps 1–7 to the seven kinds and nothing else', () => {
    expect(['1', '2', '3', '4', '5', '6', '7'].map((k) => kindForKey(k, ok))).toEqual([
      'supports',
      'contradicts',
      'derives_from',
      'answers',
      'compares',
      'references',
      'relates',
    ]);
    for (const key of ['0', '8', 'a', 'Enter', ' ']) expect(kindForKey(key, ok)).toBeNull();
  });

  it('never chooses a disabled kind by its key', () => {
    expect(kindForKey('1', refused)).toBeNull();
  });

  it('Escape keeps a plain link on a new thread and changes nothing on a saved one', () => {
    expect(escapeKind('new', ok)).toBe('relates');
    expect(PLAIN_LINK).toBe('relates');
    expect(kindForKey('7', ok)).toBe(PLAIN_LINK); // "7 = plain link", frame 06
    expect(escapeKind('change', ok)).toBeNull();
  });

  it('Escape never saves a pair the server refuses, even the plain link', () => {
    expect(escapeKind('new', refused)).toBeNull();
  });

  it('says what was saved, and ends a name once', () => {
    expect(linkedSentence('supports')).toBe('Linked as supports.');
    expect(linkedSentence('derives_from')).toBe('Linked as derives from.');
    expect(linkedSentence('relates')).toBe('Linked as a plain link.');
    expect(stop('from Note ‘Depth is the question.’')).toBe('from Note ‘Depth is the question.’');
    expect(stop('from Note ‘Next: read 3.2 on multi…’')).toBe(
      'from Note ‘Next: read 3.2 on multi…’',
    );
    expect(stop('from Passage p. 1')).toBe('from Passage p. 1.');
  });
});

describe('the header names both ends', () => {
  it('a passage by its page tab, any other card by its kind and first words', () => {
    const passage = toFlowNode(
      cardRow('excerpt', { body: 'We propose…', source_anchor: citation('b1', 0, 1).anchor }),
      'ppr_1',
    );
    const diagram = toFlowNode(cardRow('diagram', { title: 'Scaled dot-product attention' }), 'p');
    const note = toFlowNode(
      cardRow('note', {
        body: 'I thought attention needed an RNN underneath, always and forever.',
      }),
      'p',
    );
    expect(endName(passage)).toBe('Passage p. 1');
    expect(endName(diagram)).toBe('Diagram ‘Scaled dot-product attention’');
    expect(endName(note)).toBe('Note ‘I thought attention needed an R…’');
    expect(endName(toFlowNode(cardRow('note', { body: '' }), 'p'))).toBe('Note');
  });
});

describe('where the picker sits and how the arrows walk it', () => {
  const size = { w: 672, h: 180 };
  const stage = { w: 1440, h: 844 };

  it('centres on the midpoint, kept 16 px inside the stage', () => {
    expect(placePicker({ x: 700, y: 400 }, size, stage)).toEqual({ x: 364, y: 310 });
    expect(placePicker({ x: 40, y: 20 }, size, stage)).toEqual({ x: 16, y: 16 });
    expect(placePicker({ x: 1430, y: 840 }, size, stage)).toEqual({ x: 752, y: 648 });
    // A stage narrower than the picker: the gutter wins.
    expect(placePicker({ x: 195, y: 400 }, { w: 358, h: 400 }, { w: 390, h: 700 })).toEqual({
      x: 16,
      y: 200,
    });
  });

  it('moves along and between the rows of the 4 + 3 grid without leaving it', () => {
    expect(gridMove(0, 'ArrowRight', 7, 4)).toBe(1);
    expect(gridMove(0, 'ArrowLeft', 7, 4)).toBe(0);
    expect(gridMove(1, 'ArrowDown', 7, 4)).toBe(5);
    expect(gridMove(3, 'ArrowDown', 7, 4)).toBe(6); // answers → plain link
    expect(gridMove(5, 'ArrowUp', 7, 4)).toBe(1);
    expect(gridMove(6, 'ArrowDown', 7, 4)).toBe(6);
    expect(gridMove(2, 'Enter', 7, 4)).toBeNull();
    expect(gridMove(4, 'ArrowDown', 7, 2)).toBe(6);
  });
});
