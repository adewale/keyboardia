#!/usr/bin/env tsx
/** Stage, verify, and only then deploy the same build to production. */

import { execSync } from 'child_process';
import { createInterface } from 'readline';

function confirm(expected: 'staging' | 'production', prompt: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(prompt, (answer) => {
      rl.close();
      if (answer.trim().toLowerCase() === expected) resolve();
      else reject(new Error(`Deployment cancelled before ${expected}.`));
    });
  });
}

function run(command: string): void {
  execSync(command, { stdio: 'inherit', cwd: process.cwd() });
}

async function main(): Promise<void> {
  console.log('\n⚠️  STAGED PRODUCTION DEPLOYMENT');
  console.log('─'.repeat(40));
  console.log('1. Run MCP tests and build.');
  console.log('2. Deploy to staging.keyboardia.dev.');
  console.log('3. Run the staging Agent Skills discovery and MCP smokes.');
  console.log('4. Pause and disclose the verified result.');
  console.log('5. With a second confirmation, deploy to keyboardia.dev and smoke it.\n');

  await confirm('staging', 'Type "staging" to test and mutate staging: ');
  console.log('\nDeploying and verifying staging...\n');
  run('npm run deploy');

  console.log('\n✅ Staging deployment and MCP smoke passed.');
  console.log('The next command mutates the production Worker and then runs its MCP smoke.\n');
  await confirm('production', 'Type "production" to deploy the verified build: ');

  console.log('\nDeploying and verifying production...\n');
  run('wrangler deploy --env=""');
  run('npm run smoke:skills:production');
  run('npm run smoke:mcp:production');
  console.log('\n✅ Production deployment and MCP smoke passed.\n');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
});
