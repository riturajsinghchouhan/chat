// Media storage in MongoDB GridFS (bucket "media").
// GridFS splits files into 255 KB chunks, so it is not limited by the 16 MB BSON document limit.
import path from 'node:path';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { badRequest } from '../utils/AppError.js';

const { ObjectId } = mongoose.Types;

export const IMAGE_MIME = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const FILE_MIME = new Set([
  'application/pdf',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

// Plain-text formats have no magic bytes; accepted only by extension + binary check.
const TEXT_EXT = { '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/markdown' };

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'media' });
const filesCollection = () => mongoose.connection.db.collection('media.files');

export const mediaUrl = (id) => `/api/media/${id}`;
export function idFromMediaUrl(url) {
  const match = /\/api\/media\/([a-f\d]{24})/i.exec(url || '');
  return match ? match[1] : null;
}

/** Detect the real file type from its bytes. Never trusts the client-provided MIME type. */
export async function detectFile(buffer, originalName = '') {
  const ft = await fileTypeFromBuffer(buffer);
  if (ft) {
    if (IMAGE_MIME[ft.mime]) return { kind: 'image', mime: ft.mime, ext: ft.ext };
    if (FILE_MIME.has(ft.mime)) return { kind: 'file', mime: ft.mime, ext: ft.ext };
    return null;
  }
  const ext = path.extname(originalName).toLowerCase();
  if (TEXT_EXT[ext] && !buffer.includes(0)) return { kind: 'file', mime: TEXT_EXT[ext], ext: ext.slice(1) };
  return null;
}

export function safeFileName(name, ext) {
  const base = path
    .basename(String(name || ''))
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 120);
  if (!base) return `file.${ext}`;
  return base.toLowerCase().endsWith(`.${ext}`) || (ext === 'jpg' && /\.jpe?g$/i.test(base)) ? base : `${base}.${ext}`;
}

/**
 * Re-encodes an image (strips EXIF/GPS metadata, fixes orientation, caps resolution)
 * and produces a small WebP thumbnail. Animated GIFs are kept as-is.
 */
export async function processImage(buffer, mime) {
  try {
    let original = buffer;
    let width;
    let height;
    if (mime === 'image/gif') {
      const meta = await sharp(buffer).metadata();
      width = meta.width;
      height = meta.pageHeight || meta.height;
    } else {
      const format = IMAGE_MIME[mime];
      const out = await sharp(buffer)
        .rotate()
        .resize(2560, 2560, { fit: 'inside', withoutEnlargement: true })
        .toFormat(format, { quality: 85 })
        .toBuffer({ resolveWithObject: true });
      original = out.data;
      width = out.info.width;
      height = out.info.height;
    }
    const thumbnail = await sharp(original)
      .rotate()
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    return { original, thumbnail, width, height };
  } catch {
    throw badRequest('The image could not be processed', 'INVALID_IMAGE');
  }
}

export async function processAvatar(buffer) {
  try {
    return await sharp(buffer).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  } catch {
    throw badRequest('The image could not be processed', 'INVALID_IMAGE');
  }
}

export function saveBuffer(buffer, { filename, contentType, metadata = {} }) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(filename, { metadata: { ...metadata, contentType } });
    upload.once('error', reject);
    upload.once('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

export async function findFile(id) {
  if (!ObjectId.isValid(id)) return null;
  return filesCollection().findOne({ _id: new ObjectId(id) });
}

export const openDownloadStream = (id) => bucket().openDownloadStream(new ObjectId(id));

export async function deleteFile(id) {
  if (!id || !ObjectId.isValid(id)) return;
  try {
    await bucket().delete(new ObjectId(id));
  } catch {
    /* already gone */
  }
}

export async function markAttached(ids) {
  await filesCollection().updateMany(
    { _id: { $in: ids.map((id) => new ObjectId(id)) } },
    { $set: { 'metadata.attached': true } },
  );
}

/** Removes uploads that were never attached to a message (abandoned previews). */
export async function deleteUnattachedOlderThan(date) {
  const stale = await filesCollection()
    .find({ 'metadata.kind': { $in: ['message', 'thumb'] }, 'metadata.attached': false, uploadDate: { $lt: date } })
    .project({ _id: 1 })
    .limit(500)
    .toArray();
  for (const f of stale) await deleteFile(f._id);
  return stale.length;
}
