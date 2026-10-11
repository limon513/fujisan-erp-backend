import { rateLimit } from "express-rate-limit";

const limitedResponse = (message) => ({ success: false, message, errors: [] });

/** General API limit per IP. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: limitedResponse("Too many requests, please slow down"),
});

/** Strict limit for login / password reset / OTP routes. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: limitedResponse("Too many attempts, please try again later"),
});
