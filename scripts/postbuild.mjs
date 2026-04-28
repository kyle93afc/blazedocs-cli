import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Emits dist/bin/blazedocs.cjs after `tsc`. The shim is a tiny CJS bootstrap
// that gates on Node version BEFORE the ESM entry (which transitively imports
// commander) is parsed. Single source of truth for the version check is
// scripts/check-node-version.cjs — both the shim and the preinstall hook
// require it.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const shimPath = resolve(root, "dist", "bin", "blazedocs.cjs");

// Pure ES5 + dynamic import(). import() landed in Node 12.17, so anyone on
// Node <12.17 hits a parse error here — but the preinstall hook should have
// caught them already. Worst case: cryptic parse error matches the prior UX.
const SHIM = `#!/usr/bin/env node
'use strict';

var check = require('../../scripts/check-node-version.cjs').checkNodeVersion();
if (!check.ok) {
  process.stderr.write(check.message + '\\n');
  process.exit(1);
}

import('./blazedocs.js').catch(function (err) {
  var msg = (err && err.stack) ? err.stack : String(err);
  process.stderr.write(msg + '\\n');
  process.exit(1);
});
`;

mkdirSync(dirname(shimPath), { recursive: true });
writeFileSync(shimPath, SHIM, "utf8");
try {
  chmodSync(shimPath, 0o755);
} catch {
  // Windows — npm cmd-shim wraps the bin and handles permissions itself.
}
console.log(`postbuild: wrote ${shimPath}`);
