import nodemailer from "nodemailer";
import config from "#config/index.js";
import AppError from "#core/errors/AppError.js";
import logger from "#core/utils/logger.js";

/**
 * Sends email through the first configured provider:
 *   1. Resend HTTP API (RESEND_API_KEY)
 *   2. SMTP (SMTP_HOST)
 *   3. none: logged in development, kept in an in-memory outbox in tests (`getOutbox()`)
 * Tests always use the outbox, even when a provider is configured.
 */

const RESEND_URL = "https://api.resend.com/emails";

async function sendWithResend(message) {
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.mail.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to].flat(),
      subject: message.subject,
      text: message.text,
      ...(message.html && { html: message.html }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logger.error({ status: response.status, detail, to: message.to }, "Resend rejected an email");
    throw new AppError(502, "The email could not be sent. Try again later.");
  }
}

const smtp = config.mail.host
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

  if (config.isTest) {
    outbox.push(message);
    return;
  }
  if (config.mail.resendApiKey) {
    await sendWithResend(message);
    return;
  }
  if (smtp) {
    await smtp.sendMail(message);
    return;
  }

  logger.info({ to, subject }, `Email (no mail provider configured, not sent):\n${text}`);
}
