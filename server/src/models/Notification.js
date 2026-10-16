import mongoose from 'mongoose';

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['group_added', 'group_removed', 'group_admin', 'group_updated'],
      required: true,
    },
    actor: { type: Schema.Types.ObjectId, ref: 'User' },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation' },
    text: { type: String, maxlength: 300 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });
// Notifications are ephemeral; auto-expire after 60 days. Chat history is never touched by this.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const Notification = mongoose.model('Notification', notificationSchema);
