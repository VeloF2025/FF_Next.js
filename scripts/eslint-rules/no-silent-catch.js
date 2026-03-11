/**
 * ESLint Rule: no-silent-catch
 * 
 * Bans catch blocks that swallow errors without logging.
 * Silent catches hide bugs and make debugging impossible.
 * 
 * Bad:
 *   catch (error) {}
 *   catch (e) { return null; }
 *   catch (err) { return res.status(500).json({ error: 'Failed' }); }
 * 
 * Good:
 *   catch (error) { logger.error('...', { error }); return ... }
 *   catch (error) { console.error('...', error); throw error; }
 */

'use strict';

const LOGGING_METHODS = new Set([
  // logger.*
  'error', 'warn', 'info', 'debug', 'fatal', 'trace',
  // console.*
  'error', 'warn', 'log',
]);

const LOGGING_OBJECTS = new Set(['logger', 'console', 'log']);

/**
 * Recursively check if an AST node or its descendants contain a logging call.
 */
function containsLogging(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'CallExpression') {
    const callee = node.callee;
    if (callee.type === 'MemberExpression') {
      const obj = callee.object;
      const prop = callee.property;
      const objName = obj.name || (obj.object && obj.object.name) || '';
      const propName = prop.name || '';
      if (LOGGING_OBJECTS.has(objName) && LOGGING_METHODS.has(propName)) {
        return true;
      }
    }
  }
  // Recurse through child nodes
  for (const key of Object.keys(node)) {
    if (['type', 'start', 'end', 'loc', 'range', 'parent'].includes(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object' && item.type && containsLogging(item)) return true;
      }
    } else if (child && typeof child === 'object' && child.type) {
      if (containsLogging(child)) return true;
    }
  }
  return false;
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow catch blocks that swallow errors without logging',
      category: 'Best Practices',
      recommended: true,
      url: 'https://github.com/VelocityFibre/FF_Next.js/blob/master/standards/ERROR_HANDLING_TEMPLATE.ts',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowEmptyCatch: { type: 'boolean', default: false },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      silentCatch:
        'Silent catch block: errors must be logged (logger.error/warn or console.error/warn). ' +
        'See standards/ERROR_HANDLING_TEMPLATE.ts for patterns.',
      emptyCatch:
        'Empty catch block: add error logging before returning/throwing. ' +
        'See standards/ERROR_HANDLING_TEMPLATE.ts for patterns.',
    },
  },
  create(context) {
    return {
      CatchClause(node) {
        const body = node.body;
        const statements = body.body || [];

        // 1. Empty catch: catch (e) {}
        if (statements.length === 0) {
          context.report({ node, messageId: 'emptyCatch' });
          return;
        }

        // 2. Non-empty but no logging call anywhere in the block
        if (!containsLogging(body)) {
          context.report({ node, messageId: 'silentCatch' });
        }
      },
    };
  },
};
