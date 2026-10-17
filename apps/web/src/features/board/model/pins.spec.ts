/**
 * The board's pin table is a COPY of the server's (`papertree_db.canvas.PIN_TABLE`). This reads the
 * Python source and fails when the two differ, kind by kind and pin by pin, so a pin the client
 * offers is never one the server refuses (or the other way round).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FALLBACK_IN,
  FALLBACK_OUT,
  PIN_REFUSED,
  PIN_TABLE,
  canConnect,
  edgeHandles,
  pinRefusal,
  resolvePorts,
  type Port,
} from './pins';

const CANVAS_PY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../packages/db/python/papertree_db/canvas.py',
);

/** `PIN_TABLE` as the Python source writes it: kind → sorted out-pins and in-pins. */
function serverTable(): Record<string, { out: string[]; into: string[] }> {
  const source = readFileSync(CANVAS_PY, 'utf8');
  const start = source.indexOf('PIN_TABLE: Final[Mapping[str, Pins]] = {');
  expect(start, 'PIN_TABLE is no longer declared as the test expects').toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf('\n}\n', start)).replace(/\s+/g, ' ');
  const set = (args: string, name: string): string[] => {
    const m = new RegExp(`${name}=frozenset\\(\\{([^}]*)\\}\\)`).exec(args);
    return m === null ? [] : [...m[1]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!).sort();
  };
  const table: Record<string, { out: string[]; into: string[] }> = {};
  for (const m of body.matchAll(/"(\w+)": Pins\(((?:[^()]|\([^()]*\))*)\)/g)) {
    table[m[1]!] = { out: set(m[2]!, 'out'), into: set(m[2]!, 'into') };
  }
  return table;
}

describe('the pin table', () => {
  it('equals the server’s, for all seven card kinds', () => {
    const server = serverTable();
    expect(Object.keys(server).sort()).toEqual(Object.keys(PIN_TABLE).sort());
    expect(Object.keys(server)).toHaveLength(7);
    for (const [kind, pins] of Object.entries(PIN_TABLE)) {
      expect({ kind, out: [...pins.out].sort(), into: [...pins.into].sort() }).toEqual({
        kind,
        ...server[kind],
      });
    }
  });

  it('refuses with the server’s own words', () => {
    expect(readFileSync(CANVAS_PY, 'utf8')).toContain(`PIN_REFUSED: Final = "${PIN_REFUSED}"`);
    expect(pinRefusal()).toBe('That pin does not take that thread.');
  });
});

describe('canConnect, every kind × every pin, as the server checks it', () => {
  const kinds = Object.keys(PIN_TABLE) as (keyof typeof PIN_TABLE)[];
  const ports: Port[] = ['claim_out', 'answer_out', 'evidence_in', 'question_in'];
  const server = serverTable();

  it('takes a thread exactly when the out-pin and the in-pin are both offered', () => {
    for (const from of kinds)
      for (const to of kinds)
        for (const fromPort of ports)
          for (const toPort of ports) {
            const expected =
              server[from]!.out.includes(fromPort) && server[to]!.into.includes(toPort);
            expect(
              canConnect({ kind: from, port: fromPort }, { kind: to, port: toPort }),
              `${from}.${fromPort} → ${to}.${toPort}`,
            ).toBe(expected);
          }
  });

  it('frame 06’s threads are all legal, and an in-pin never starts one', () => {
    expect(
      canConnect(
        { kind: 'explanation', port: 'answer_out' },
        { kind: 'question', port: 'question_in' },
      ),
    ).toBe(true);
    expect(
      canConnect({ kind: 'diagram', port: 'claim_out' }, { kind: 'excerpt', port: 'evidence_in' }),
    ).toBe(true);
    expect(
      canConnect({ kind: 'excerpt', port: 'evidence_in' }, { kind: 'note', port: 'evidence_in' }),
    ).toBe(false);
    expect(
      canConnect({ kind: 'question', port: 'claim_out' }, { kind: 'note', port: 'evidence_in' }),
    ).toBe(false);
    expect(canConnect({ kind: 'note', port: null }, { kind: 'note', port: 'evidence_in' })).toBe(
      false,
    );
  });
});

describe('a thread with no pins (the toolbar Link, every v0.1 link)', () => {
  const kinds = Object.keys(PIN_TABLE) as (keyof typeof PIN_TABLE)[];
  const handlesOf = (kind: keyof typeof PIN_TABLE) => ({
    out: [...PIN_TABLE[kind].out, FALLBACK_OUT] as string[],
    into: [...PIN_TABLE[kind].into, FALLBACK_IN] as string[],
  });

  it('always resolves to handles both cards carry, for every pair of kinds', () => {
    for (const from of kinds)
      for (const to of kinds) {
        const { sourceHandle, targetHandle } = edgeHandles(
          { from_port: null, to_port: null },
          from,
          to,
        );
        expect(handlesOf(from).out, `${from} → ${to}`).toContain(sourceHandle);
        expect(handlesOf(to).into, `${from} → ${to}`).toContain(targetHandle);
      }
  });

  it('keeps the pins a thread was saved with', () => {
    expect(
      edgeHandles({ from_port: 'answer_out', to_port: 'question_in' }, 'explanation', 'question'),
    ).toEqual({ sourceHandle: 'answer_out', targetHandle: 'question_in' });
  });

  it('picks real pins for Link when the cards offer them, and nothing a server would refuse', () => {
    for (const from of kinds)
      for (const to of kinds) {
        const ports = resolvePorts(from, to);
        if (ports === null) {
          expect(PIN_TABLE[from].out.length * PIN_TABLE[to].into.length).toBe(0);
        } else {
          expect(
            canConnect({ kind: from, port: ports.from_port }, { kind: to, port: ports.to_port }),
          ).toBe(true);
        }
      }
    expect(resolvePorts('question', 'note')).toBeNull();
    expect(resolvePorts('note', 'question')).toEqual({
      from_port: 'claim_out',
      to_port: 'evidence_in',
    });
  });
});
