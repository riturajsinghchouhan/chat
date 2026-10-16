import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDB(uri = env.MONGODB_URI) {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', { err: err.message }));
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  });
  logger.info('MongoDB connected', { db: mongoose.connection.name, host: mongoose.connection.host });
  if (mongoose.connection.name === 'test') {
    logger.warn('Using the default "test" database. Add a database name to MONGODB_URI, e.g. .../pulse_chat?...');
  }
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
