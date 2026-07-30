// F0.8 fixture validation — argv[2] is the path to packages/document-ir. REQUIRED.
//
// This script has exactly two outcomes and neither of them is a pass that checked nothing:
// it validates EXPECTED_FIXTURES files against the schema, or it exits non-zero. An empty,
// short or absent directory is a FAILURE, not a green tick.
//
// It used to have a third: `resolve(process.argv[2] ?? '.')` sent a missing argument, a
// renamed directory or a typo into a PENDING branch that printed "F0.7 has not landed",
// validated nothing and exited 0 (#26). F0.7 landed in 4d1f67d, so the message was also
// false. A CI edit that dropped the argument would have gone green having checked nothing.
// The escape hatch is gone: argv[2] is mandatory and every path below it is fatal.
//
// ajv/ajv-formats are devDependencies of @papertree/document-ir and are CJS, so they are loaded
// through a require() rooted at that package rather than by bare ESM specifier — this script does
// not live inside the package, and ESM resolves bare specifiers from the SCRIPT's location.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_FIXTURES = 3; // EPIC-00 F0.7: ResNet, Attention, one math-heavy paper.

/** Writes to the job summary when running under Actions, and always to stdout. */
function report(markdown) {
  process.stdout.write(markdown.replace(/^#+ /gm, '').replaceAll('**', '') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
  }
}

/** Every way this script can fail to check anything ends here, non-zero. */
function fatal(headline, detail) {
  console.log(`::error title=Fixture validation::${headline}`);
  report(`### Fixture validation: FAILED\n\n${headline}\n\n${detail}`);
  process.exit(1);
}

const usage =
  'usage: node .github/scripts/validate-fixtures.mjs <path-to-packages/document-ir>';

if (process.argv[2] === undefined || process.argv[2] === '') {
  fatal('no package path given', usage);
}

const PKG = resolve(process.argv[2]);
const FIXTURES = join(PKG, 'fixtures');
const SCHEMA = join(PKG, 'schema/paperir-1.0.0.schema.json');

// A wrong path must not be able to look like a pass. Each of these is checked by name so the
// failure says which one is missing rather than surfacing as an ENOENT stack trace.
if (!existsSync(PKG)) {
  fatal(`no such directory: ${PKG}`, usage);
}
if (!existsSync(FIXTURES)) {
  fatal(
    `${FIXTURES} does not exist`,
    `F0.7 landed the golden fixtures in 4d1f67d; ${EXPECTED_FIXTURES} schema-valid fixtures ` +
      'are required. If this path is wrong, fix the caller — an absent fixtures/ directory ' +
      'is a hard error, not a pending check.',
  );
}
if (!existsSync(SCHEMA)) {
  fatal(`${SCHEMA} does not exist`, `${PKG} does not look like packages/document-ir. ${usage}`);
}

const require = createRequire(pathToFileURL(join(PKG, 'package.json')));
const Ajv2020 = require('ajv/dist/2020.js').default ?? require('ajv/dist/2020.js');
const addFormats = require('ajv-formats').default ?? require('ajv-formats');

const files = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .toSorted();

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(SCHEMA, 'utf8')));

const failures = [];

if (files.length !== EXPECTED_FIXTURES) {
  const found = files.length
    ? `${files.length}: ${files.join(', ')}`
    : '0 (the directory exists but holds no *.json)';
  failures.push(
    `expected exactly ${EXPECTED_FIXTURES} *.json fixtures in packages/document-ir/fixtures/, found ${found}`,
  );
}

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8'));
  } catch (err) {
    console.log(`  FAIL  ${file}`);
    failures.push(`${file}: not valid JSON — ${err.message}`);
    continue;
  }
  if (validate(doc)) {
    console.log(`  ok    ${file}`);
  } else {
    const errors = validate.errors ?? [];
    console.log(`  FAIL  ${file}`);
    failures.push(
      `${file}: ${errors.length} schema violation(s)\n` +
        errors
          .slice(0, 10)
          .map((e) => `        ${e.instancePath || '/'} ${e.message}`)
          .join('\n'),
    );
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.log(`::error title=Fixture validation::${failure.split('\n')[0]}`);
  }
  report(`### Fixture validation: FAILED\n\n\`\`\`\n${failures.join('\n')}\n\`\`\``);
  process.exit(1);
}

report(
  `### Fixture validation: OK\n\nAll ${files.length} fixtures validate against ` +
    '`schema/paperir-1.0.0.schema.json`:\n\n' +
    files.map((name) => `- \`${name}\``).join('\n'),
);
