// F0.8 fixture validation — argv[2] is the path to packages/document-ir.
//
// Three outcomes, and only one of them is a pass that checked nothing:
//   fixtures/ absent   -> PENDING. F0.7 has not landed. Warns loudly, validates nothing, exits 0.
//   fixtures/ present  -> asserts EXPECTED_FIXTURES files and validates every one against the
//                         schema. An empty or short directory is a FAILURE, not a green tick.
//
// ajv/ajv-formats are devDependencies of @papertree/document-ir and are CJS, so they are loaded
// through a require() rooted at that package rather than by bare ESM specifier — this script does
// not live inside the package, and ESM resolves bare specifiers from the SCRIPT's location.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_FIXTURES = 3; // EPIC-00 F0.7: ResNet, Attention, one math-heavy paper.
const PKG = resolve(process.argv[2] ?? '.');
const FIXTURES = join(PKG, 'fixtures');

/** Writes to the job summary when running under Actions, and always to stdout. */
function report(markdown) {
  process.stdout.write(markdown.replace(/^#+ /gm, '').replaceAll('**', '') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n');
  }
}

if (!existsSync(FIXTURES)) {
  report(
    '### Fixture validation: PENDING\n\n' +
      '`packages/document-ir/fixtures/` does not exist yet — F0.7 lands it.\n\n' +
      'This check validated **nothing**. It becomes a real gate the moment that directory ' +
      `appears, and then requires exactly ${EXPECTED_FIXTURES} schema-valid fixtures.`,
  );
  console.log(
    '::warning title=Fixture validation pending::' +
      'packages/document-ir/fixtures/ is absent (F0.7 has not landed); 0 fixtures were validated',
  );
  process.exit(0);
}

const require = createRequire(pathToFileURL(join(PKG, 'package.json')));
const Ajv2020 = require('ajv/dist/2020.js').default ?? require('ajv/dist/2020.js');
const addFormats = require('ajv-formats').default ?? require('ajv-formats');

const files = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .toSorted();

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(readFileSync(join(PKG, 'schema/paperir-1.0.0.schema.json'), 'utf8')),
);

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
