// Strips MongoDB operator keys ($gt, $where, ...) and dotted keys from request bodies
// as a defence-in-depth measure against NoSQL injection. Zod schemas are the primary guard.
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.')) continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

export function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = clean(req.body);
  next();
}

export const sanitizeValue = clean;
