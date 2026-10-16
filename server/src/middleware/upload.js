import multer from 'multer';
import { env } from '../config/env.js';

// Files are kept in memory only long enough to be inspected and streamed into GridFS.
export const uploadSingle = (field = 'file', maxMb = Math.max(env.MAX_FILE_MB, env.MAX_IMAGE_MB)) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 10 },
  }).single(field);
