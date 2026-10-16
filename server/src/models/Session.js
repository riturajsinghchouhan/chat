import mongoose from 'mongoose';

const { Schema } = mongoose;

// One document per logged-in device. Stores only a SHA-256 hash of the refresh token.
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true },
    // Previous token hash, accepted briefly so concurrent refreshes from several tabs don't log the user out.
    prevTokenHash: { type: String, default: null },
    rotatedAt: { type: Date, default: null },
    userAgent: { type: String, maxlength: 300 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// MongoDB TTL monitor removes expired sessions automatically.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);
