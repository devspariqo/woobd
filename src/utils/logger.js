/**
 * Minimal levelled logger. Writes structured single-line entries so Hostinger's
 * Runtime Logs stay readable, and avoids pulling in a dependency for this.
 */
'use strict';

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const activeLevel = config.isProd
  ? LEVELS[process.env.LOG_LEVEL] !== undefined
    ? LEVELS[process.env.LOG_LEVEL]
    : LEVELS.info
  : LEVELS.debug;

const COLOURS = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';

function write(level, message, meta) {
  if (LEVELS[level] > activeLevel) return;

  const stamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  let line = `${stamp} ${tag} ${message}`;

  if (meta !== undefined) {
    if (meta instanceof Error) {
      line += ` | ${meta.message}`;
      if (!config.isProd && meta.stack) {
        line += `\n${meta.stack}`;
      }
    } else if (typeof meta === 'object') {
      try {
        line += ` | ${JSON.stringify(meta)}`;
      } catch {
        line += ` | [unserialisable]`;
      }
    } else {
      line += ` | ${meta}`;
    }
  }

  const coloured = config.isProd ? line : `${COLOURS[level] || ''}${line}${RESET}`;
  if (level === 'error') {
    console.error(coloured);
  } else {
    console.log(coloured);
  }
}

module.exports = {
  error: (msg, meta) => write('error', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  debug: (msg, meta) => write('debug', msg, meta),
};
