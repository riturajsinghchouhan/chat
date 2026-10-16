// Structured logger.
// - production (or LOG_FORMAT=json): one JSON object per line, easy for Render/PM2/log tools to parse
// - development: short colored lines, easy to read in the terminal
// Never pass passwords, tokens, cookies or message text in `meta`.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const isTest = process.env.NODE_ENV === 'test';
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? (isTest ? LEVELS.warn : LEVELS.info);
const pretty = (process.env.LOG_FORMAT || (process.env.NODE_ENV === 'production' ? 'json' : 'pretty')) === 'pretty';

const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

function formatPretty(level, msg, meta) {
  const time = new Date().toTimeString().slice(0, 8);
  const fields = Object.entries(meta)
    .filter(([k, v]) => v !== undefined && k !== 'stack')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ');
  let line = `${DIM}${time}${RESET} ${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET} ${msg}${fields ? ` ${DIM}${fields}${RESET}` : ''}`;
  if (meta.stack) line += `\n${DIM}${meta.stack}${RESET}`;
  return line;
}

function write(level, msg, meta = {}) {
  if (LEVELS[level] < minLevel) return;
  const line = pretty ? formatPretty(level, msg, meta) : JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (msg, meta) => write('debug', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  error: (msg, meta) => write('error', msg, meta),
};

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const status = res.statusCode;
    const isHealth = req.originalUrl.startsWith('/api/health') && status < 400;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : isHealth ? 'debug' : 'info';
    // originalUrl without the query string so tokens in query params are never logged
    write(level, `${req.method} ${req.originalUrl.split('?')[0]} ${status}`, {
      ms,
      user: req.user?.id,
      ip: status >= 400 ? req.ip : undefined,
    });
  });
  next();
}
