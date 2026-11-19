import { describe, expect, it } from 'vitest';

import {
  FRESH_CHECK,
  isRight,
  normalizeFill,
  parseCheck,
  showCheck,
  splitPrompt,
  submitCheck,
  typeCheck,
  type CheckSpec,
} from './check';

const BODY = [
  'prompt: If $F(x) = 0$, the block outputs ___.',
  'accept: x | the input | input | its input',
  'right: Right. $0 + x = x$: the block hands its input straight on.',
  'hint: Put 0 in place of $F(x)$ in $F(x) + x$ and see what is left.',
].join('\n');

const SPEC = parseCheck(BODY) as CheckSpec;

describe('parseCheck', () => {
  it('reads the four keys and the accepted fills', () => {
    expect(SPEC.prompt).toBe('If $F(x) = 0$, the block outputs ___.');
    expect(SPEC.accept).toEqual(['x', 'the input', 'input', 'its input']);
    expect(SPEC.right).toMatch(/^Right\./);
    expect(SPEC.hint).toMatch(/^Put 0/);
  });

  it('joins a value that wrapped onto the next line', () => {
    const wrapped = parseCheck('prompt: A ___ B\naccept: x\nhint: first part\nsecond part');
    expect(wrapped?.hint).toBe('first part second part');
  });

  it('is not a check without a prompt or without anything to accept', () => {
    expect(parseCheck('accept: x\nright: ok')).toBeNull();
    expect(parseCheck('prompt: A ___ B\naccept: |  | ')).toBeNull();
    expect(parseCheck('nonsense')).toBeNull();
  });
});

describe('matching', () => {
  it('normalises case, spaces, dollars and the punctuation around a fill', () => {
    expect(normalizeFill('  The   INPUT. ')).toBe('the input');
    expect(normalizeFill('$x$')).toBe('x');
    expect(normalizeFill('"its input"!')).toBe('its input');
    expect(normalizeFill('(x)')).toBe('x');
  });

  it('accepts any listed fill after normalising, and never an empty blank', () => {
    expect(isRight(SPEC, 'X')).toBe(true);
    expect(isRight(SPEC, ' the input. ')).toBe(true);
    expect(isRight(SPEC, '$x$')).toBe(true);
    expect(isRight(SPEC, '')).toBe(false);
    expect(isRight(SPEC, '...')).toBe(false);
    expect(isRight(SPEC, '0')).toBe(false);
    // Inner words matter: "the  input" collapses, "input layer" does not match.
    expect(isRight(SPEC, 'input layer')).toBe(false);
  });
});

describe('the check state', () => {
  it('right: Enter closes it', () => {
    const typed = typeCheck(FRESH_CHECK, 'x');
    expect(submitCheck(SPEC, typed)).toEqual({ value: 'x', phase: 'right' });
  });

  it('wrong: Enter shows the hint, the blank stays open and typing again steps the hint aside', () => {
    const wrong = submitCheck(SPEC, typeCheck(FRESH_CHECK, 'zero'));
    expect(wrong).toEqual({ value: 'zero', phase: 'wrong' });
    // The same wrong fill again keeps the one hint (still `wrong`, nothing new).
    expect(submitCheck(SPEC, wrong)).toEqual(wrong);
    expect(typeCheck(wrong, 'zer')).toEqual({ value: 'zer', phase: 'idle' });
    // And it can still be answered.
    expect(submitCheck(SPEC, typeCheck(wrong, 'input'))).toEqual({
      value: 'input',
      phase: 'right',
    });
  });

  it('an empty blank does nothing on Enter', () => {
    expect(submitCheck(SPEC, FRESH_CHECK)).toEqual(FRESH_CHECK);
  });

  it('Show me fills the first accepted fill and closes it as shown', () => {
    expect(showCheck(SPEC)).toEqual({ value: 'x', phase: 'shown' });
  });

  it('a closed check cannot be typed over or checked again', () => {
    const shown = showCheck(SPEC);
    expect(typeCheck(shown, 'y')).toBe(shown);
    expect(submitCheck(SPEC, shown)).toBe(shown);
  });
});

describe('splitPrompt', () => {
  it('cuts at the blank', () => {
    expect(splitPrompt('If $F(x) = 0$, the block outputs ___.')).toEqual({
      before: 'If $F(x) = 0$, the block outputs ',
      after: '.',
    });
  });

  it('puts the blank at the end of a prompt that has none', () => {
    expect(splitPrompt('What is left?')).toEqual({ before: 'What is left? ', after: '' });
  });
});
