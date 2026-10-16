import { z } from 'zod';
import { AppError } from './AppError.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/**
 * Validates req.body / req.params / req.query with zod schemas.
 * Validated query lands on req.q (Express 5 makes req.query read-only).
 */
export const validate = (schemas) => (req, _res, next) => {
  for (const key of ['params', 'query', 'body']) {
    const schema = schemas[key];
    if (!schema) continue;
    const result = schema.safeParse(req[key] ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path.join('.');
      throw new AppError(
        400,
        field ? `${field}: ${issue.message}` : issue.message,
        'VALIDATION_ERROR',
        result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    }
    if (key === 'query') req.q = result.data;
    else req[key] = result.data;
  }
  next();
};

/** Validate a socket payload; throws AppError on failure. */
export function parsePayload(schema, payload) {
  const result = schema.safeParse(payload ?? {});
  if (!result.success) {
    throw new AppError(400, result.error.issues[0].message, 'VALIDATION_ERROR');
  }
  return result.data;
}

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
