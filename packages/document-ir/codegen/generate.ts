/**
 * F0.3 — the ONE generator.
 *
 * `schema/*.schema.json` is the single source of truth (DESIGN.md §1). This file reads the two
 * schema files, builds ONE in-memory model of each, and emits every language binding from it:
 *
 *   src/generated/types.ts                                    TypeScript types      (paperir)
 *   src/generated/zod.ts                                      Zod validators        (paperir)
 *   src/generated/derivation.types.ts                         TypeScript types      (derivation)
 *   src/generated/derivation.zod.ts                           Zod validators        (derivation)
 *   python/papertree_document_ir/generated/models.py           Pydantic v2 models   (paperir)
 *   python/papertree_document_ir/generated/derivation_models.py Pydantic v2 models  (derivation)
 *   python/papertree_document_ir/generated/__init__.py
 *
 * Two schema files ⇒ two generated modules per language, per DESIGN.md §6 ("do not merge them;
 * do not add a cross-file $ref"). The block-id pattern is duplicated in the two schemas on
 * purpose and is therefore duplicated in the two generated modules on purpose.
 *
 * WHY NOT AN OFF-THE-SHELF GENERATOR (json-schema-to-typescript / datamodel-code-generator):
 * three constructs in this schema need hand-controlled output and every generator we checked
 * mangles at least one of them —
 *   1. OPEN TYPE VOCABULARIES. `Block.type` is a patterned string; the vocabulary lives in an
 *      UNREFERENCED $def. Generators either narrow the field to the enum (destroying forward
 *      compatibility, DESIGN.md D2) or drop the vocabulary entirely.
 *   2. CONDITIONAL PAYLOADS. `Block.payload` is selected by if/then on an OPEN discriminator.
 *      Generators emit an `anyOf` of four payload types, which accepts an equation block
 *      carrying an OpaquePayload — a verdict ajv does not give.
 *   3. `additionalProperties: false` + `propertyNames` + the recursive `ModelFreeSubtree`.
 *      Nothing off the shelf emits `.strict()` on the last of those, and a single miss silently
 *      evaporates the F0.2 guarantee in the bindings while it still holds in the schema.
 * Owning the generator also means the TS and Python enums are emitted from the same in-memory
 * model in the same pass and cannot disagree.
 *
 * DETERMINISM. Output is a pure function of the two schema files: definitions are emitted in a
 * stable dependency order derived from declaration order, there are no timestamps, no absolute
 * paths and no environment reads. Line endings are LF and every file ends in a newline.
 * `test/codegen-drift.spec.ts` byte-compares a fresh generation against the committed files.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------------------------
// Schema model
// ---------------------------------------------------------------------------------------------

/** A JSON Schema node. Deliberately loose: the schema is the source of truth, not this type. */
export interface JsonSchema {
  [keyword: string]: unknown;
}

export interface SchemaFile {
  /** Short key used in banners and file names. */
  readonly key: string;
  /** Path of the schema relative to the package root, for the banner. */
  readonly path: string;
  readonly root: JsonSchema;
  readonly defs: Record<string, JsonSchema>;
  /** Definition names in dependency order (a def is emitted after everything it references). */
  readonly order: readonly string[];
  /** The $def the root `$ref` points at. */
  readonly rootDef: string;
}

/**
 * The only hand-maintained table in the generator, and it is here rather than inferred because
 * the link it records does not exist in the schema: `$defs/KnownBlockType` is deliberately NOT
 * referenced by `Block.type` (DESIGN.md §2.1 — referencing it would close the vocabulary). The
 * mapping says "this patterned string field has that documented vocabulary".
 * A wrong entry here is caught by `codegen-drift.spec` only if the schema changes, so it is
 * asserted against the schema at generation time (see `checkOpenVocabularies`).
 */
const OPEN_VOCABULARY: Readonly<Record<string, string>> = {
  "paperir:Block.type": "KnownBlockType",
  "paperir:Relation.type": "KnownRelationType",
  "derivation:Derivation.kind": "KnownDerivationKind",
};

/** $defs that are documentation + codegen input only, never validation constraints (§2.1). */
const DOC_ONLY_VOCABULARIES = new Set([
  "KnownBlockType",
  "KnownHeadingBlockType",
  "KnownRelationType",
  "KnownDerivationKind",
]);

// ---------------------------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------------------------

function refName(ref: string): string {
  const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (!m || !m[1]) throw new Error(`unsupported $ref (only #/$defs/<Name> is supported): ${ref}`);
  return m[1];
}

/** Every $def name reachable from `node`, in first-seen order. */
function refsOf(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) refsOf(child, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") {
        const name = refName(v);
        if (!out.includes(name)) out.push(name);
        continue;
      }
      refsOf(v, out);
    }
  }
  return out;
}

/**
 * Dependency order: a definition is emitted after every definition it references. Recursion
 * (ModelFreeSubtree references itself) is broken by emitting the def as soon as it is entered,
 * which is safe because every recursive def in this schema is hand-encoded as a function.
 */
function dependencyOrder(defs: Record<string, JsonSchema>): string[] {
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string): void => {
    const s = state.get(name);
    if (s === "done" || s === "visiting") return;
    state.set(name, "visiting");
    const def = defs[name];
    if (!def) throw new Error(`$ref to a missing definition: ${name}`);
    for (const dep of refsOf(def)) visit(dep);
    state.set(name, "done");
    order.push(name);
  };
  for (const name of Object.keys(defs)) visit(name);
  return order;
}

function loadSchema(key: string, relPath: string): SchemaFile {
  const root = JSON.parse(readFileSync(join(PKG, relPath), "utf8")) as JsonSchema;
  const defs = root.$defs as Record<string, JsonSchema>;
  const rootRef = root.$ref;
  if (typeof rootRef !== "string") throw new Error(`${relPath}: root must be a $ref into $defs`);
  return { key, path: relPath, root, defs, order: dependencyOrder(defs), rootDef: refName(rootRef) };
}

/**
 * Guard on the hand-maintained OPEN_VOCABULARY table: every entry must name a real object
 * property that is a patterned string, and a real enum $def. A stale entry would silently emit a
 * type nobody validates against.
 */
function checkOpenVocabularies(file: SchemaFile): void {
  for (const [selector, vocab] of Object.entries(OPEN_VOCABULARY)) {
    const [fileKey, rest] = selector.split(":", 2);
    if (fileKey !== file.key || !rest) continue;
    const [defName, propName] = rest.split(".", 2);
    const def = defName ? file.defs[defName] : undefined;
    const props = def?.properties as Record<string, JsonSchema> | undefined;
    const prop = propName ? props?.[propName] : undefined;
    if (!prop || prop.type !== "string" || typeof prop.pattern !== "string") {
      throw new Error(`OPEN_VOCABULARY entry ${selector} does not name a patterned string field`);
    }
    const vocabDef = file.defs[vocab];
    if (!vocabDef || !Array.isArray(vocabDef.enum)) {
      throw new Error(`OPEN_VOCABULARY entry ${selector} names a non-enum $def ${vocab}`);
    }
  }
}

function openVocabularyFor(file: SchemaFile, defName: string, propName: string): string | undefined {
  return OPEN_VOCABULARY[`${file.key}:${defName}.${propName}`];
}

// ---------------------------------------------------------------------------------------------
// Shape classification — the one place that decides what a node "is"
// ---------------------------------------------------------------------------------------------

function isRef(node: JsonSchema): node is JsonSchema & { $ref: string } {
  return typeof node.$ref === "string";
}

/**
 * `oneOf: [X, {type: "null"}]` — or the shorthand `type: ["string", "null"]` — is
 * required-and-nullable (DESIGN.md D11). Returns the non-null half.
 */
function nullableInner(node: JsonSchema): JsonSchema | undefined {
  if (Array.isArray(node.type)) {
    const types = node.type as string[];
    const rest = types.filter((t) => t !== "null");
    if (types.includes("null") && rest.length === 1) {
      const { type: _ignored, ...others } = node;
      return { ...others, type: rest[0] as string };
    }
    throw new Error(`unsupported type array: ${JSON.stringify(types)}`);
  }
  const one = node.oneOf;
  if (!Array.isArray(one) || one.length !== 2) return undefined;
  const [a, b] = one as JsonSchema[];
  if (!a || !b) return undefined;
  if (b.type === "null" && !isRef(b)) return a;
  if (a.type === "null" && !isRef(a)) return b;
  return undefined;
}

/** A fixed-length array: `prefixItems` + `items: false`. */
function tupleItems(node: JsonSchema): JsonSchema[] | undefined {
  if (node.type !== "array" || !Array.isArray(node.prefixItems)) return undefined;
  if (node.items !== false) throw new Error("prefixItems without items:false is not supported");
  return node.prefixItems as JsonSchema[];
}

const withoutDocs = (node: unknown): unknown => {
  if (Array.isArray(node)) return node.map(withoutDocs);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "description" || k === "title" || k === "$comment") continue;
      out[k] = withoutDocs(v);
    }
    return out;
  }
  return node;
};

/** True when every element of a tuple has the same constraints (so it is a fixed-length list). */
function homogeneousTuple(items: JsonSchema[]): JsonSchema | undefined {
  if (items.length === 0) return undefined;
  const first = items[0];
  if (!first) return undefined;
  const ref = JSON.stringify(withoutDocs(first));
  return items.every((i) => JSON.stringify(withoutDocs(i)) === ref) ? first : undefined;
}

/** The empty schema `{}` — accepts anything, including null and (as a property) must be present. */
function isAnySchema(node: JsonSchema): boolean {
  return Object.keys(node).filter((k) => k !== "description" && k !== "title").length === 0;
}

// ---------------------------------------------------------------------------------------------
// Conditional branches (`allOf: [{if, then}, ...]`) — construct 2
// ---------------------------------------------------------------------------------------------

interface Branch {
  /** The discriminator property the `if` keys on. */
  readonly prop: string;
  readonly match:
    | { readonly kind: "enum"; readonly values: string[] }
    | { readonly kind: "const"; readonly value: string }
    | { readonly kind: "notEnum"; readonly values: string[] };
  readonly required: string[];
  /** property -> required const value. */
  readonly propConst: Array<[string, unknown]>;
  /** properties that must be ABSENT (`false` schema). */
  readonly propForbidden: string[];
  /** property -> $def the value must validate against. */
  readonly propRef: Array<[string, string]>;
}

function analyseBranches(def: JsonSchema): Branch[] {
  const all = def.allOf;
  if (!Array.isArray(all)) return [];
  return (all as JsonSchema[]).map((branch, i) => {
    const cond = branch.if as JsonSchema | undefined;
    const then = branch.then as JsonSchema | undefined;
    if (!cond || !then) throw new Error(`allOf[${i}] is not an if/then branch`);
    const condProps = (cond.properties ?? {}) as Record<string, JsonSchema>;
    const names = Object.keys(condProps);
    const prop = names[0];
    if (names.length !== 1 || !prop) {
      throw new Error(`allOf[${i}].if must key on exactly one property`);
    }
    const test = condProps[prop] as JsonSchema;
    let match: Branch["match"];
    if (Array.isArray(test.enum)) {
      match = { kind: "enum", values: test.enum as string[] };
    } else if (typeof test.const === "string") {
      match = { kind: "const", value: test.const };
    } else if (test.not && Array.isArray((test.not as JsonSchema).enum)) {
      match = { kind: "notEnum", values: (test.not as JsonSchema).enum as string[] };
    } else {
      throw new Error(`allOf[${i}].if uses an unsupported test on ${prop}`);
    }
    const thenProps = (then.properties ?? {}) as Record<string, unknown>;
    const propConst: Array<[string, unknown]> = [];
    const propForbidden: string[] = [];
    const propRef: Array<[string, string]> = [];
    for (const [name, value] of Object.entries(thenProps)) {
      if (value === true) continue; // "no further constraint" — nothing to emit
      if (value === false) {
        propForbidden.push(name);
        continue;
      }
      const sub = value as JsonSchema;
      if (isRef(sub)) propRef.push([name, refName(sub.$ref)]);
      else if ("const" in sub) propConst.push([name, sub.const]);
      else throw new Error(`allOf[${i}].then.properties.${name} uses an unsupported constraint`);
    }
    return {
      prop,
      match,
      required: ((then.required as string[] | undefined) ?? []).slice(),
      propConst,
      propForbidden,
      propRef,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Shared text helpers
// ---------------------------------------------------------------------------------------------

const banner = (file: SchemaFile, tool: string): string =>
  [
    `DO NOT EDIT — generated from ${file.path} by codegen/generate.ts.`,
    ``,
    `Regenerate with \`pnpm --filter @papertree/document-ir codegen\`. Hand edits are deleted by`,
    `the next run and are caught before that by test/codegen-drift.spec.ts. The JSON Schema is the`,
    `single source of truth (DESIGN.md §1); ${tool} is one of its bindings, never a second one.`,
  ].join("\n");

function jsDoc(text: string | undefined, indent: string): string {
  if (!text) return "";
  const safe = text.replace(/\*\//g, "*\\/");
  const lines = safe.split("\n");
  if (lines.length === 1 && (lines[0] as string).length + indent.length < 96) {
    return `${indent}/** ${lines[0] as string} */\n`;
  }
  return `${indent}/**\n${lines.map((l) => `${indent} *${l ? ` ${l}` : ""}`).join("\n")}\n${indent} */\n`;
}

/** Ruff's configured line-length. Generated prose is wrapped to it so the output is lint-clean. */
const PY_LINE_LENGTH = 100;

/**
 * Greedy word wrap. Deterministic (no locale, no environment) and per-source-line, so blank lines
 * and the bullet structure of the schema descriptions survive.
 */
function wrapLines(text: string, width: number): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    let current = "";
    for (const word of line.split(" ")) {
      if (current === "") current = word;
      else if (`${current} ${word}`.length <= width) current = `${current} ${word}`;
      else {
        out.push(current);
        current = word;
      }
    }
    if (current !== "") out.push(current);
  }
  return out;
}

function pyDoc(text: string | undefined, indent: string): string {
  if (!text) return "";
  const safe = text.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
  const lines = wrapLines(safe, PY_LINE_LENGTH - indent.length - 6);
  if (lines.length === 1) return `${indent}"""${lines[0] as string}"""\n`;
  const body = lines.map((l, i) => (i === 0 ? l : l ? `${indent}${l}` : "")).join("\n");
  return `${indent}"""${body}\n${indent}"""\n`;
}

/**
 * A field's description as `#:` attribute-doc comments rather than `Field(description=...)`.
 *
 * The schema descriptions are paragraphs, not labels — several run past 400 characters — and
 * putting them inside a call argument produced lines the repo's own line-length lint rejects and
 * a shape the formatter wanted to rewrite, which would have fought the drift test forever.
 * `#:` is the conventional Python attribute-doc marker, it wraps cleanly, and no formatter
 * touches comments. The authoritative copy of the prose is the schema; this is a convenience.
 */
function pyFieldDoc(text: string | undefined, indent: string): string {
  if (!text) return "";
  return wrapLines(text, PY_LINE_LENGTH - indent.length - 3)
    .map((l) => (l ? `${indent}#: ${l}\n` : `${indent}#:\n`))
    .join("");
}

const q = (s: string): string => JSON.stringify(s);

const snake = (s: string): string =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();

const num = (v: unknown): string => String(v);

/**
 * Python reserved words. A schema property named `from` (Repair.from — the field that carries
 * the whole "the original always survives" guarantee) is not a legal Python identifier, so it is
 * emitted as `from_` with `Field(alias="from")`. The alias is what validation keys on, and
 * `extra="forbid"` then rejects a document that spells the key `from_`.
 */
const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
  "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
  "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
  "with", "yield",
]);

const pyName = (prop: string): string => (PY_KEYWORDS.has(prop) ? `${prop}_` : prop);

/**
 * A Python string literal for a regex. Raw (`r"..."`) so the backslashes in a JSON Schema pattern
 * survive verbatim — JSON-escaping them instead produced `\\.` where the schema means `\.`, which
 * silently rejected every valid `ir_version` and every image URI.
 */
function pyRegexLiteral(rawPattern: string): string {
  // Neither Python's `re` nor the Rust engine behind Pydantic agrees with ECMA-262 on `\s`, so the
  // class is expanded here rather than handed to a second engine and hoped over (DESIGN.md §12.2).
  const pattern = expandEcmaClasses(rawPattern);
  if (pattern.includes('"') || pattern.endsWith("\\")) return q(pattern);
  return `r"${pattern}"`;
}

/**
 * How a $def is checked at runtime in Python. Most are Pydantic models; the hand-encoded ones
 * are functions, because a recursive constraint cannot be a model.
 */
function pyValidateCall(target: string, expr: string): string {
  if (target === "OpaquePayload") return `validate_opaque_payload(${expr})`;
  return `${target}.model_validate(${expr})`;
}

// ---------------------------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------------------------

function tsType(file: SchemaFile, node: JsonSchema, owner: string, prop?: string): string {
  if (isRef(node)) return refName(node.$ref);
  const nullable = nullableInner(node);
  if (nullable) return `${tsType(file, nullable, owner, prop)} | null`;
  if (Array.isArray(node.oneOf)) {
    return (node.oneOf as JsonSchema[]).map((n) => tsType(file, n, owner, prop)).join(" | ");
  }
  if ("const" in node) return q(node.const as string);
  if (Array.isArray(node.enum)) return (node.enum as unknown[]).map((v) => JSON.stringify(v)).join(" | ");
  const tuple = tupleItems(node);
  if (tuple) return `[${tuple.map((t) => tsType(file, t, owner, prop)).join(", ")}]`;
  switch (node.type) {
    case "string": {
      const vocab = prop ? openVocabularyFor(file, owner, prop) : undefined;
      return vocab ? vocab.replace(/^Known/, "") : "string";
    }
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const items = node.items as JsonSchema | undefined;
      if (!items) throw new Error("array without items");
      const inner = tsType(file, items, owner, prop);
      const atom = /[ |]/.test(inner) ? `(${inner})` : inner;
      return node.minItems === 1 ? `[${inner}, ...${atom}[]]` : `${atom}[]`;
    }
    case "object":
      return node.properties ? "Record<string, unknown>" : "Record<string, unknown>";
    default:
      if (isAnySchema(node)) return "unknown";
      throw new Error(`unsupported node: ${JSON.stringify(node).slice(0, 120)}`);
  }
}

function tsObjectBody(file: SchemaFile, name: string, def: JsonSchema, skip: Set<string>): string {
  const props = (def.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((def.required as string[] | undefined) ?? []);
  let out = "";
  for (const [prop, node] of Object.entries(props)) {
    if (skip.has(prop)) continue;
    out += jsDoc(node.description as string | undefined, "  ");
    out += `  ${prop}${required.has(prop) ? "" : "?"}: ${tsType(file, node, name, prop)};\n`;
  }
  return out;
}

function emitTsVocabulary(name: string, def: JsonSchema): string {
  const constName = `${snake(name).toUpperCase()}S`;
  const values = def.enum as string[];
  const alias = name.replace(/^Known/, "");
  let out = jsDoc(def.description as string | undefined, "");
  out += `export const ${constName} = [\n${values.map((v) => `  ${q(v)},`).join("\n")}\n] as const;\n\n`;
  out += `export type ${name} = (typeof ${constName})[number];\n\n`;
  out += `export function is${name}(value: string): value is ${name} {\n`;
  out += `  return (${constName} as readonly string[]).includes(value);\n}\n\n`;
  if (alias !== name && OPEN_VOCABULARY_ALIASES.has(name)) {
    out += `/**\n * The OPEN type: any identifier-shaped string validates, and a v1 consumer MUST tolerate a\n`;
    out += ` * type it has never seen (DESIGN.md D2). \`(string & {})\` keeps editor autocompletion on the\n`;
    out += ` * known values without narrowing the type to them.\n */\n`;
    out += `export type ${alias} = ${name} | (string & {});\n\n`;
  }
  return out;
}

/** Which Known* vocabularies get an open alias emitted (those actually used by a field). */
const OPEN_VOCABULARY_ALIASES = new Set(Object.values(OPEN_VOCABULARY));

function emitTsTypes(file: SchemaFile): string {
  let out = `/*\n${banner(file, "TypeScript")}\n*/\n\n`;
  for (const name of file.order) {
    const def = file.defs[name] as JsonSchema;
    if (DOC_ONLY_VOCABULARIES.has(name)) {
      out += emitTsVocabulary(name, def);
      continue;
    }
    if (name === "ModelFreeSubtree") {
      out += jsDoc(
        `${def.description as string}\n\nTypeScript cannot express "no object anywhere in this subtree carries key X", so this\nconstraint has no type — it is the runtime guard \`assertModelFree()\` in ./zod.js\n(DESIGN.md §6).`,
        "",
      );
      out += `export type ${name} = unknown;\n\n`;
      continue;
    }
    if (name === "OpaquePayload") {
      out += jsDoc(def.description as string | undefined, "");
      out += `export type ${name} = { readonly [key: string]: unknown };\n\n`;
      continue;
    }
    if (name === "Block") {
      out += emitTsBlock(file, name, def);
      continue;
    }
    out += jsDoc(def.description as string | undefined, "");
    if (def.type === "object" && def.properties) {
      out += `export interface ${name} {\n${tsObjectBody(file, name, def, new Set())}}\n\n`;
    } else {
      out += `export type ${name} = ${tsType(file, def, name)};\n\n`;
    }
  }
  return out;
}

/**
 * Construct 2 in TypeScript: the payload discriminated union. DESIGN.md §6 prescribes exactly
 * this shape — one member per if/then branch that pins a payload type, plus a fallback member
 * for every other (including unknown) type.
 */
function emitTsBlock(file: SchemaFile, name: string, def: JsonSchema): string {
  const branches = analyseBranches(def).filter((b) => b.propRef.length > 0);
  const discriminator = branches[0]?.prop ?? "type";
  let out = jsDoc(def.description as string | undefined, "");
  out += `export interface ${name}Base {\n${tsObjectBody(file, name, def, new Set([discriminator, "payload"]))}}\n\n`;
  const members: string[] = [];
  for (const b of branches) {
    const [payloadProp, payloadDef] = b.propRef[0] as [string, string];
    const typeExpr =
      b.match.kind === "const"
        ? q(b.match.value)
        : b.match.kind === "enum"
          ? b.match.values.map(q).join(" | ")
          : "string";
    const optional = b.required.includes(payloadProp) ? "" : "?";
    members.push(
      `  | (${name}Base & { ${b.prop}: ${typeExpr}; ${payloadProp}${optional}: ${payloadDef} })`,
    );
  }
  out += `/**\n`;
  out += ` * The block's payload is selected by \`${discriminator}\` (schema \`allOf\`/\`if\`/\`then\`). The final member is\n`;
  out += ` * the open branch: any other type — including one this version has never seen — carries at\n`;
  out += ` * most an OpaquePayload. TypeScript cannot subtract the known literals from \`string\`, so the\n`;
  out += ` * open member structurally overlaps the closed ones; the VALIDATOR is authoritative, and it\n`;
  out += ` * is generated from the same branches (see ./zod.js \`${name}Schema\`).\n`;
  out += ` */\n`;
  out += `export type ${name} =\n${members.join("\n")};\n\n`;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Zod validators
// ---------------------------------------------------------------------------------------------

function zodString(node: JsonSchema): string {
  let s = "z.string()";
  if (typeof node.minLength === "number") s += `.min(${num(node.minLength)})`;
  if (typeof node.maxLength === "number") s += `.max(${num(node.maxLength)})`;
  if (typeof node.pattern === "string") {
    s += `.regex(new RegExp(${q(node.pattern)}), { message: ${q(`must match ${node.pattern}`)} })`;
  }
  // Every string, without exception — see WELL_FORMED_TS. A binding-level strengthening over ajv,
  // applied uniformly in BOTH generated bindings so they cannot disagree with each other.
  s += `.refine(isWellFormedText, { message: ${q(WELL_FORMED_MESSAGE)} })`;
  if (node.format === "date-time") {
    s += `.refine(isDateTime, { message: 'must match format "date-time"' })`;
  } else if (typeof node.format === "string") {
    throw new Error(`unsupported format: ${String(node.format)}`);
  }
  return s;
}

function zodNumber(node: JsonSchema): string {
  let s = node.type === "integer" ? "z.number().int()" : "z.number()";
  if (typeof node.minimum === "number") s += `.min(${num(node.minimum)})`;
  if (typeof node.exclusiveMinimum === "number") s += `.gt(${num(node.exclusiveMinimum)})`;
  if (typeof node.maximum === "number") s += `.max(${num(node.maximum)})`;
  if (typeof node.exclusiveMaximum === "number") s += `.lt(${num(node.exclusiveMaximum)})`;
  return s;
}

function zodOf(node: JsonSchema): string {
  if (isRef(node)) return `${refName(node.$ref)}Schema`;
  const nullable = nullableInner(node);
  if (nullable) return `${zodOf(nullable)}.nullable()`;
  if (Array.isArray(node.oneOf)) {
    const members = (node.oneOf as JsonSchema[]).map((n) => zodOf(n));
    return `z.union([${members.join(", ")}])`;
  }
  if ("const" in node) return `z.literal(${JSON.stringify(node.const)})`;
  if (Array.isArray(node.enum)) {
    const values = node.enum as unknown[];
    if (values.every((v) => typeof v === "string")) {
      return `z.enum([${values.map((v) => q(v as string)).join(", ")}])`;
    }
    return `z.union([${values.map((v) => `z.literal(${JSON.stringify(v)})`).join(", ")}])`;
  }
  const tuple = tupleItems(node);
  if (tuple) return `z.tuple([${tuple.map((t) => zodOf(t)).join(", ")}])`;
  switch (node.type) {
    case "string":
      return zodString(node);
    case "integer":
    case "number":
      return zodNumber(node);
    case "boolean":
      return "z.boolean()";
    case "null":
      return "z.null()";
    case "array": {
      const items = node.items as JsonSchema | undefined;
      if (!items) throw new Error("array without items");
      let s = `z.array(${zodOf(items)})`;
      if (typeof node.minItems === "number") s += `.min(${num(node.minItems)})`;
      if (typeof node.maxItems === "number") s += `.max(${num(node.maxItems)})`;
      return s;
    }
    case "object":
      // `{"type": "object"}` with no properties: an open object. NOT `z.record` — see
      // OPEN_OBJECT_TS for why rebuilding the object silently deleted `__proto__`.
      return "openObject()";
    default:
      if (isAnySchema(node)) return "z.unknown()";
      throw new Error(`unsupported node: ${JSON.stringify(node).slice(0, 120)}`);
  }
}

/**
 * Construct 3: `.strict()` on every object, without exception. A single miss silently evaporates
 * the F0.2 field-closure guarantee in the bindings, so the emitter refuses to emit an object
 * whose schema does not close its field set.
 */
function zodObject(name: string, def: JsonSchema, indent = ""): string {
  if (def.additionalProperties !== false) {
    throw new Error(`${name}: object $def without additionalProperties:false — refusing to emit`);
  }
  const props = (def.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((def.required as string[] | undefined) ?? []);
  const lines: string[] = [];
  for (const [prop, node] of Object.entries(props)) {
    const suffix = required.has(prop) ? "" : ".optional()";
    lines.push(`${indent}    ${prop}: ${zodOf(node)}${suffix},`);
  }
  return `z\n${indent}  .object({\n${lines.join("\n")}\n${indent}  })\n${indent}  .strict()`;
}

/** Required properties whose schema accepts anything: Zod treats `z.unknown()` keys as optional. */
function requiredAnyProps(def: JsonSchema): string[] {
  const props = (def.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((def.required as string[] | undefined) ?? []);
  return Object.entries(props)
    .filter(([p, n]) => required.has(p) && isAnySchema(n))
    .map(([p]) => p);
}

function zodBranchChecks(def: JsonSchema, varName: string): string {
  const branches = analyseBranches(def);
  const parts: string[] = [];
  for (const b of branches) {
    const testExpr =
      b.match.kind === "const"
        ? `${varName}.${b.prop} === ${q(b.match.value)}`
        : `[${b.match.values.map((v) => q(v)).join(", ")}].includes(${varName}.${b.prop})`;
    const cond = b.match.kind === "notEnum" ? `!${testExpr}` : testExpr;
    const body: string[] = [];
    for (const req of b.required) {
      body.push(
        `      if (${varName}.${req} === undefined) {\n` +
          `        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [${q(req)}], message: ${q(`${req} is required when ${b.prop} is ${describeMatch(b)}`)} });\n` +
          `      }`,
      );
    }
    for (const [p, v] of b.propConst) {
      body.push(
        `      if (${varName}.${p} !== ${JSON.stringify(v)}) {\n` +
          `        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [${q(p)}], message: ${q(`${p} must be ${JSON.stringify(v)} when ${b.prop} is ${describeMatch(b)}`)} });\n` +
          `      }`,
      );
    }
    for (const p of b.propForbidden) {
      body.push(
        `      if (${varName}.${p} !== undefined) {\n` +
          `        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [${q(p)}], message: ${q(`${p} is forbidden when ${b.prop} is ${describeMatch(b)}`)} });\n` +
          `      }`,
      );
    }
    for (const [p, target] of b.propRef) {
      body.push(
        `      if (${varName}.${p} !== undefined) {\n` +
          `        const r = ${target}Schema.safeParse(${varName}.${p});\n` +
          `        if (!r.success) {\n` +
          `          for (const issue of r.error.issues) {\n` +
          `            ctx.addIssue({ ...issue, path: [${q(p)}, ...issue.path] });\n` +
          `          }\n` +
          `        }\n` +
          `      }`,
      );
    }
    if (body.length === 0) continue;
    parts.push(`    if (${cond}) {\n${body.join("\n")}\n    }`);
  }
  return parts.join("\n");
}

function describeMatch(b: Branch): string {
  if (b.match.kind === "const") return b.match.value;
  const list = b.match.values.join("/");
  return b.match.kind === "enum" ? `one of ${list}` : `none of ${list}`;
}

function emitZod(file: SchemaFile): string {
  const forbidden = Object.keys(
    (((file.defs.ModelFreeSubtree?.allOf as JsonSchema[] | undefined)?.[0]?.then as JsonSchema)
      ?.properties ?? {}) as Record<string, unknown>,
  );
  let out = "";

  for (const name of file.order) {
    const def = file.defs[name] as JsonSchema;
    if (DOC_ONLY_VOCABULARIES.has(name)) {
      // Documentation + codegen input only, never a validation constraint (DESIGN.md §2.1).
      // There is deliberately NO schema here: emitting one would invite a future edit to check a
      // field against it, which is exactly the closed vocabulary D2 exists to prevent. The value
      // list and the `is${name}()` guard live in the types module.
      out += `// ${name} is documentation only — no validator. See ./types.js for the value list\n`;
      out += `// and the is${name}() guard; narrowing a field to it would close an OPEN vocabulary.\n\n`;
      continue;
    }
    if (name === "ModelFreeSubtree") continue; // emitted above as assertModelFree
    if (name === "OpaquePayload") {
      out += emitZodOpaquePayload(name, def);
      continue;
    }
    if (def.type === "object" && def.properties) {
      const checks = zodBranchChecks(def, "value");
      const presence = requiredAnyProps(def).map(
        (p) =>
          `    if (!(${q(p)} in (value as Record<string, unknown>))) {\n` +
          `      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [${q(p)}], message: "Required" });\n` +
          `    }`,
      );
      const refinements = [...presence, ...(checks ? [checks] : [])];
      out += `/** ${name} — every field set closed with \`.strict()\` (schema \`additionalProperties: false\`). */\n`;
      if (refinements.length === 0) {
        out += `export const ${name}Schema = ${zodObject(name, def)};\n\n`;
      } else {
        out += `export const ${name}Schema = ${zodObject(name, def)}\n`;
        out += `  .superRefine((value, ctx) => {\n${refinements.join("\n")}\n  });\n\n`;
      }
      continue;
    }
    out += `export const ${name}Schema = ${zodOf(def)};\n\n`;
  }
  out += `/** The root of ${file.path}. */\n`;
  out += `export const ${file.rootDef}RootSchema = ${file.rootDef}Schema;\n`;

  // Helpers are prepended only when the body actually uses them: an unused declaration in a
  // generated file is a lint failure, and the two schema files do not use the same set.
  let head = `/*\n${banner(file, "Zod")}\n*/\n\n`;
  head += `import { z } from "zod";\n\n`;
  if (out.includes("isWellFormedText")) head += WELL_FORMED_TS;
  if (out.includes("openObject()")) head += OPEN_OBJECT_TS;
  // `modelFreeTs` (below) also calls findExcessiveDepth, so the bound travels with either.
  if (out.includes("findExcessiveDepth") || forbidden.length > 0) head += DEPTH_TS;
  if (out.includes("isDateTime")) head += DATE_TIME_TS;
  if (forbidden.length > 0) head += modelFreeTs(file, forbidden);
  return head + out;
}

function emitZodOpaquePayload(name: string, def: JsonSchema): string {
  const pattern = (def.propertyNames as JsonSchema).pattern as string;
  let out = `/**\n * ${name}: open in SHAPE (forward compatibility) but closed against authorship declarations at\n * any depth, and restricted to identifier-shaped keys.\n */\n`;
  out += `export const ${name}Schema = openObject()\n`;
  out += `  .superRefine((value, ctx) => {\n`;
  out += `    const tooDeep = findExcessiveDepth(value);\n`;
  out += `    if (tooDeep) {\n`;
  out += `      ctx.addIssue({ code: z.ZodIssueCode.custom, path: tooDeep, message: ${q(DEPTH_MESSAGE)} });\n`;
  out += `      return;\n`;
  out += `    }\n`;
  out += `    const keyPattern = new RegExp(${q(pattern)});\n`;
  out += `    for (const key of Object.keys(value)) {\n`;
  out += `      if (!keyPattern.test(key)) {\n`;
  out += `        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: ${q(`payload keys must match ${pattern}`)} });\n`;
  out += `      }\n`;
  out += `    }\n`;
  out += `    const offending = findModelDeclaration(value);\n`;
  out += `    if (offending) {\n`;
  out += `      ctx.addIssue({ code: z.ZodIssueCode.custom, path: offending.path, message: ${q("model-authorship declaration is forbidden in a payload subtree")} });\n`;
  out += `    }\n`;
  out += `  });\n\n`;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cross-binding constants. Both emitters read these, so the two languages cannot disagree on the
// bound or on the wording of the failure.
// ---------------------------------------------------------------------------------------------

/**
 * Maximum nesting depth of an OpaquePayload subtree, in BOTH bindings.
 *
 * The schema states no bound, so the answer to "is a 2000-deep payload valid?" was previously a
 * property of somebody's C stack: ajv THREW `RangeError: Maximum call stack size exceeded`
 * (not a verdict — an exception, which a caller writing `if (validate(doc))` never sees coming),
 * CPython's `json` raised `RecursionError` around 1000, and Zod returned VALID. A validator whose
 * answer to a hostile document is "crash" has no answer. 64 is far past anything a parser emits
 * (real payloads are 2–4 deep) and far short of every implementation's limit, so the bindings now
 * return a verdict. See DESIGN.md §12.6.
 */
const MAX_PAYLOAD_DEPTH = 64;

const DEPTH_MESSAGE = `payload nests deeper than ${MAX_PAYLOAD_DEPTH} levels`;

const WELL_FORMED_MESSAGE = "string contains an unpaired surrogate and is not UTF-8-encodable";

/**
 * ECMA-262 `\s` as an explicit set of code points.
 *
 * `ImageRef.uri`'s `[^\s]` is the schema's only whitespace class, and it was being handed verbatim
 * to three different regex engines that do not agree on what `\s` means: JS (ajv, Zod) uses this
 * set; the Rust `regex` crate behind pydantic uses `\p{White_Space}`, which OMITS U+FEFF and
 * INCLUDES U+0085. Two live divergences, in opposite directions, from one backslash. The generator
 * therefore expands the class itself before emitting any non-JS regex, so all three engines test
 * the same set. See DESIGN.md §12.2.
 */
const ECMA_WHITESPACE_CLASS =
  "\\t\\n\\v\\f\\r\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff";

/**
 * Rewrites `\s` / `\S` into an explicit class with ECMA-262 semantics, inside or outside a
 * character class. Everything else is passed through untouched — this is a targeted repair of the
 * one construct whose meaning is engine-dependent, not a regex transpiler.
 */
/**
 * Expanded pattern -> the segments it was assembled from. The expansion is the only thing that
 * makes a pattern longer than the Python line limit, and a regex may not be split at an arbitrary
 * offset (` ` and `[a-z]` both have interiors), so the SPLIT POINTS ARE THE SEAMS THE
 * GENERATOR ITSELF CREATED — safe by construction. See `pyPatternLines`.
 */
const PATTERN_PARTS = new Map<string, readonly string[]>();

function expandEcmaClasses(pattern: string): string {
  const parts: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current !== "") parts.push(current);
    current = "";
  };
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] as string;
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === "s" || next === "S") {
        if (next === "S" && inClass) {
          throw new Error(`\\S inside a character class is not supported: ${pattern}`);
        }
        if (inClass) {
          flush();
          parts.push(ECMA_WHITESPACE_CLASS);
        } else {
          current += next === "s" ? `[${ECMA_WHITESPACE_CLASS}]` : `[^${ECMA_WHITESPACE_CLASS}]`;
        }
        i += 1;
        continue;
      }
      current += ch + (next ?? "");
      i += 1;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    current += ch;
  }
  flush();
  const joined = parts.join("");
  if (parts.length > 1) PATTERN_PARTS.set(joined, parts);
  return joined;
}

const WELL_FORMED_TS = `/**
 * Unpaired-surrogate guard, applied to EVERY string in this binding.
 *
 * \`JSON.parse\` and ajv both accept a lone surrogate; it is not UTF-8-encodable, so such a document
 * cannot survive the serialisation round-trip \`$defs/Point\` names as a precondition, and
 * pydantic-core already rejects it in every string carrying \`pattern\` or \`minLength\` — while
 * silently accepting it in an unconstrained one. Rather than inherit one engine's incidental
 * behaviour, BOTH generated bindings reject it in every string. This is a deliberate, documented
 * strengthening over ajv (DESIGN.md §12.5); the corpus asserts the three-way verdict rather than
 * hiding it.
 */
const LONE_SURROGATE = /[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]/;

function isWellFormedText(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

`;

const OPEN_OBJECT_TS = `/**
 * \`{"type": "object"}\` with no \`properties\` — an open object, as \`type: "object"\` means in JSON
 * Schema: it rejects arrays and null and constrains nothing else.
 *
 * NOT \`z.record()\`. \`z.record\` REBUILDS the value key by key, and \`out["__proto__"] = v\` writes the
 * prototype rather than an own property, so \`JSON.parse\`'s own \`__proto__\` key VANISHED from the
 * parsed output before \`propertyNames\`, \`findModelDeclaration\` or a nested \`.strict()\` ever saw it.
 * Zod accepted a payload carrying a whole model-authorship declaration that ajv and Pydantic both
 * reject, and re-serialised the payload as \`{}\`. \`z.custom\` passes the value through by reference,
 * so every later check sees the real own keys. See DESIGN.md §12.1.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openObject(): z.ZodType<Record<string, unknown>> {
  return z.custom<Record<string, unknown>>(isPlainObject, { message: "Expected object" });
}

`;

const DEPTH_TS = `/** See codegen/generate.ts \`MAX_PAYLOAD_DEPTH\`; the Python twin carries the same number. */
export const MAX_PAYLOAD_DEPTH = ${MAX_PAYLOAD_DEPTH};

/**
 * The path at which \`value\` first nests deeper than MAX_PAYLOAD_DEPTH, or null.
 *
 * Iterative on purpose: a guard against unbounded recursion that is itself recursive would
 * overflow on exactly the input it exists to reject.
 */
export function findExcessiveDepth(value: unknown): (string | number)[] | null {
  const stack: Array<{ node: unknown; path: (string | number)[] }> = [{ node: value, path: [] }];
  while (stack.length > 0) {
    const { node, path } = stack.pop() as { node: unknown; path: (string | number)[] };
    if (node === null || typeof node !== "object") continue;
    if (path.length > MAX_PAYLOAD_DEPTH) return path;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) stack.push({ node: node[i], path: [...path, i] });
      continue;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      stack.push({ node: child, path: [...path, key] });
    }
  }
  return null;
}

`;

const DATE_TIME_TS = `/**
 * \`format: "date-time"\`, ported from ajv-formats' \`date-time\` so the Zod verdict and the ajv
 * verdict agree on the same strings (including the leap-second rule). Formats must VALIDATE,
 * not merely document.
 */
const DATE_RE = /^(\\d\\d\\d\\d)-(\\d\\d)-(\\d\\d)$/;
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const TIME_RE = /^(\\d\\d):(\\d\\d):(\\d\\d(?:\\.\\d+)?)(z|([+-])(\\d\\d)(?::?(\\d\\d))?)$/i;

function isDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const leap = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const limit = (DAYS_IN_MONTH[month] ?? 0) + (leap ? 1 : 0);
  return month >= 1 && month <= 12 && day >= 1 && day <= limit;
}

function isTime(value: string): boolean {
  const m = TIME_RE.exec(value);
  if (!m) return false;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = Number(m[3]);
  const sign = m[5] === "-" ? -1 : 1;
  const tzHour = Number(m[6] ?? 0);
  const tzMinute = Number(m[7] ?? 0);
  if (tzHour > 23 || tzMinute > 59) return false;
  if (hour <= 23 && minute <= 59 && second < 60) return true;
  // A leap second is only legal at 23:59:60 UTC.
  const utcMinute = minute - tzMinute * sign;
  const utcHour = hour - tzHour * sign - (utcMinute < 0 ? 1 : 0);
  return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1) && second < 61;
}

function isDateTime(value: string): boolean {
  const parts = value.split(/t|\\s/i);
  return parts.length === 2 && isDate(parts[0] as string) && isTime(parts[1] as string);
}

`;

function modelFreeTs(file: SchemaFile, forbidden: string[]): string {
  const def = file.defs.ModelFreeSubtree as JsonSchema;
  let out = jsDoc(def.description as string | undefined, "");
  out += `export const MODEL_AUTHORSHIP_KEYS = [\n${forbidden.map((k) => `  ${q(k)},`).join("\n")}\n] as const;\n\n`;
  out += `/**\n * Walks a value and returns the path of the first model-authorship declaration, or null.\n`;
  out += ` * TypeScript cannot express this constraint as a type, so it is a runtime guard (DESIGN.md §6).\n`;
  out += ` *\n`;
  out += ` * The descent stops at MAX_PAYLOAD_DEPTH so this guard cannot itself overflow the stack. That\n`;
  out += ` * is not a hole: every caller rejects an over-deep value outright before searching it, so the\n`;
  out += ` * truncated levels are levels no valid document has.\n */\n`;
  out += `export function findModelDeclaration(\n`;
  out += `  value: unknown,\n`;
  out += `  depth = 0,\n`;
  out += `): { path: (string | number)[] } | null {\n`;
  out += `  if (depth > MAX_PAYLOAD_DEPTH) return null;\n`;
  out += `  if (Array.isArray(value)) {\n`;
  out += `    for (let i = 0; i < value.length; i += 1) {\n`;
  out += `      const hit = findModelDeclaration(value[i], depth + 1);\n`;
  out += `      if (hit) return { path: [i, ...hit.path] };\n`;
  out += `    }\n`;
  out += `    return null;\n`;
  out += `  }\n`;
  out += `  if (value !== null && typeof value === "object") {\n`;
  out += `    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {\n`;
  out += `      if ((MODEL_AUTHORSHIP_KEYS as readonly string[]).includes(key)) return { path: [key] };\n`;
  out += `      const hit = findModelDeclaration(child, depth + 1);\n`;
  out += `      if (hit) return { path: [key, ...hit.path] };\n`;
  out += `    }\n`;
  out += `  }\n`;
  out += `  return null;\n}\n\n`;
  out += `/** Throws if \`value\` is over-deep or declares model authorship anywhere in its subtree. */\n`;
  out += `export function assertModelFree(value: unknown): void {\n`;
  out += `  const tooDeep = findExcessiveDepth(value);\n`;
  out += `  if (tooDeep) {\n`;
  out += `    throw new Error(\`${DEPTH_MESSAGE} at \${tooDeep.join(".")}\`);\n`;
  out += `  }\n`;
  out += `  const hit = findModelDeclaration(value);\n`;
  out += `  if (hit) {\n`;
  out += `    throw new Error(\`model-authorship declaration at \${hit.path.join(".")}\`);\n`;
  out += `  }\n}\n\n`;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pydantic v2 models
// ---------------------------------------------------------------------------------------------

interface PyField {
  readonly annotation: string;
  readonly args: string[];
}

function pyFieldArgs(node: JsonSchema): string[] {
  const args: string[] = [];
  if (typeof node.pattern === "string") args.push(`pattern=${pyRegexLiteral(node.pattern)}`);
  // Python's `json.loads` accepts the non-JSON literals NaN/Infinity/-Infinity, which JS's
  // `JSON.parse` cannot even read; Pydantic's `allow_inf_nan` defaults to True. Every float in
  // this schema is bounded, so this changes no verdict today — it is the guard that keeps the
  // first UNbounded number from becoming a divergence (DESIGN.md §12.7).
  if (node.type === "number") args.push("allow_inf_nan=False");
  if (typeof node.minimum === "number") args.push(`ge=${num(node.minimum)}`);
  if (typeof node.exclusiveMinimum === "number") args.push(`gt=${num(node.exclusiveMinimum)}`);
  if (typeof node.maximum === "number") args.push(`le=${num(node.maximum)}`);
  if (typeof node.exclusiveMaximum === "number") args.push(`lt=${num(node.exclusiveMaximum)}`);
  if (typeof node.minLength === "number") args.push(`min_length=${num(node.minLength)}`);
  if (typeof node.maxLength === "number") args.push(`max_length=${num(node.maxLength)}`);
  if (typeof node.minItems === "number") args.push(`min_length=${num(node.minItems)}`);
  if (typeof node.maxItems === "number") args.push(`max_length=${num(node.maxItems)}`);
  return args;
}

/**
 * A `pattern=` argument as one or more source lines. Long patterns become an implicitly
 * concatenated raw string, split only at the seams `expandEcmaClasses` recorded. With the trailing
 * comma the whole `Field(...)` call is stable under `ruff format`, which is what keeps the
 * formatter and `codegen-drift.spec` from fighting each other forever.
 */
function pyPatternLines(arg: string, indent: string): string[] {
  if (`${indent}${arg},`.length <= PY_LINE_LENGTH) return [arg];
  const m = /^pattern=r"(.*)"$/s.exec(arg);
  const parts = m ? PATTERN_PARTS.get(m[1] as string) : undefined;
  if (!parts) return [arg];
  return parts.map((p, i) => (i === 0 ? `pattern=r"${p}"` : `r"${p}"`));
}

/**
 * One model field. `name: Annotation = Field(a, b)` when it fits, otherwise the exploded form with
 * a magic trailing comma (which is what stops `ruff format` from joining it back into a line
 * `ruff check` then rejects for length).
 */
function pyFieldLine(name: string, annotation: string, args: string[], defaultNone: boolean): string {
  const tail = args.length > 0 ? ` = Field(${args.join(", ")})` : defaultNone ? " = None" : "";
  const oneLine = `    ${name}: ${annotation}${tail}`;
  if (oneLine.length <= PY_LINE_LENGTH || args.length === 0) return `${oneLine}\n`;
  const lines = args.flatMap((a) => pyPatternLines(a, "        "));
  // A line is followed by a comma unless the NEXT line continues the same implicit concatenation.
  const body = lines
    .map((l, i) => `        ${l}${lines[i + 1]?.startsWith('r"') ? "" : ","}\n`)
    .join("");
  return `    ${name}: ${annotation} = Field(\n${body}    )\n`;
}

function pyAnnotate(base: string, args: string[], extra: string[] = []): string {
  const pieces = [...(args.length ? [`Field(${args.join(", ")})`] : []), ...extra];
  return pieces.length === 0 ? base : `Annotated[${base}, ${pieces.join(", ")}]`;
}

/**
 * `Name = <long expression>` wrapped across lines when it exceeds the Python line length, in the
 * shape the formatter already produces, so the generated file is both lint-clean and stable under
 * `ruff format` (a formatter that wants to rewrite generated output would fight the drift test).
 */
function pyWrapAssignment(name: string, expr: string): string {
  if (`${name} = ${expr}`.length <= PY_LINE_LENGTH) return expr;
  const inner = /^(Literal|Annotated)\[(.*)\]$/s.exec(expr);
  if (!inner) return expr;
  const [, head, body] = inner as unknown as [string, string, string];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "[" || ch === "(") depth += 1;
    if (ch === "]" || ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return `${head}[\n${parts.map((p) => `    ${p},\n`).join("")}]`;
}

function pyType(node: JsonSchema, owner: string, prop?: string): string {
  if (isRef(node)) return refName(node.$ref);
  const nullable = nullableInner(node);
  if (nullable) return `${pyType(nullable, owner, prop)} | None`;
  if (Array.isArray(node.oneOf)) {
    return (node.oneOf as JsonSchema[]).map((n) => pyType(n, owner, prop)).join(" | ");
  }
  if ("const" in node) return `Literal[${JSON.stringify(node.const)}]`;
  if (Array.isArray(node.enum)) {
    const values = node.enum as unknown[];
    if (values.every((v) => typeof v === "string")) {
      return `Literal[${values.map((v) => q(v as string)).join(", ")}]`;
    }
    // `Literal[0, 90, ...]` would accept `False`, because `False == 0` in Python and ajv rejects
    // it. An `int` annotation under strict mode rejects bool, so the membership test moves into
    // an AfterValidator. `JsonInt`, not `int`, so `rotation: 90.0` behaves as JSON Schema says.
    return pyAnnotate("JsonInt", [], [`AfterValidator(_one_of((${values.map((v) => num(v)).join(", ")})))`]);
  }
  const tuple = tupleItems(node);
  if (tuple) {
    const same = homogeneousTuple(tuple);
    if (!same) throw new Error(`${owner}.${prop ?? ""}: heterogeneous tuples are not supported`);
    const inner = pyAnnotate(pyType(same, owner, prop), pyFieldArgs(same));
    return pyAnnotate(`list[${inner}]`, [
      `min_length=${num(node.minItems)}`,
      `max_length=${num(node.maxItems)}`,
    ]);
  }
  switch (node.type) {
    case "string": {
      if (node.format === "date-time") return `Annotated[JsonText, AfterValidator(_date_time)]`;
      return "JsonText";
    }
    case "integer":
      return "JsonInt";
    case "number":
      return "float";
    case "boolean":
      return "bool";
    case "null":
      return "None";
    case "array": {
      const items = node.items as JsonSchema | undefined;
      if (!items) throw new Error("array without items");
      const inner = pyAnnotate(pyType(items, owner, prop), pyFieldArgs(items));
      return `list[${inner}]`;
    }
    case "object":
      return "dict[str, Any]";
    default:
      if (isAnySchema(node)) return "Any";
      throw new Error(`unsupported node: ${JSON.stringify(node).slice(0, 120)}`);
  }
}

function pyPropField(owner: string, prop: string, node: JsonSchema): PyField {
  const annotation = pyType(node, owner, prop);
  // Constraints already folded into the annotation by pyType (tuples, enums) must not be
  // re-applied; only leaf constraints are emitted here.
  const args = tupleItems(node) || Array.isArray(node.enum) ? [] : pyFieldArgs(node);
  return { annotation, args };
}

function emitPyModel(name: string, def: JsonSchema): string {
  if (def.additionalProperties !== false) {
    throw new Error(`${name}: object $def without additionalProperties:false — refusing to emit`);
  }
  const props = (def.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((def.required as string[] | undefined) ?? []);
  const nonNullableOptional = Object.keys(props).filter(
    (p) => !required.has(p) && !nullableInner(props[p] as JsonSchema),
  );
  let out = `class ${name}(_Model):\n`;
  out += pyDoc(def.description as string | undefined, "    ");
  if (nonNullableOptional.length > 0) {
    // D11: an optional field is NEVER nullable. Pydantic cannot distinguish "absent" from
    // "explicitly null" once a default of None exists, so explicit nulls are rejected up front.
    out += `\n    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset(\n`;
    out += `        {\n${nonNullableOptional.map((p) => `            ${q(p)},\n`).join("")}        }\n    )\n`;
  }
  out += `\n`;
  for (const [prop, node] of Object.entries(props)) {
    const f = pyPropField(name, prop, node);
    const isRequired = required.has(prop);
    const annotation = isRequired ? f.annotation : `${f.annotation} | None`;
    const args = [...f.args];
    if (!isRequired) args.unshift("default=None");
    if (pyName(prop) !== prop) args.unshift(`alias=${q(prop)}`);
    out += pyFieldDoc(node.description as string | undefined, "    ");
    out += pyFieldLine(pyName(prop), annotation, args, !isRequired);
  }
  const branches = analyseBranches(def);
  if (branches.length > 0) out += emitPyBranches(branches);
  return `${out}\n\n`;
}

/**
 * `raise ValueError(f"<message>{self.<prop>!r}")`. The message ends with the offending value
 * rather than restating the branch's whole enum: it is shorter than the line limit and it tells
 * the reader which value actually tripped the rule.
 */
function pyRaise(indent: string, message: string, prop: string): string {
  const literal = `f${q(`${message}{self.${prop}!r}`)}`;
  const oneLine = `${indent}raise ValueError(${literal})`;
  if (oneLine.length <= PY_LINE_LENGTH) return oneLine;
  return `${indent}raise ValueError(\n${indent}    ${literal}\n${indent})`;
}

function emitPyBranches(branches: Branch[]): string {
  let out = `\n    @model_validator(mode="after")\n    def _check_conditional_branches(self) -> Self:\n`;
  out += `        """The schema's \`allOf\`/\`if\`/\`then\` branches.\n\n`;
  out += `        A model validator rather than a discriminated union, because the discriminator is an\n`;
  out += `        OPEN string (DESIGN.md §6): a tagged union would have to enumerate it and would then\n`;
  out += `        reject the unknown types that forward compatibility requires to validate.\n`;
  out += `        """\n`;
  const parts: string[] = [];
  for (const b of branches) {
    const values = b.match.kind === "const" ? [b.match.value] : b.match.values;
    const prop = pyName(b.prop);
    const test =
      b.match.kind === "const"
        ? `self.${prop} == ${q(b.match.value)}`
        : b.match.kind === "enum"
          ? `self.${prop} in (${values.map((v) => q(v)).join(", ")})`
          : `self.${prop} not in (${values.map((v) => q(v)).join(", ")})`;
    const body: string[] = [];
    for (const req of b.required) {
      body.push(
        `            if self.${pyName(req)} is None:\n` +
          pyRaise("                ", `${req} is required for ${b.prop}=`, prop),
      );
    }
    for (const [p, v] of b.propConst) {
      const lit = typeof v === "boolean" ? (v ? "True" : "False") : JSON.stringify(v);
      const cmp =
        typeof v === "boolean" ? `self.${pyName(p)} is not ${lit}` : `self.${pyName(p)} != ${lit}`;
      body.push(
        `            if ${cmp}:\n` +
          pyRaise("                ", `${p} must be ${String(v)} for ${b.prop}=`, prop),
      );
    }
    for (const p of b.propForbidden) {
      body.push(
        `            if self.${pyName(p)} is not None:\n` +
          pyRaise("                ", `${p} is forbidden for ${b.prop}=`, prop),
      );
    }
    for (const [p, target] of b.propRef) {
      body.push(
        `            if self.${pyName(p)} is not None:\n` +
          `                ${pyValidateCall(target, `self.${pyName(p)}`)}`,
      );
    }
    if (body.length === 0) continue;
    parts.push(`        if ${test}:\n${body.join("\n")}`);
  }
  out += `${parts.join("\n")}\n        return self\n`;
  return out;
}

function emitPython(file: SchemaFile): string {
  const forbidden = Object.keys(
    (((file.defs.ModelFreeSubtree?.allOf as JsonSchema[] | undefined)?.[0]?.then as JsonSchema)
      ?.properties ?? {}) as Record<string, unknown>,
  );
  const opaque = file.defs.OpaquePayload as JsonSchema | undefined;
  let out = `"""\n${banner(file, "Pydantic")}\n"""\n\n`;
  out += `# ruff: noqa: SIM102 - each nested \`if\` is one schema \`if\`/\`then\` branch, kept one-for-one\n`;
  out += `# with the construct it encodes; collapsing them would decouple the two.\n\n`;
  out += `from __future__ import annotations\n\n`;
  out += `import re\n`;
  out += `from collections.abc import Callable\n`;
  out += `from enum import StrEnum\n`;
  const hasBranches = file.order.some((n) => analyseBranches(file.defs[n] as JsonSchema).length > 0);
  out += `from typing import Annotated, Any, ClassVar, Literal${hasBranches ? ", Self" : ""}\n\n`;
  out += `from pydantic import (\n`;
  out += `    AfterValidator,\n    BaseModel,\n    BeforeValidator,\n    ConfigDict,\n    Field,\n    model_validator,\n)\n\n`;
  out += PY_PRELUDE;
  if (forbidden.length > 0) out += pyModelFree(file, forbidden);
  if (opaque) out += pyOpaquePayload(opaque);

  for (const name of file.order) {
    const def = file.defs[name] as JsonSchema;
    if (DOC_ONLY_VOCABULARIES.has(name)) {
      out += pyVocabulary(name, def);
      continue;
    }
    if (name === "ModelFreeSubtree" || name === "OpaquePayload") continue;
    if (def.type === "object" && def.properties) {
      out += emitPyModel(name, def);
      continue;
    }
    out += pyDoc(def.description as string | undefined, "");
    // `pyType` already folds a tuple's or an enum's constraints into the annotation; re-applying
    // them here produced a nested `Annotated[Annotated[...]]` that was correct but unreadable.
    const folded = tupleItems(def) !== undefined || Array.isArray(def.enum);
    out += `${name} = ${pyWrapAssignment(name, pyAnnotate(pyType(def, name), folded ? [] : pyFieldArgs(def)))}\n\n\n`;
  }
  out += `#: The root of ${file.path}.\n`;
  out += `${file.rootDef}Root = ${file.rootDef}\n`;
  return out;
}

function pyVocabulary(name: string, def: JsonSchema): string {
  const values = def.enum as string[];
  let out = `class ${name}(StrEnum):\n`;
  out += pyDoc(def.description as string | undefined, "    ");
  out += `\n`;
  for (const v of values) out += `    ${v.toUpperCase()} = ${q(v)}\n`;
  out += `\n\n`;
  const setName = `${snake(name).toUpperCase()}S`;
  const oneLine = `${setName}: frozenset[str] = frozenset(member.value for member in ${name})`;
  out +=
    oneLine.length <= PY_LINE_LENGTH
      ? `${oneLine}\n\n\n`
      : `${setName}: frozenset[str] = frozenset(\n    member.value for member in ${name}\n)\n\n\n`;
  out += `def is_${snake(name)}(value: str) -> bool:\n`;
  out += `    """True when 'value' is in the documented vocabulary. NOT a validation constraint."""\n`;
  out += `    return value in ${setName}\n\n\n`;
  const alias = name.replace(/^Known/, "");
  if (OPEN_VOCABULARY_ALIASES.has(name)) {
    out += `#: The OPEN type. Any identifier-shaped string validates; unknown values are legal by\n`;
    out += `#: design (DESIGN.md D2), so this is 'str' and the enum above is documentation only.\n`;
    out += `${alias} = str\n\n\n`;
  }
  return out;
}

const PY_PRELUDE = `\ndef _json_integer(value: Any) -> Any:
    """JSON Schema 'integer' matches any NUMBER with a zero fractional part.

    'json.loads' hands '1.0', '1e0' and '10e-1' to Python as 'float', and strict Pydantic
    refuses to fill an 'int' from a float - so every non-JS producer (a Go 'float64', a numpy
    pipeline, 'json.dumps' of a computed year) emitted documents ajv blessed and this binding
    rejected. Converting here restores the JSON Schema meaning. 'bool' is passed through
    UNCHANGED so strict mode still rejects it: 'False == 0' in Python, ajv rejects it, and a
    conversion here would have quietly reopened that trap.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


#: JSON Schema '"type": "integer"'. See '_json_integer'.
JsonInt = Annotated[int, BeforeValidator(_json_integer)]


_LONE_SURROGATE = re.compile("[\\ud800-\\udfff]")


def _well_formed(value: str) -> str:
    """Unpaired-surrogate guard, applied to EVERY string in this binding.

    'json.loads' and ajv both accept a lone surrogate; it is not UTF-8-encodable, so such a
    document cannot survive the serialisation round-trip '$defs/Point' names as a precondition.
    pydantic-core already rejected it in every string carrying 'pattern' or 'min_length' while
    silently accepting it in an unconstrained one - an inconsistency inside ONE binding. Both
    generated bindings now reject it everywhere. Deliberate divergence from ajv: DESIGN.md §12.5.

    A surrogate PAIR in JSON text is decoded by 'json.loads' into one astral character, so any
    surrogate still present in a Python 'str' is by construction unpaired.
    """
    if _LONE_SURROGATE.search(value) is not None:
        raise ValueError(${q(WELL_FORMED_MESSAGE)})
    return value


#: Every schema string. See '_well_formed'.
JsonText = Annotated[str, AfterValidator(_well_formed)]


#: See codegen/generate.ts 'MAX_PAYLOAD_DEPTH'; the TypeScript twin carries the same number.
MAX_PAYLOAD_DEPTH = ${MAX_PAYLOAD_DEPTH}


def find_excessive_depth(value: Any) -> tuple[str | int, ...] | None:
    """The path at which 'value' first nests deeper than MAX_PAYLOAD_DEPTH, or None.

    Iterative on purpose: a guard against unbounded recursion that is itself recursive raises
    RecursionError on exactly the input it exists to reject.
    """
    stack: list[tuple[Any, tuple[str | int, ...]]] = [(value, ())]
    while stack:
        node, path = stack.pop()
        if not isinstance(node, (dict, list)):
            continue
        if len(path) > MAX_PAYLOAD_DEPTH:
            return path
        if isinstance(node, list):
            stack.extend((child, (*path, index)) for index, child in enumerate(node))
            continue
        stack.extend((child, (*path, key)) for key, child in node.items())
    return None


def _one_of(allowed: tuple[int, ...]) -> Callable[[int], int]:
    """Membership test for an integer enum.

    'Literal[0, 90, 180, 270]' would accept 'False' ('False == 0' in Python) where ajv
    rejects it, so integer enums are an 'int' annotation — which strict mode refuses to fill
    from a bool — plus this check.
    """

    def check(value: int) -> int:
        if value not in allowed:
            raise ValueError(f"must be one of {allowed}")
        return value

    return check


_DATE_RE = re.compile(r"^(\\d\\d\\d\\d)-(\\d\\d)-(\\d\\d)\\Z")
_TIME_RE = re.compile(r"^(\\d\\d):(\\d\\d):(\\d\\d(?:\\.\\d+)?)(z|([+-])(\\d\\d)(?::?(\\d\\d))?)\\Z", re.I)
_DAYS_IN_MONTH = (0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _is_date(value: str) -> bool:
    m = _DATE_RE.match(value)
    if m is None:
        return False
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if month < 1 or month > 12:
        return False
    leap = month == 2 and year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
    return 1 <= day <= _DAYS_IN_MONTH[month] + (1 if leap else 0)


def _is_time(value: str) -> bool:
    m = _TIME_RE.match(value)
    if m is None:
        return False
    hour, minute, second = int(m.group(1)), int(m.group(2)), float(m.group(3))
    sign = -1 if m.group(5) == "-" else 1
    tz_hour = int(m.group(6) or 0)
    tz_minute = int(m.group(7) or 0)
    if tz_hour > 23 or tz_minute > 59:
        return False
    if hour <= 23 and minute <= 59 and second < 60:
        return True
    utc_minute = minute - tz_minute * sign
    utc_hour = hour - tz_hour * sign - (1 if utc_minute < 0 else 0)
    return utc_hour in (23, -1) and utc_minute in (59, -1) and second < 61


def _date_time(value: str) -> str:
    """'format: "date-time"', ported from ajv-formats so both languages agree."""
    parts = re.split(r"[tT ]", value, maxsplit=1)
    if len(parts) != 2 or not _is_date(parts[0]) or not _is_time(parts[1]):
        raise ValueError('must match format "date-time"')
    return value


class _Model(BaseModel):
    """Base of every generated model.

    'extra="forbid"' is the Pydantic spelling of the schema's 'additionalProperties: false',
    which is the constraint that makes an AI-authored field unrepresentable (DESIGN.md §2.1).
    'strict=True' is what stops Pydantic's lax coercion from accepting documents ajv rejects:
    without it '"612"' becomes '612.0' and the two validators disagree.
    """

    model_config = ConfigDict(extra="forbid", strict=True)

    #: Optional fields are NEVER nullable (DESIGN.md D11). Pydantic cannot distinguish an absent
    #: key from an explicit 'null' once the default is 'None', so explicit nulls are rejected.
    NON_NULLABLE_OPTIONAL: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode="before")
    @classmethod
    def _reject_explicit_null(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in cls.NON_NULLABLE_OPTIONAL:
                if key in data and data[key] is None:
                    raise ValueError(f"{key} is optional but never nullable; omit it instead")
        return data


`;

function pyModelFree(file: SchemaFile, forbidden: string[]): string {
  const def = file.defs.ModelFreeSubtree as JsonSchema;
  let out = `MODEL_AUTHORSHIP_KEYS: frozenset[str] = frozenset(\n`;
  out += `    {${forbidden.map((k) => q(k)).join(", ")}}\n)\n\n\n`;
  out += `def find_model_declaration(\n    value: Any, path: tuple[str | int, ...] = ()\n) -> tuple[str | int, ...] | None:\n`;
  out += pyDoc(
    `${def.description as string}\n\nReturns the path of the first model-authorship declaration, or None. A recursive constraint\ncannot be a type in either language, so it is a runtime guard in both (DESIGN.md §6).\n\nThe descent stops at MAX_PAYLOAD_DEPTH so this guard cannot itself raise RecursionError. That\nis not a hole: every caller rejects an over-deep value outright before searching it, so the\ntruncated levels are levels no valid document has.`,
    "    ",
  );
  out += `    if len(path) > MAX_PAYLOAD_DEPTH:\n        return None\n`;
  out += `    if isinstance(value, list):\n`;
  out += `        for index, child in enumerate(value):\n`;
  out += `            hit = find_model_declaration(child, (*path, index))\n`;
  out += `            if hit is not None:\n`;
  out += `                return hit\n`;
  out += `        return None\n`;
  out += `    if isinstance(value, dict):\n`;
  out += `        for key, child in value.items():\n`;
  out += `            if key in MODEL_AUTHORSHIP_KEYS:\n`;
  out += `                return (*path, key)\n`;
  out += `            hit = find_model_declaration(child, (*path, key))\n`;
  out += `            if hit is not None:\n`;
  out += `                return hit\n`;
  out += `    return None\n\n\n`;
  out += `def assert_model_free(value: Any) -> None:\n`;
  out += `    """Raise if 'value' is over-deep or declares model authorship in its subtree."""\n`;
  out += `    too_deep = find_excessive_depth(value)\n`;
  out += `    if too_deep is not None:\n`;
  out += `        raise ValueError(\n`;
  out += `            ${q(DEPTH_MESSAGE)} + f" at {'.'.join(str(p) for p in too_deep)}"\n`;
  out += `        )\n`;
  out += `    hit = find_model_declaration(value)\n`;
  out += `    if hit is not None:\n`;
  out += `        raise ValueError(f"model-authorship declaration at {'.'.join(str(p) for p in hit)}")\n\n\n`;
  return out;
}

function pyOpaquePayload(def: JsonSchema): string {
  const pattern = (def.propertyNames as JsonSchema).pattern as string;
  let out = `_OPAQUE_KEY_RE = re.compile(${pyRegexLiteral(ecmaToPython(pattern))})\n\n\n`;
  out += `def validate_opaque_payload(value: dict[str, Any]) -> dict[str, Any]:\n`;
  out += pyDoc(def.description as string | undefined, "    ");
  out += `    too_deep = find_excessive_depth(value)\n`;
  out += `    if too_deep is not None:\n`;
  out += `        raise ValueError(\n`;
  out += `            ${q(DEPTH_MESSAGE)} + f" at {'.'.join(str(p) for p in too_deep)}"\n`;
  out += `        )\n`;
  out += `    for key in value:\n`;
  out += `        if _OPAQUE_KEY_RE.match(key) is None:\n`;
  out += `            raise ValueError(f"payload key {key!r} must match " + _OPAQUE_KEY_RE.pattern)\n`;
  out += `    assert_model_free(value)\n`;
  out += `    return value\n\n\n`;
  out += `OpaquePayload = Annotated[dict[str, Any], AfterValidator(validate_opaque_payload)]\n\n\n`;
  return out;
}

/**
 * ECMA-262 `$` means end-of-input; Python's `$` also matches before a trailing newline, so
 * `"equation\n"` would pass a pattern ajv rejects. Only used where the generator drives `re`
 * itself — Pydantic's `Field(pattern=...)` uses the Rust regex engine, whose `$` is already
 * end-of-haystack.
 */
function ecmaToPython(pattern: string): string {
  return pattern.replace(/(?<!\\)\$$/, "\\Z");
}

// ---------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------

const PY_INIT = `"""Generated bindings. DO NOT EDIT — see codegen/generate.ts."""
`;

export function generate(): Map<string, string> {
  const paperir = loadSchema("paperir", "schema/paperir-1.0.0.schema.json");
  const derivation = loadSchema("derivation", "schema/derivation-1.0.0.schema.json");
  for (const file of [paperir, derivation]) checkOpenVocabularies(file);

  const out = new Map<string, string>();
  out.set("src/generated/types.ts", emitTsTypes(paperir));
  out.set("src/generated/zod.ts", emitZod(paperir));
  out.set("src/generated/derivation.types.ts", emitTsTypes(derivation));
  out.set("src/generated/derivation.zod.ts", emitZod(derivation));
  out.set("python/papertree_document_ir/generated/__init__.py", PY_INIT);
  out.set("python/papertree_document_ir/generated/models.py", emitPython(paperir));
  out.set("python/papertree_document_ir/generated/derivation_models.py", emitPython(derivation));

  // LF endings, exactly one trailing newline, no BOM — the drift test compares bytes.
  for (const [path, text] of out) {
    out.set(path, `${text.replace(/\r\n/g, "\n").replace(/\n+$/, "")}\n`);
  }
  return out;
}

export function writeGenerated(root: string): string[] {
  const written: string[] = [];
  for (const [rel, text] of generate()) {
    const target = join(root, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, "utf8");
    written.push(rel);
  }
  return written;
}

const entry = process.argv[1];
if (entry && resolve(entry) === resolve(fileURLToPath(import.meta.url))) {
  const outRootFlag = process.argv.indexOf("--out");
  const root = outRootFlag >= 0 ? (process.argv[outRootFlag + 1] as string) : PKG;
  const files = writeGenerated(root);
  process.stdout.write(`codegen: wrote ${files.length} files\n${files.map((f) => `  ${f}`).join("\n")}\n`);
}
