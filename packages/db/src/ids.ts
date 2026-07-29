// Identifier types and minting for @papertree/db.
//
// Every identifier is a BRANDED string. The brands are structural noise to the runtime and
// load-bearing to the compiler: `getPaper(owner, paperId)` cannot be called with the two
// arguments swapped, and `OwnerId` in particular cannot be produced by writing a string
// literal. See owner.ts for why that matters more than the others.

import { randomBytes } from 'node:crypto';

// The brand carrier. `declare` means it has no runtime existence at all, so no value of
// these types can be constructed by hand — only cast, which is deliberately conspicuous.
declare const ID_BRAND: unique symbol;

/** A string tagged with a phantom name. Assignable to `string`; nothing is assignable to it. */
export type Branded<Name extends string> = string & { readonly [ID_BRAND]: Name };

/**
 * The owner of every row this package will let you touch.
 *
 * IT IS NOT A USER ID. It is an opaque, unguessable, per-connection HANDLE minted in
 * exactly one place — `PaperTreeDb.createUser()` / `authenticate()`, which require a
 * matching `users` row — and translated back to a `user_id` only inside the database
 * class (`PaperTreeDb.#resolve`).
 *
 * That distinction is the entire runtime half of gate 3, and it exists because the
 * obvious design failed review. When the minted value WAS the user id, the cast escape
 * `bobUserId as OwnerId` — legal TypeScript, since this is a branded string — was
 * rejected only for users the connection had never authenticated. In a one-process,
 * one-connection, many-tenant deployment that set contains every real user forever, so
 * the escape was open on exactly the users that matter: an adversarial review used it to
 * read and overwrite another tenant's highlight, which is findings.md §F1 verbatim.
 *
 * A handle nobody can name cannot be cast into existence. Type space stops
 * `const o: OwnerId = 'usr_x'`; the handle stops `x as OwnerId`.
 */
export type OwnerId = Branded<'OwnerId'>;

/** `ppr_` + ULID. Minted ONCE per (owner, source_hash) and held fixed across re-parses. */
export type PaperId = Branded<'PaperId'>;
/** `blk_` + 16 base32 chars. CONTENT-DERIVED, so it repeats across generations by design. */
export type BlockId = Branded<'BlockId'>;
/** `pg_` + 16 base32 chars. */
export type PageId = Branded<'PageId'>;
export type HighlightId = Branded<'HighlightId'>;
export type AnchorId = Branded<'AnchorId'>;
export type DerivationId = Branded<'DerivationId'>;

/**
 * A parse generation, ≥ 1 (DESIGN.md D13). Branded so it cannot be transposed with
 * `page_index`, `order` or `doc_order` — four integers that all mean different things and
 * would otherwise be freely interchangeable at every call site.
 */
export type Generation = number & { readonly [ID_BRAND]: 'Generation' };

/** Validates and brands a generation. */
export function generation(value: number): Generation {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`generation must be an integer >= 1, got ${String(value)}`);
  }
  return value as Generation;
}

// Crockford base32, uppercase, no I/L/O/U — the alphabet the PaperIR id patterns use.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A 26-character Crockford base32 ULID: 48 bits of ms timestamp, 80 bits of randomness. */
function ulid(now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i += 1) {
    time = `${CROCKFORD[t % 32] ?? '0'}${time}`;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i += 1) {
    rand += CROCKFORD[(bytes[i] ?? 0) % 32] ?? '0';
  }
  return time + rand;
}

/** Mints a prefixed ULID, e.g. `newId('ppr')`. */
export function newId<T extends string>(prefix: T): `${T}_${string}` {
  return `${prefix}_${ulid()}`;
}

/** Casts an id string that came from PaperIR (where it was already schema-validated). */
export function asPaperId(value: string): PaperId {
  return value as PaperId;
}
export function asBlockId(value: string): BlockId {
  return value as BlockId;
}
export function asPageId(value: string): PageId {
  return value as PageId;
}
