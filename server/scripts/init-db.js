// Creates/updates all MongoDB indexes. Run once per deployment: `npm run db:init`
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { Notification } from '../src/models/Notification.js';

await connectDB();
for (const model of [User, Session, Conversation, Message, Notification]) {
  await model.syncIndexes();
  console.log(`Indexes synced: ${model.modelName}`);
}
// GridFS indexes for the "media" bucket
const db = mongoose.connection.db;
await db.collection('media.files').createIndex({ filename: 1, uploadDate: 1 });
await db.collection('media.files').createIndex({ 'metadata.kind': 1, 'metadata.attached': 1, uploadDate: 1 });
await db.collection('media.chunks').createIndex({ files_id: 1, n: 1 }, { unique: true });
console.log('GridFS indexes ensured');
await mongoose.disconnect();
