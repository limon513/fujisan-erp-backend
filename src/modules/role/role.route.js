import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { RoleController } from "./role.controller.js";
import { RoleValidation as V } from "./role.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("role.view"), validate({ query: V.list }), RoleController.list);
router.get("/permission-catalog", authorize("role.view"), RoleController.catalog);
router.get(
  "/:id",
  authorize("role.view"),
  validate({ params: V.idParams }),
  RoleController.getById,
);
router.post("/", authorize("role.create"), validate({ body: V.create }), RoleController.create);
router.patch(
  "/:id",
  authorize("role.edit"),
  validate({ params: V.idParams, body: V.update }),
  RoleController.update,
);
router.put(
  "/:id/permissions",
  authorize("role.edit"),
  validate({ params: V.idParams, body: V.setPermissions }),
  RoleController.setPermissions,
);
router.delete(
  "/:id",
  authorize("role.delete"),
  validate({ params: V.idParams }),
  RoleController.remove,
);

export const RoleRoute = router;
