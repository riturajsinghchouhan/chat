import mongoose from 'mongoose';

const { Schema } = mongoose;

export const MESSAGE_TYPES = ['text', 'image', 'gif', 'file', 'video', 'system'];

const receiptSchema = new Schema(
  { user: { type: Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } },
  { _id: false },
);

const reactionSchema = new Schema(
  { user: { type: Schema.Types.ObjectId, ref: 'User', required: true }, emoji: { type: String, maxlength: 16 } },
  { _id: false },
);

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', default: null }, // direct chats only
    // Client-generated UUID. (senderId, clientId) is unique → idempotent sends after reconnect/retry.
    clientId: { type: String, maxlength: 64 },
    type: { type: String, enum: MESSAGE_TYPES, default: 'text' },
    text: { type: String, default: '', maxlength: 4000 },

    // Media (images/files/videos live in MongoDB GridFS, GIFs are provider URLs)
    mediaId: { type: Schema.Types.ObjectId, default: null },
    thumbnailId: { type: Schema.Types.ObjectId, default: null },
    mediaUrl: { type: String, default: null },
    thumbnailUrl: { type: String, default: null },
    mimeType: { type: String, default: null },
    fileName: { type: String, default: null },
    fileSize: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null }, // seconds (videos)
    provider: { type: String, default: null }, // e.g. "giphy"
    providerId: { type: String, default: null },

    replyTo: { type: Schema.Types.ObjectId, ref: 'Message', default: null },
    forwarded: { type: Boolean, default: false },
    reactions: { type: [reactionSchema], default: [] },

    status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent' },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    deliveredTo: { type: [receiptSchema], default: [] },
    readBy: { type: [receiptSchema], default: [] },

    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    hiddenFor: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true },
);

messageSchema.index({ conversationId: 1, _id: -1 });
messageSchema.index({ conversationId: 1, type: 1, _id: -1 });
messageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
);
messageSchema.index({ receiverId: 1, status: 1 });
messageSchema.index({ mediaId: 1 }, { sparse: true });
messageSchema.index({ thumbnailId: 1 }, { sparse: true });

messageSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.hiddenFor;
    delete ret.__v;
    return ret;
  },
});

export const MESSAGE_POPULATE = [
  { path: 'senderId', select: 'name username avatar' },
  {
    path: 'replyTo',
    select: 'text type senderId fileName thumbnailUrl mediaUrl deletedAt',
    populate: { path: 'senderId', select: 'name username' },
  },
];

export const Message = mongoose.model('Message', messageSchema);
