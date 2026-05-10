'use strict';

// Runs during `npm install [-g] blazedocs` BEFORE any dependencies are
// extracted. Hard-fails install on unsupported Node so the user never reaches
// the cryptic `commander` SyntaxError on `??`. Belt-and-suspenders alongside
// the bin shim at dist/bin/blazedocs.cjs (which catches --ignore-scripts).
// Pure CJS, Node 0.10+ syntax — see scripts/check-node-version.cjs.

var check = require('./check-node-version.cjs').checkNodeVersion();
if (!check.ok) {
  process.stderr.write(check.message + '\n');
  process.exit(1);
}
