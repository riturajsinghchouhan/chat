import mongoose from 'mongoose';
import { wallpaperSchema } from './wallpaper.js';

const { Schema } = mongoose;

const memberSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now },
    lastReadAt: { type: Date, default: Date.now },
    unreadCount: { type: Number, default: 0, min: 0 },
    // Per-member preferences (private to that member)
    pinned: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    muted: { type: Boolean, default: false },
    wallpaper: { type: wallpaperSchema, default: null }, // null = use the user's default
  },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    type: { type: String, enum: ['direct', 'group'], required: true },
    members: { type: [memberSchema], default: [] },
    // Sorted "<userIdA>:<userIdB>" — guarantees one direct conversation per pair.
    directKey: { type: String },
    name: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    avatar: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastMessage: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    lastMessageAt: { type: Date, default: Date.now },
    pinnedMessages: [{ type: Schema.Types.ObjectId, ref: 'Message' }],
    settings: {
      adminsOnlyMessages: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

conversationSchema.index({ 'members.user': 1, lastMessageAt: -1 });
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: 'string' } } },
);

conversationSchema.methods.getMember = function getMember(userId) {
  return this.members.find((m) => String(m.user?._id ?? m.user) === String(userId));
};

conversationSchema.methods.memberIds = function memberIds() {
  return this.members.map((m) => String(m.user?._id ?? m.user));
};

export const directKeyFor = (a, b) => [String(a), String(b)].sort().join(':');

export const Conversation = mongoose.model('Conversation', conversationSchema);
