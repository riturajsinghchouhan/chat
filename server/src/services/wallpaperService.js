// Chat wallpapers are private to each user: a default (user.settings.wallpaper) and an
// optional per-conversation override (conversation member.wallpaper). `null` = inherit.
import mongoose from 'mongoose';
import sharp from 'sharp';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { User } from '../models/User.js';
import { AppError, badRequest } from '../utils/AppError.js';
import { objectId } from '../utils/validate.js';
import { deleteFile, detectFile, findFile, markAttached, mediaUrl, saveBuffer } from './storage.js';
import { logger } from '../utils/logger.js';

export const wallpaperInput = z
  .object({
    kind: z.enum(['none', 'preset', 'color', 'image']),
    value: z.string().max(32).optional(),
    mediaId: objectId.optional(),
    dim: z.number().int().min(0).max(80).default(0),
  })
  .superRefine((w, ctx) => {
    if (w.kind === 'preset' && !/^[a-z0-9-]{1,32}$/.test(w.value || '')) ctx.addIssue({ code: 'custom', message: 'Invalid wallpaper preset', path: ['value'] });
    if (w.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(w.value || '')) ctx.addIssue({ code: 'custom', message: 'Invalid wallpaper color', path: ['value'] });
    if (w.kind === 'image' && !w.mediaId) ctx.addIssue({ code: 'custom', message: 'mediaId is required', path: ['mediaId'] });
  })
  .nullable();

/** Turns validated input into the stored shape, checking that an image belongs to the user. */
export async function resolveWallpaper(userId, input) {
  if (!input) return null;
  const out = { kind: input.kind, value: null, mediaId: null, url: null, dim: input.dim ?? 0 };
  if (input.kind === 'preset' || input.kind === 'color') out.value = input.value.toLowerCase();
  if (input.kind === 'image') {
    const file = await findFile(input.mediaId);
    if (!file || file.metadata?.kind !== 'wallpaper' || String(file.metadata.ownerId) !== String(userId)) {
      throw badRequest('Invalid wallpaper image', 'INVALID_MEDIA');
    }
    Object.assign(out, { mediaId: file._id, url: mediaUrl(file._id) });
    await markAttached([file._id]);
  }
  return out;
}

/** Deletes a wallpaper image once neither the default nor any chat of the user uses it. */
export async function releaseWallpaperImage(userId, mediaId) {
  if (!mediaId) return;
  const uid = new mongoose.Types.ObjectId(String(userId));
  const [inChat, asDefault] = await Promise.all([
    Conversation.exists({ members: { $elemMatch: { user: uid, 'wallpaper.mediaId': mediaId } } }),
    User.exists({ _id: uid, 'settings.wallpaper.mediaId': mediaId }),
  ]);
  if (!inChat && !asDefault) {
    await deleteFile(mediaId);
    logger.debug('Wallpaper image released', { userId: String(userId), fileId: String(mediaId) });
  }
}

/** Stores an uploaded wallpaper image (re-encoded, EXIF stripped). It is attached once applied. */
export async function saveWallpaperImage(userId, file) {
  if (!file) throw badRequest('Choose an image to upload');
  const detected = await detectFile(file.buffer, file.originalname);
  if (detected?.kind !== 'image') throw badRequest('Wallpaper must be a JPEG, PNG, WebP or GIF image', 'INVALID_FILE_TYPE');
  if (file.size > 10 * 1024 * 1024) throw new AppError(413, 'Wallpaper must be 10 MB or smaller', 'FILE_TOO_LARGE');
  let buffer;
  let info;
  try {
    ({ data: buffer, info } = await sharp(file.buffer)
      .rotate()
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw badRequest('The image could not be processed', 'INVALID_IMAGE');
  }
  const id = await saveBuffer(buffer, {
    filename: `wallpaper-${userId}.webp`,
    contentType: 'image/webp',
    metadata: { kind: 'wallpaper', ownerId: String(userId), attached: false, width: info.width, height: info.height },
  });
  logger.info('Wallpaper uploaded', { userId: String(userId), fileId: String(id), bytes: buffer.length });
  return { mediaId: id, url: mediaUrl(id), width: info.width, height: info.height };
}
