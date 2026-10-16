import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * A resumable, chunked upload in progress. The session _id becomes the GridFS file id:
 * chunks are written straight into `media.chunks` and the `media.files` document is only
 * created on completion, so an unfinished upload is never readable.
 */
const uploadSessionSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    mediaType: { type: String, enum: ['video'], default: 'video' },
    fileName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, default: null }, // detected from the first chunk's bytes
    size: { type: Number, required: true },
    chunkSize: { type: Number, required: true },
    totalChunks: { type: Number, required: true },
    received: { type: [Number], default: [] },
    duration: { type: Number, default: null },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

uploadSessionSchema.index({ expiresAt: 1 });
uploadSessionSchema.index({ ownerId: 1, createdAt: -1 });

export const UploadSession = mongoose.model('UploadSession', uploadSessionSchema);
