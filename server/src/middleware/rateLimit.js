import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req, res, _next, options) =>
    res.status(options.statusCode).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' },
    }),
};

export const apiLimiter = rateLimit({ ...common, windowMs: 60 * 1000, limit: 300 });
export const authLimiter = rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 20 });
export const uploadLimiter = rateLimit({ ...common, windowMs: 60 * 1000, limit: 30 });
// One video is up to ~50 chunk requests; allow a few in parallel plus retries.
export const chunkLimiter = rateLimit({ ...common, windowMs: 60 * 1000, limit: 400 });
