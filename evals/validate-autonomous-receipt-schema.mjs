import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evalsDir = dirname(fileURLToPath(import.meta.url));
// Prefer the evaluator's minimal install. App unit tests import this module
// after installing app/package-lock.json, so they use the identical fallback.
const evalAjv = resolve(evalsDir, 'node_modules/ajv/package.json');
const dependencyPackage = existsSync(evalAjv)
  ? resolve(evalsDir, 'package.json')
  : resolve(evalsDir, '../app/package.json');
const Ajv2020 = createRequire(dependencyPackage)('ajv/dist/2020').default;
const schema = JSON.parse(readFileSync(resolve(evalsDir, 'autonomous-receipt.schema.json'), 'utf8'));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: {
    'date-time': (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
    uri: (value) => {
      try {
        return Boolean(new URL(value));
      } catch {
        return false;
      }
    },
  },
});
const validate = ajv.compile(schema);

export function validateAutonomousReceiptSchema(receipt) {
  if (validate(receipt)) return [];
  return (validate.errors ?? []).map((error) => {
    const location = error.instancePath || '/';
    return `JSON Schema ${location} ${error.message}`;
  });
}
