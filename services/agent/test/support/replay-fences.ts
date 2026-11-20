/**
 * Offline replay of a round's fences through the agent's validate + repair path, no model call:
 *
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     test/support/replay-fences.ts <fences.jsonl>      (each line has a `mermaid` field)
 *
 * Prints, for the whole file: how many fences parse as written, after the cosmetics, and after the
 * deterministic repairs (parse only, caps ignored); then the figure step's own outcome per path
 * (caps on, no model repair: an over-cap fence is `kept-over-cap`, which a live run would first send to the model to simplify).
 */
import { readFileSync } from 'node:fs';

import { settleFigure } from '../../src/figure.ts';
import { mermaidParser } from '../../src/mermaid-parse.ts';
import { figureLimits, repairMermaid, tidyMermaidText } from '../../src/mermaid-repair.ts';

const file = process.argv[2];
if (file === undefined) throw new Error('usage: replay-fences.ts <fences.jsonl>');
const fences = readFileSync(file, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => (JSON.parse(line) as { mermaid?: string }).mermaid)
  .filter((body): body is string => typeof body === 'string' && body !== '');

const ok = async (body: string): Promise<boolean> =>
  (await mermaidParser.parse(body)).status === 'ok';
let raw = 0;
let tidy = 0;
let repaired = 0;
let overCap = 0;
const paths: Record<string, number> = {};
for (const body of fences) {
  if (await ok(body)) raw++;
  const t = tidyMermaidText(body).body;
  const parsesTidy = await ok(t);
  if (parsesTidy) tidy++;
  const final = parsesTidy ? t : repairMermaid(t).body;
  if (parsesTidy || (await ok(final))) repaired++;
  if (figureLimits(final).length > 0) overCap++;
  const out = await settleFigure(`## How it works\n\`\`\`mermaid\n${body}\n\`\`\`\n`, false, true, {
    parse: (b) => mermaidParser.parse(b),
  });
  paths[out.path] = (paths[out.path] ?? 0) + 1;
}
console.log(`fences: ${String(fences.length)}`);
console.log(`parse as written:               ${String(raw)}`);
console.log(`parse after cosmetics:          ${String(tidy)}`);
console.log(`parse after deterministic fix:  ${String(repaired)}`);
console.log(
  `of those, over a size cap:      ${String(overCap)} (a live run asks the model to simplify)`,
);
console.log('figure step, no model:', paths);
await mermaidParser.close();
