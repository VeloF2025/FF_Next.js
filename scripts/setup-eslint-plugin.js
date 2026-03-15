#!/usr/bin/env node
/**
 * Sets up the local ESLint plugin in node_modules.
 * Runs as postinstall to survive npm install.
 */
const fs = require('fs');
const path = require('path');

const pluginDir = path.join(__dirname, '..', 'node_modules', 'eslint-plugin-local');

try {
  fs.mkdirSync(pluginDir, { recursive: true });

  fs.writeFileSync(path.join(pluginDir, 'index.js'), `'use strict';
const path = require('path');
module.exports = {
  rules: {
    'no-silent-catch': require(path.resolve(__dirname, '../../scripts/eslint-rules/no-silent-catch')),
  },
};
`);

  fs.writeFileSync(path.join(pluginDir, 'package.json'),
    JSON.stringify({ name: 'eslint-plugin-local', version: '1.0.0', main: 'index.js' }, null, 2)
  );
} catch (_e) {
  // Non-fatal — lint will still work if plugin was already set up
}
