'use strict';

// Pure CJS, no deps, no modern syntax. Runs on Node 0.10+ so the version-gate
// itself never crashes on old Node. Avoid `??`, `?.`, template tags, etc.
// Source of truth — both scripts/preinstall.cjs and dist/bin/blazedocs.cjs
// require this file.

var REQUIRED_MAJOR = 18;

function parseMajor(versionString) {
  if (!versionString) return 0;
  var trimmed = String(versionString).replace(/^v/, '');
  var major = parseInt(trimmed.split('.')[0], 10);
  return isNaN(major) ? 0 : major;
}

function checkNodeVersion(currentVersion) {
  var current = currentVersion || process.versions.node;
  var major = parseMajor(current);
  var ok = major >= REQUIRED_MAJOR;
  var message = null;
  if (!ok) {
    message =
      'BlazeDocs CLI requires Node.js ' + REQUIRED_MAJOR + ' or later.\n' +
      'Detected Node.js v' + current + '.\n' +
      'Upgrade Node.js (https://nodejs.org/), then run: npm install -g blazedocs@latest';
  }
  return { ok: ok, current: current, required: REQUIRED_MAJOR, message: message };
}

module.exports = {
  checkNodeVersion: checkNodeVersion,
  parseMajor: parseMajor,
  REQUIRED_MAJOR: REQUIRED_MAJOR
};
