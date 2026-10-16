import mongoose from 'mongoose';
import { wallpaperSchema } from './wallpaper.js';

const { Schema } = mongoose;

export const PUBLIC_USER_FIELDS = 'name username avatar bio isOnline lastSeen';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_.]+$/,
    },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    avatar: { type: String, default: null },
    bio: { type: String, default: '', maxlength: 200 },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    settings: {
      notifications: { type: Boolean, default: true },
      sound: { type: Boolean, default: true },
      messagePreview: { type: Boolean, default: true },
      wallpaper: { type: wallpaperSchema, default: null }, // default for all chats
    },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.index({ name: 1 });

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.passwordResetTokenHash;
    delete ret.passwordResetExpires;
    delete ret.__v;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
