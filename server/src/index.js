import http from 'node:http';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';
import { createSocketServer } from './socket/index.js';
import { startCleanupJob } from './jobs/cleanup.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDB();
  const app = createApp();
  const server = http.createServer(app);
  const io = await createSocketServer(server);
  startCleanupJob();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use. Stop the other process or change PORT in server/.env`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(env.PORT, '0.0.0.0', () => {
    logger.info('Server listening', { port: env.PORT, env: env.NODE_ENV, origins: env.CLIENT_URLS.join(',') });
    logger.info('Features', {
      gifs: env.GIPHY_API_KEY ? 'on' : 'off (GIPHY_API_KEY not set)',
      email: env.SMTP_HOST ? 'on' : 'off (reset links printed to console in dev)',
      redis: env.REDIS_URL ? 'on' : 'off (single instance)',
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    io.close();
    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
      logger.info('Shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { err: String(reason?.message || reason), stack: reason?.stack });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, exiting', { err: err.message, stack: err.stack });
  process.exit(1);
});

main().catch((err) => {
  logger.error('Failed to start server', { err: err.message, stack: err.stack });
  process.exit(1);
});
