import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let transporter;

function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

export async function sendPasswordResetEmail(to, resetUrl) {
  const t = getTransporter();
  if (!t) {
    if (env.isProd) {
      logger.error('SMTP not configured; password reset email was not sent');
    } else if (!env.isTest) {
      // Development convenience: no SMTP configured, print the link to the server console.
      logger.info('Password reset link (dev only, SMTP not configured)', { resetUrl });
    }
    return;
  }
  await t.sendMail({
    from: env.MAIL_FROM,
    to,
    subject: 'Reset your Pulse Chat password',
    text: `Use this link to reset your password (valid for 30 minutes):\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Use the link below to reset your password. It is valid for 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}
