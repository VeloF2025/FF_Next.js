/**
 * Local ESLint plugin for FibreFlow custom rules.
 * Not published to npm — loaded via node_modules symlink.
 */
'use strict';

module.exports = {
  rules: {
    'no-silent-catch': require('./scripts/eslint-rules/no-silent-catch'),
  },
};
