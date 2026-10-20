import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { uploadSingle } from "#core/middleware/upload.js";
import { uploadLimiter } from "#core/middleware/rateLimit.js";
import { verifyFileToken } from "#core/auth/fileTokens.js";
import { FileController } from "./file.controller.js";
import { FileValidation as V } from "./file.validation.js";

const router = Router();

/** File content: a valid signed ?token for this file, or a normal bearer token. */
const fileAccess = (req, res, next) => {
  const { token } = req.valid.query;
  if (token && verifyFileToken(token, req.valid.params.id)) return next();
  return authenticate(req, res, next);
};

router.get(
  "/:id/content",
  validate({ params: V.idParams, query: V.contentQuery }),
  fileAccess,
  FileController.content,
);

router.use(authenticate);

// Uploads are rate limited per IP (60 per 15 minutes)
router.post(
  "/",
  uploadLimiter,
  uploadSingle("file"),
  validate({ body: V.upload }),
  FileController.upload,
);
router.get("/:id", validate({ params: V.idParams }), FileController.getById);
router.delete("/:id", validate({ params: V.idParams }), FileController.remove);

export const FileRoute = router;
