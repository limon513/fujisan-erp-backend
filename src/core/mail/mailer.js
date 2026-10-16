import nodemailer from "nodemailer";
import config from "#config/index.js";
import logger from "#core/utils/logger.js";

/**
 * Sends email through SMTP when configured. Without SMTP_HOST the message is logged (development)
 * or kept in an in-memory outbox (tests, read with `getOutbox()`).
 */
const transport = config.mail.host
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    })
  : null;

const outbox = [];

export const getOutbox = () => outbox;
export const clearOutbox = () => outbox.splice(0, outbox.length);

export async function sendMail({ to, subject, text, html }) {
  const message = { from: config.mail.from, to, subject, text, html };

  if (transport) {
    await transport.sendMail(message);
    return;
  }

  if (config.isTest) {
    outbox.push(message);
    return;
  }

  logger.info({ to, subject }, `Email (SMTP not configured, not sent):\n${text}`);
}
