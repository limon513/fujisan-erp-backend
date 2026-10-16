import { Router } from "express";
import validate from "#core/middleware/validate.js";
import authenticate, { authenticate as authenticateWith } from "#core/middleware/authenticate.js";
import { authLimiter } from "#core/middleware/rateLimit.js";
import { AuthController } from "./auth.controller.js";
import { AuthValidation as V } from "./auth.validation.js";

const router = Router();

// Routes still allowed while a password change is pending
const authenticatePending = authenticateWith({ allowPasswordChangePending: true });

router.post("/login", authLimiter, validate({ body: V.login }), AuthController.login);
router.post("/refresh", AuthController.refresh);
router.post("/logout", AuthController.logout);
router.post(
  "/forgot-password",
  authLimiter,
  validate({ body: V.forgotPassword }),
  AuthController.forgotPassword,
);
router.post(
  "/reset-password",
  authLimiter,
  validate({ body: V.resetPassword }),
  AuthController.resetPassword,
);

router.get("/me", authenticatePending, AuthController.me);
router.post(
  "/change-password",
  authenticatePending,
  validate({ body: V.changePassword }),
  AuthController.changePassword,
);
router.post("/logout-all", authenticatePending, AuthController.logoutAll);

router.get("/sessions", authenticate, AuthController.listSessions);
router.delete(
  "/sessions/:id",
  authenticate,
  validate({ params: V.sessionParams }),
  AuthController.revokeSession,
);
router.get(
  "/login-history",
  authenticate,
  validate({ query: V.loginHistoryQuery }),
  AuthController.loginHistory,
);

export const AuthRoute = router;
