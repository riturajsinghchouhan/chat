import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name, fallback) {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((u) => u.trim().replace(/\/$/, ''))
  .filter(Boolean);

export const env = {
  NODE_ENV,
  isProd,
  isTest: NODE_ENV === 'test',
  PORT: int('PORT', 5000),
  MONGODB_URI: required('MONGODB_URI'),
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '15m',
  REFRESH_TOKEN_DAYS: int('REFRESH_TOKEN_DAYS', 30),
  CLIENT_URLS: clientUrls,
  CLIENT_URL: clientUrls[0],
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || undefined,
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax'),
  TRUST_PROXY: int('TRUST_PROXY', 1),
  GIPHY_API_KEY: process.env.GIPHY_API_KEY || '',
  REDIS_URL: process.env.REDIS_URL || '',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: int('SMTP_PORT', 587),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'Pulse Chat <no-reply@example.com>',
  MAX_IMAGE_MB: int('MAX_IMAGE_MB', 10),
  MAX_FILE_MB: int('MAX_FILE_MB', 20),
  DELETE_FOR_EVERYONE_MINUTES: int('DELETE_FOR_EVERYONE_MINUTES', 60),
};
