import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const requireFromApp = createRequire(resolve(evalsDir, '../app/package.json'));
const Ajv2020 = requireFromApp('ajv/dist/2020').default;
const schema = JSON.parse(readFileSync(resolve(evalsDir, 'receipt.schema.json'), 'utf8'));
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictRequired: false,
  strictTypes: false,
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

export function validateReceiptSchema(receipt) {
  if (validate(receipt)) return [];
  return (validate.errors ?? []).map((error) => {
    const location = error.instancePath || '/';
    return `JSON Schema ${location} ${error.message}`;
  });
}
