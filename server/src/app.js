import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { requestLogger } from './utils/logger.js';
import { sanitizeBody } from './middleware/sanitize.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { router } from './routes/index.js';

export const corsOptions = {
  origin(origin, cb) {
    // Same-origin / server-to-server requests have no Origin header.
    if (!origin || env.CLIENT_URLS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
};

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  // Allow the SPA (different origin) to embed avatars/media served by this API.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeBody);
  if (!env.isTest) app.use(requestLogger);

  app.get('/', (_req, res) => res.json({ name: 'pulse-chat-api', status: 'ok' }));
  app.use('/api', apiLimiter, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
