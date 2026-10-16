/**
 * A diagram run's answer, line by line (v0.2 S7a, #216; ADR-004 §2.9; RESEARCH-R3 Q1's schema).
 * The model writes NDJSON (`plate`, `part`, `link`, `end`); `PlateReader` turns every complete line
 * into a `plate`, `part` or `link` event, or skips it with a `status` frame, and never throws: one
 * bad line costs one line, not the plate. Validation is zod, here on the server only, with the text
 * limits of the committed run-events schema (`DIAGRAM_LIMITS`, the API's are the same file),
 * counted in code points. The API then resolves each part's quote to an Anchor; this module never
 * sees the paper.
 */
import { z } from 'zod';

import { DIAGRAM_LIMITS, type TextBound } from './contract.ts';
import { clip, codePoints, collapse, cutQuote } from './text.ts';

/** A plate holds at most twelve parts, lettered A-L in arrival order. */
export const MAX_PARTS = 12;
/** Links beyond this many are dropped (R3: twelve parts never need more). */
export const MAX_LINKS = 20;
export const LETTERS = 'ABCDEFGHIJKL';
/** The tools a diagram run may use (a plate reads passages, it does not search the paper). */
export const DIAGRAM_TOOLS: readonly string[] = ['get_passage', 'get_section'];

/** Display text is clipped, not refused: a 30-character label still names its part. The minimum
 * is checked after the cut, in the same unit. */
function clipped(bound: TextBound) {
  return z
    .string()
    .transform((value) => clip(collapse(value), bound.max, true))
    .refine((value) => codePoints(value) >= bound.min, `at least ${String(bound.min)} characters`);
}

/** A quote must stay verbatim: cut without an ellipsis (text.ts `cutQuote`), its minimum checked
 * after the cut, so a long quote is never cut below it. */
const Quote = z
  .string()
  .transform((value) => cutQuote(value, DIAGRAM_LIMITS.quote.min, DIAGRAM_LIMITS.quote.max))
  .refine(
    (value) => codePoints(value) >= DIAGRAM_LIMITS.quote.min,
    `a quote of at least ${String(DIAGRAM_LIMITS.quote.min)} characters`,
  );

const Letter = z.string().regex(/^[A-L]$/);

const PartLine = z.object({
  t: z.literal('part'),
  label: clipped(DIAGRAM_LIMITS.label),
  text: clipped(DIAGRAM_LIMITS.text).default(''),
  kind: z.enum(['input', 'step', 'output', 'concept']).default('step'),
  after: z.array(Letter).max(3).default([]),
  edge: z.array(clipped(DIAGRAM_LIMITS.edge).nullable()).max(3).optional(),
  // Required and nullable: "no passage says this" is an explicit null, never an omission.
  cite: z.object({ quote: Quote, page: z.number().int().positive().optional() }).nullable(),
});

const LinkLine = z.object({
  t: z.literal('link'),
  from: Letter,
  to: Letter,
  label: clipped(DIAGRAM_LIMITS.link).optional(),
});

/** One NDJSON line of a `diagram-v1` answer. Unknown keys (a `letter` the model counted) are dropped. */
export const DiagramLine = z.discriminatedUnion('t', [
  z.object({ t: z.literal('plate'), title: clipped(DIAGRAM_LIMITS.title) }),
  PartLine,
  LinkLine,
  z.object({ t: z.literal('end') }),
]);
export type DiagramLine = z.infer<typeof DiagramLine>;

/** The model's quote for a part, before the API looked for it in the paper. */
export interface PartCite {
  readonly quote: string;
  readonly page?: number;
}

/** `event: part` (run-events.schema.json `$defs.part`). */
export interface PartEvent {
  readonly letter: string;
  readonly label: string;
  readonly text: string;
  readonly kind: 'input' | 'step' | 'output' | 'concept';
  readonly after: string[];
  /** One label (or null) per `after` entry. */
  readonly edge: Array<string | null>;
  readonly cite: PartCite | null;
}

/** What a reader emits; `status` is a skipped or trimmed line, told to the reader. */
export type DiagramEvent =
  | { readonly name: 'plate'; readonly data: { readonly title: string } }
  | { readonly name: 'part'; readonly data: PartEvent }
  | {
      readonly name: 'link';
      readonly data: {
        readonly source: string;
        readonly target: string;
        readonly label: string | null;
      };
    }
  | {
      readonly name: 'status';
      readonly data: { readonly phase: 'writing'; readonly label: string };
    };

/** The status labels, said once each where they repeat. */
export const SKIPPED = {
  unreadable: 'Skipped a line of the plate that could not be read',
  shape: 'Skipped a line that did not fit the plate',
  prose: 'Skipped text that is not part of the plate',
  title: 'Kept the first title of the plate',
  full: `The plate holds ${String(MAX_PARTS)} parts; the rest were left out`,
  link: 'Skipped an arrow between parts that are not on the plate',
  missing: 'dropped an arrow from a part that was not drawn',
  ahead: 'dropped an arrow from a part that does not come before it',
  after: 'Skipped what came after the end of the plate',
} as const;

/** True when `line` is one valid diagram line (it proves a held message is the answer, run.ts). */
export function isDiagramLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    return DiagramLine.safeParse(JSON.parse(trimmed)).success;
  } catch {
    return false;
  }
}

/** True when `text` holds a COMPLETE (newline-ended) valid diagram line. */
export function holdsDiagramLine(text: string): boolean {
  const end = text.lastIndexOf('\n');
  return end !== -1 && text.slice(0, end).split('\n').some(isDiagramLine);
}

/** A line that was meant as a part, readable or not: it takes one of the model's letters. */
const PART_ATTEMPT = /"t"\s*:\s*"part"/;

function isPartAttempt(json: unknown): boolean {
  return typeof json === 'object' && json !== null && (json as { t?: unknown }).t === 'part';
}

/**
 * Reads one diagram answer's text as it streams. TWO COUNTS, kept apart (S7a review B1): the model
 * letters its parts by every part line it WROTE (the prompt: "the first part line is A … count"),
 * the plate letters the parts it PLACED. Once a part line is skipped the two differ for the rest of
 * the plate, so every `after` and `link` letter is the model's and is translated through the map
 * of placed parts: an arrow from a part that was not drawn is dropped and said so, never moved to
 * the next part; an arrow from a part that does not come before this one (a later letter, or the
 * part itself) is TRIMMED: the part is kept and that one arrow dropped, so the graph is acyclic by
 * construction (ADR-004 §2.9) and a miscount costs an arrow, not a part.
 *
 * @example
 * const reader = new PlateReader((event) => sse.event(event.name, { ...event.data }));
 * reader.push('{"t":"plate","title":"Atte');
 * reader.push('ntion"}\n'); // emits plate {title: "Attention"}
 * reader.flush();
 */
export class PlateReader {
  private pending = '';
  /** Part lines the model wrote, readable or not: the index of its next letter. */
  private written = 0;
  private placed = 0;
  /** The model's letter -> the plate's, for every part placed. */
  private readonly drawn = new Map<string, string>();
  private links = 0;
  private titled = false;
  private ended = false;
  private readonly told = new Set<string>();
  private readonly emit: (event: DiagramEvent) => void;

  constructor(emit: (event: DiagramEvent) => void) {
    this.emit = emit;
  }

  /** How many parts have been placed. */
  get parts(): number {
    return this.placed;
  }

  /** Feed a text delta; every line it completes is read now. */
  push(delta: string): void {
    this.pending += delta;
    let cut = this.pending.indexOf('\n');
    while (cut !== -1) {
      const line = this.pending.slice(0, cut);
      this.pending = this.pending.slice(cut + 1);
      this.line(line);
      cut = this.pending.indexOf('\n');
    }
  }

  /** The answer ended: a last line with no newline after it is read too. */
  flush(): void {
    const rest = this.pending;
    this.pending = '';
    if (rest.trim() !== '') this.line(rest);
  }

  private status(label: string, once = false): void {
    if (once && this.told.has(label)) return;
    this.told.add(label);
    this.emit({ name: 'status', data: { phase: 'writing', label } });
  }

  private line(raw: string): void {
    const text = raw.trim();
    // Blank lines and a Markdown fence around the lines (R3: tolerated) carry nothing.
    if (text === '' || text.startsWith('```')) return;
    if (this.ended) return this.status(SKIPPED.after, true);
    if (!text.startsWith('{')) return this.status(SKIPPED.prose, true);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      if (PART_ATTEMPT.test(text)) this.written++;
      return this.status(SKIPPED.unreadable);
    }
    const parsed = DiagramLine.safeParse(json);
    if (!parsed.success) {
      if (isPartAttempt(json)) this.written++;
      return this.status(SKIPPED.shape);
    }
    const line = parsed.data;
    switch (line.t) {
      case 'plate':
        if (this.titled) return this.status(SKIPPED.title, true);
        this.titled = true;
        return this.emit({ name: 'plate', data: { title: line.title } });
      case 'part':
        return this.part(line);
      case 'link':
        return this.link(line);
      case 'end':
        this.ended = true;
        return;
    }
  }

  private part(line: z.infer<typeof PartLine>): void {
    const index = this.written++; // this line's place in the model's count
    if (this.placed >= MAX_PARTS) return this.status(SKIPPED.full, true);
    const letter = LETTERS.charAt(this.placed);
    const after: string[] = [];
    const edge: Array<string | null> = [];
    const dropped = new Set<string>();
    line.after.forEach((from, i) => {
      const mapped = this.drawn.get(from);
      if (LETTERS.indexOf(from) >= index) dropped.add(SKIPPED.ahead);
      else if (mapped === undefined) dropped.add(SKIPPED.missing);
      else if (!after.includes(mapped)) {
        after.push(mapped);
        edge.push(line.edge?.[i] ?? null);
      }
    });
    this.placed++;
    const own = LETTERS.charAt(index);
    if (own !== '') this.drawn.set(own, letter);
    for (const why of dropped) this.status(`Part ${letter}: ${why}`);
    this.emit({
      name: 'part',
      data: {
        letter,
        label: line.label,
        text: line.text,
        kind: line.kind,
        after,
        edge,
        cite:
          line.cite === null
            ? null
            : line.cite.page === undefined
              ? { quote: line.cite.quote }
              : { quote: line.cite.quote, page: line.cite.page },
      },
    });
  }

  private link(line: z.infer<typeof LinkLine>): void {
    const source = this.drawn.get(line.from);
    const target = this.drawn.get(line.to);
    if (this.links >= MAX_LINKS || !source || !target || source === target) {
      return this.status(SKIPPED.link);
    }
    this.links++;
    this.emit({ name: 'link', data: { source, target, label: line.label ?? null } });
  }
}
