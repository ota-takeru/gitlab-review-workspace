#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const resolverPath = path.resolve(__dirname, '..', '..', 'ui-review', 'scripts', 'resolve-profile.js');

if (!fs.existsSync(resolverPath)) {
  process.stdout.write(`${JSON.stringify({ error: `ui-review profile resolver not found: ${resolverPath}` }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  const { runCli } = require(resolverPath);
  runCli();
}
