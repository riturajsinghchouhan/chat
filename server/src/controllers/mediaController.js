import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { UploadSession } from '../models/UploadSession.js';
import { env } from '../config/env.js';
import { AppError, badRequest, conflict, notFound, unauthorized } from '../utils/AppError.js';
import { objectId } from '../utils/validate.js';
import { signMediaAccess, verifyMediaAccess } from '../utils/tokens.js';
import {
  deleteChunks,
  detectFile,
  detectVideo,
  finalizeChunkedFile,
  findFile,
  mediaUrl,
  openDownloadStream,
  processImage,
  safeFileName,
  saveBuffer,
  writeChunk,
} from '../services/storage.js';
import { loadConversationForMember } from '../services/conversationService.js';
import { logger } from '../utils/logger.js';

export const schemas = {
  upload: z.object({ conversationId: objectId }),
  idParam: z.object({ mediaId: objectId }),
  get: z.object({
    download: z.enum(['0', '1']).optional(),
    // Signed link (see getMediaLink)
    u: objectId.optional(),
    exp: z.string().regex(/^\d{1,12}$/).optional(),
    sig: z.string().max(100).optional(),
  }),
  initUpload: z.object({
    conversationId: objectId,
    fileName: z.string().trim().min(1).max(200),
    size: z.number().int().positive(),
    duration: z.number().positive(),
    width: z.number().int().positive().max(8192).optional(),
    height: z.number().int().positive().max(8192).optional(),
  }),
  uploadParam: z.object({ uploadId: objectId }),
  chunkParam: z.object({ uploadId: objectId, index: z.coerce.number().int().min(0).max(100000) }),
};

const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_OPEN_UPLOADS = 5;

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
async function assertCanRead(file, userId) {
  const meta = file.metadata || {};
  if (meta.kind === 'avatar') return;
  if (!userId) throw unauthorized();
  if (String(meta.ownerId) === userId) return;
  const convIds = await Conversation.find({ 'members.user': userId }).distinct('_id');
  const allowed = await Message.exists({
    conversationId: { $in: convIds },
    deletedAt: null,
    $or: [{ mediaId: file._id }, { thumbnailId: file._id }],
  });
  if (!allowed) {
    logger.warn('Media access denied', { fileId: String(file._id), userId });
    throw notFound('File not found');
  }
}

/** Parses a single-range "bytes=" header. Returns null (no range), a range, or false (unsatisfiable). */
function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return false;
  let start;
  let end;
  if (!match[1]) {
    // Suffix range: the last N bytes
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return false;
  return { start, end };
}

export async function getMedia(req, res) {
  const file = await findFile(req.params.mediaId);
  if (!file) throw notFound('File not found');
  const meta = file.metadata || {};
  await assertCanRead(file, req.user?.id || verifyMediaAccess(file._id, req.q));

  const contentType = meta.contentType || 'application/octet-stream';
  const inline = /^(image|video)\//.test(contentType) && req.q.download !== '1';
  const name = meta.originalName || file.filename || 'file';
  res.set({
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': meta.kind === 'avatar' ? 'public, max-age=31536000, immutable' : 'private, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
  });

  // Range requests let <video> load and seek in pieces instead of downloading the whole file.
  const range = parseRange(req.headers.range, file.length);
  if (range === false) {
    res.set('Content-Range', `bytes */${file.length}`);
    return res.status(416).end();
  }
  if (range) {
    res.status(206).set({
      'Content-Range': `bytes ${range.start}-${range.end}/${file.length}`,
      'Content-Length': String(range.end - range.start + 1),
    });
  } else {
    res.set('Content-Length', String(file.length));
  }
  if (file.length === 0) return res.end();
  const stream = openDownloadStream(file._id, range || undefined);
  stream.on('error', () => {
    if (!res.headersSent) res.status(404).end();
    else res.destroy();
  });
  stream.pipe(res);
}

/** Issues a short-lived signed URL for media the browser plays directly (videos). */
export async function getMediaLink(req, res) {
  const file = await findFile(req.params.mediaId);
  if (!file) throw notFound('File not found');
  await assertCanRead(file, req.user.id);
  const { u, exp, sig } = signMediaAccess(file._id, req.user.id);
  res.json({ url: `${mediaUrl(file._id)}?u=${u}&exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000) });
}

// ---------------- Resumable chunked uploads (videos) ----------------

const sessionJson = (s) => ({
  uploadId: s._id,
  chunkSize: s.chunkSize,
  totalChunks: s.totalChunks,
  received: [...s.received].sort((a, b) => a - b),
});

async function loadSession(uploadId, userId) {
  const session = await UploadSession.findOne({ _id: uploadId, ownerId: userId });
  if (!session) throw notFound('Upload not found or expired', 'UPLOAD_NOT_FOUND');
  return session;
}

function videoMedia(file) {
  const meta = file.metadata || {};
  return {
    mediaId: file._id,
    type: 'video',
    mediaUrl: mediaUrl(file._id),
    thumbnailUrl: meta.thumbnailId ? mediaUrl(meta.thumbnailId) : null,
    mimeType: meta.contentType,
    fileName: meta.originalName,
    fileSize: file.length,
    width: meta.width ?? null,
    height: meta.height ?? null,
    duration: meta.duration ?? null,
  };
}

export async function initUpload(req, res) {
  const { conversationId, fileName, size, duration, width, height } = req.body;
  await loadConversationForMember(conversationId, req.user.id, { populate: false });
  if (size > env.MAX_VIDEO_MB * 1024 * 1024) throw new AppError(413, `Videos must be ${env.MAX_VIDEO_MB} MB or smaller`, 'FILE_TOO_LARGE');
  // Small tolerance: recorders stop a few frames after the timer fires.
  if (duration > env.MAX_VIDEO_SECONDS + 1) throw badRequest(`Videos can be at most ${env.MAX_VIDEO_SECONDS} seconds long`, 'VIDEO_TOO_LONG');
  const open = await UploadSession.countDocuments({ ownerId: req.user.id, expiresAt: { $gt: new Date() } });
  if (open >= MAX_OPEN_UPLOADS) throw new AppError(429, 'Too many uploads in progress', 'TOO_MANY_UPLOADS');

  const chunkSize = env.UPLOAD_CHUNK_BYTES;
  const session = await UploadSession.create({
    ownerId: req.user.id,
    conversationId,
    fileName,
    size,
    chunkSize,
    totalChunks: Math.ceil(size / chunkSize),
    duration: Math.round(duration * 10) / 10,
    width: width ?? null,
    height: height ?? null,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  logger.info('Chunked upload started', { uploadId: String(session._id), userId: req.user.id, size, chunks: session.totalChunks });
  res.status(201).json(sessionJson(session));
}

export async function getUploadStatus(req, res) {
  res.json(sessionJson(await loadSession(req.params.uploadId, req.user.id)));
}

export async function uploadChunk(req, res) {
  const session = await loadSession(req.params.uploadId, req.user.id);
  const { index } = req.params;
  const data = req.body;
  if (!Buffer.isBuffer(data) || !data.length) throw badRequest('Empty chunk');
  if (index >= session.totalChunks) throw badRequest('Chunk index out of range');
  const expected = index === session.totalChunks - 1 ? session.size - index * session.chunkSize : session.chunkSize;
  if (data.length !== expected) throw badRequest(`Chunk ${index} must be ${expected} bytes`, 'BAD_CHUNK_SIZE');

  const update = { $addToSet: { received: index }, $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } };
  if (index === 0) {
    // The real type is sniffed from the bytes; the client's claim is never trusted.
    const detected = await detectVideo(data);
    if (!detected) {
      logger.warn('Chunked upload rejected: not a video', { uploadId: String(session._id), userId: req.user.id });
      await deleteChunks(session._id);
      await session.deleteOne();
      throw new AppError(415, 'Unsupported video format. Allowed: MP4, WebM, MOV', 'INVALID_FILE_TYPE');
    }
    update.$set.mimeType = detected.mime;
  }
  await writeChunk(session._id, index, data);
  const updated = await UploadSession.findOneAndUpdate({ _id: session._id }, update, { returnDocument: 'after' });
  if (!updated) throw notFound('Upload not found or expired', 'UPLOAD_NOT_FOUND');
  res.json({ index, received: updated.received.length, totalChunks: updated.totalChunks });
}

export async function completeUpload(req, res) {
  const { uploadId } = req.params;
  const session = await UploadSession.findOne({ _id: uploadId, ownerId: req.user.id });
  if (!session) {
    // A retried "complete" after a lost response: the file is already published.
    const file = await findFile(uploadId);
    if (file && String(file.metadata?.ownerId) === req.user.id && file.metadata?.mediaType === 'video') {
      return res.json({ media: videoMedia(file) });
    }
    throw notFound('Upload not found or expired', 'UPLOAD_NOT_FOUND');
  }
  const got = new Set(session.received);
  const complete = Array.from({ length: session.totalChunks }, (_, i) => i).every((i) => got.has(i));
  if (!complete || !session.mimeType) throw conflict('Upload is incomplete', 'UPLOAD_INCOMPLETE');

  const ext = session.mimeType === 'video/quicktime' ? 'mov' : session.mimeType.split('/')[1];
  const originalName = safeFileName(session.fileName, ext);
  const base = { ownerId: session.ownerId, conversationId: session.conversationId, attached: false };

  let thumbnailId = null;
  let { width, height } = session;
  if (req.file) {
    // Optional poster frame captured by the client, re-encoded like any image.
    const detected = await detectFile(req.file.buffer, req.file.originalname);
    if (detected?.kind === 'image') {
      const poster = await processImage(req.file.buffer, detected.mime);
      width ??= poster.width;
      height ??= poster.height;
      thumbnailId = await saveBuffer(poster.thumbnail, {
        filename: `thumb-${originalName}.webp`,
        contentType: 'image/webp',
        metadata: { ...base, kind: 'thumb' },
      });
    }
  }

  try {
    await finalizeChunkedFile(session._id, {
      length: session.size,
      chunkSize: session.chunkSize,
      filename: originalName,
      contentType: session.mimeType,
      metadata: {
        ...base,
        kind: 'message',
        mediaType: 'video',
        originalName,
        width,
        height,
        duration: session.duration,
        thumbnailId,
      },
    });
  } catch (err) {
    if (err?.code !== 11000) throw err; // concurrent "complete": already published
  }
  await session.deleteOne();
  const file = await findFile(session._id);
  logger.info('Chunked upload completed', { fileId: String(session._id), userId: req.user.id, bytes: session.size, mime: session.mimeType });
  res.status(201).json({ media: videoMedia(file) });
}

export async function abortUpload(req, res) {
  const session = await UploadSession.findOneAndDelete({ _id: req.params.uploadId, ownerId: req.user.id });
  if (session) await deleteChunks(session._id);
  res.json({ ok: true });
}

/** Drops chunked uploads that were abandoned before completion. */
export async function deleteExpiredUploadSessions(now = new Date()) {
  const stale = await UploadSession.find({ expiresAt: { $lt: now } }).select('_id').limit(500).lean();
  for (const s of stale) {
    await deleteChunks(s._id);
    await UploadSession.deleteOne({ _id: s._id });
  }
  return stale.length;
}
