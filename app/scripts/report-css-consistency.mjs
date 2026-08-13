#!/usr/bin/env node

import { collectCssConsistencyMetrics } from './css-consistency-metrics.mjs';

const refIndex = process.argv.indexOf('--ref');
const ref = refIndex === -1 ? undefined : process.argv[refIndex + 1];
console.log(JSON.stringify(collectCssConsistencyMetrics(ref), null, 2));
