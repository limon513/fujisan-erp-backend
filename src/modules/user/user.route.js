import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { UserController } from "./user.controller.js";
import { UserValidation as V } from "./user.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("user.view"), validate({ query: V.list }), UserController.list);
router.get(
  "/:id",
  authorize("user.view"),
  validate({ params: V.idParams }),
  UserController.getById,
);
router.post("/", authorize("user.create"), validate({ body: V.create }), UserController.create);
router.patch(
  "/:id",
  authorize("user.edit"),
  validate({ params: V.idParams, body: V.update }),
  UserController.update,
);
router.post(
  "/:id/reset-password",
  authorize("user.reset-password"),
  validate({ params: V.idParams }),
  UserController.resetPassword,
);
router.post(
  "/:id/unlock",
  authorize("user.edit"),
  validate({ params: V.idParams }),
  UserController.unlock,
);
router.delete(
  "/:id",
  authorize("user.delete"),
  validate({ params: V.idParams }),
  UserController.remove,
);

export const UserRoute = router;
