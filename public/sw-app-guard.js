// public/sw-app-guard.js
// Single source of truth for scope arbitration. Loaded two ways:
//  - sw-app.js: importScripts('/sw-app-guard.js') runs this in the SW global
//    scope, making `isReserved` a global the fetch handler can call.
//  - the unit test: require()s it as a CommonJS module via module.exports.
// Kept as a plain public/ script (not an ES/TS module) because service workers
// cannot `import` from src/ and importScripts needs a classic script.
function isReserved(pathname) {
  const RESERVED_PREFIXES = ['/my', '/stock', '/field-stock', '/fleet'];
  const RESERVED_ASSETS = ['/sw-my.js', '/sw-stock.js', '/sw-fleet.js', '/manifest-my.json'];
  if (RESERVED_ASSETS.includes(pathname)) return true;
  return RESERVED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
// `typeof module` guard: `module` is undefined in the SW scope (a bare
// reference would throw ReferenceError); this exports for the CommonJS test
// without breaking the importScripts path.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isReserved };
}
