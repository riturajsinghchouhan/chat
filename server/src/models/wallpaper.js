import mongoose from 'mongoose';

const { Schema } = mongoose;

/** A user's chat wallpaper (see services/wallpaperService.js). */
export const wallpaperSchema = new Schema(
  {
    kind: { type: String, enum: ['none', 'preset', 'color', 'image'], required: true },
    value: { type: String, default: null, maxlength: 32 }, // preset id or #rrggbb
    mediaId: { type: Schema.Types.ObjectId, default: null },
    url: { type: String, default: null },
    dim: { type: Number, default: 0, min: 0, max: 80 }, // % darkening for readability
  },
  { _id: false },
);
