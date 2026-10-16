// Routine housekeeping. Only temporary data is removed — chat history is never touched here.
// Expired sessions and old notifications are removed by MongoDB TTL indexes.
import { User } from '../models/User.js';
import { deleteUnattachedOlderThan } from '../services/storage.js';
import { deleteExpiredUploadSessions } from '../controllers/mediaController.js';
import { logger } from '../utils/logger.js';

const HOUR = 60 * 60 * 1000;

export async function runCleanup() {
  const removedUploads = await deleteUnattachedOlderThan(new Date(Date.now() - 24 * HOUR));
  const abandonedChunkedUploads = await deleteExpiredUploadSessions();
  const resets = await User.updateMany(
    { passwordResetExpires: { $lt: new Date() } },
    { $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } },
  );
  logger.info('Cleanup finished', { removedUploads, abandonedChunkedUploads, clearedResetTokens: resets.modifiedCount });
}

export function startCleanupJob() {
  const timer = setInterval(() => {
    runCleanup().catch((err) => logger.error('Cleanup failed', { err: err.message }));
  }, HOUR);
  timer.unref();
  return timer;
}
