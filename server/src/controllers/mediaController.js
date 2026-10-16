import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { env } from '../config/env.js';
import { AppError, badRequest, notFound, unauthorized } from '../utils/AppError.js';
import { objectId } from '../utils/validate.js';
import {
  detectFile,
  findFile,
  mediaUrl,
  openDownloadStream,
  processImage,
  safeFileName,
  saveBuffer,
} from '../services/storage.js';
import { loadConversationForMember } from '../services/conversationService.js';
import { logger } from '../utils/logger.js';

export const schemas = {
  upload: z.object({ conversationId: objectId }),
  idParam: z.object({ mediaId: objectId }),
  get: z.object({ download: z.enum(['0', '1']).optional() }),
};

/**
 * Backend-controlled upload: the file is type-sniffed, size-checked, re-encoded (images)
 * and stored in GridFS. The returned mediaId is then referenced by message:send.
 */
export async function uploadMedia(req, res) {
  if (!req.file) throw badRequest('No file uploaded');
  const { conversationId } = req.body;
  await loadConversationForMember(conversationId, req.user.id, { populate: false });

  const detected = await detectFile(req.file.buffer, req.file.originalname);
  if (!detected) {
    logger.warn('Upload rejected: unsupported type', { userId: req.user.id, clientMime: req.file.mimetype, size: req.file.size });
    throw new AppError(415, 'Unsupported file type. Allowed: images, PDF, Office documents, ZIP, TXT, CSV', 'INVALID_FILE_TYPE');
  }
  const limitMb = detected.kind === 'image' ? env.MAX_IMAGE_MB : env.MAX_FILE_MB;
  if (req.file.size > limitMb * 1024 * 1024) {
    logger.warn('Upload rejected: too large', { userId: req.user.id, kind: detected.kind, size: req.file.size });
    throw new AppError(413, `File must be ${limitMb} MB or smaller`, 'FILE_TOO_LARGE');
  }

  const originalName = safeFileName(req.file.originalname, detected.ext);
  const base = { ownerId: req.user.id, conversationId, attached: false };
  let width = null;
  let height = null;
  let thumbnailId = null;
  let buffer = req.file.buffer;

  if (detected.kind === 'image') {
    const processed = await processImage(req.file.buffer, detected.mime);
    buffer = processed.original;
    ({ width, height } = processed);
    thumbnailId = await saveBuffer(processed.thumbnail, {
      filename: `thumb-${originalName}.webp`,
      contentType: 'image/webp',
      metadata: { ...base, kind: 'thumb' },
    });
  }

  const id = await saveBuffer(buffer, {
    filename: originalName,
    contentType: detected.mime,
    metadata: {
      ...base,
      kind: 'message',
      mediaType: detected.kind,
      originalName,
      width,
      height,
      thumbnailId,
    },
  });

  logger.info('File uploaded', {
    fileId: String(id),
    userId: req.user.id,
    conversationId,
    kind: detected.kind,
    mime: detected.mime,
    bytes: buffer.length,
  });
  res.status(201).json({
    media: {
      mediaId: id,
      type: detected.kind,
      mediaUrl: mediaUrl(id),
      thumbnailUrl: thumbnailId ? mediaUrl(thumbnailId) : null,
      mimeType: detected.mime,
      fileName: originalName,
      fileSize: buffer.length,
      width,
      height,
    },
  });
}

/**
 * Streams a stored file. Avatars are public; chat media requires the requester to be
 * the uploader or a member of a conversation containing a message that references it.
 */
export async function getMedia(req, res) {
  const file = await findFile(req.params.mediaId);
  if (!file) throw notFound('File not found');
  const meta = file.metadata || {};

  if (meta.kind !== 'avatar') {
    if (!req.user) throw unauthorized();
    const isOwner = String(meta.ownerId) === req.user.id;
    if (!isOwner) {
      const convIds = await Conversation.find({ 'members.user': req.user.id }).distinct('_id');
      const allowed = await Message.exists({
        conversationId: { $in: convIds },
        deletedAt: null,
        $or: [{ mediaId: file._id }, { thumbnailId: file._id }],
      });
      if (!allowed) {
        logger.warn('Media access denied', { fileId: String(file._id), userId: req.user.id });
        throw notFound('File not found');
      }
    }
  }

  const contentType = meta.contentType || 'application/octet-stream';
  const inline = contentType.startsWith('image/') && req.q.download !== '1';
  const name = meta.originalName || file.filename || 'file';
  res.set({
    'Content-Type': contentType,
    'Content-Length': String(file.length),
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': meta.kind === 'avatar' ? 'public, max-age=31536000, immutable' : 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  const stream = openDownloadStream(file._id);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
    else res.destroy();
  });
  stream.pipe(res);
}
