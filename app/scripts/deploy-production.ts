#!/usr/bin/env tsx
/**
 * Production deployment script with confirmation gate.
 *
 * Requires user to type "production" to proceed, preventing
 * accidental deployments to the live site.
 */

import { createInterface } from 'readline';
import { execSync } from 'child_process';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log('\n⚠️  PRODUCTION DEPLOYMENT');
console.log('─'.repeat(40));
console.log('Target: keyboardia.dev + www.keyboardia.dev');
console.log('');

rl.question('Type "production" to confirm: ', (answer) => {
  rl.close();

  if (answer.trim().toLowerCase() !== 'production') {
    console.log('\n❌ Deployment cancelled.\n');
    process.exit(1);
  }

  console.log('\n✅ Confirmed. Building and deploying...\n');

  try {
    execSync('npm run build && wrangler deploy --env=""', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
  } catch (_error) {
    console.error('\n❌ Deployment failed.\n');
    process.exit(1);
  }
});
