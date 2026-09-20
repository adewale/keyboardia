#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

// Wrangler does not remove obsolete content-addressed modules from --outdir.
// Leaving them in place makes the bundle ratchet measure prior builds as well
// as the current one, so always start the disposable dry-run directory clean.
const bundleDirectory = resolve('.wrangler/worker-check');
rmSync(bundleDirectory, { recursive: true, force: true });
