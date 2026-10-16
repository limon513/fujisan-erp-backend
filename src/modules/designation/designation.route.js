import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { DesignationController } from "./designation.controller.js";
import { DesignationValidation as V } from "./designation.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  authorize("designation.view"),
  validate({ query: V.list }),
  DesignationController.list,
);
router.get(
  "/:id",
  authorize("designation.view"),
  validate({ params: V.idParams }),
  DesignationController.getById,
);
router.post(
  "/",
  authorize("designation.create"),
  validate({ body: V.create }),
  DesignationController.create,
);
router.patch(
  "/:id",
  authorize("designation.edit"),
  validate({ params: V.idParams, body: V.update }),
  DesignationController.update,
);
router.delete(
  "/:id",
  authorize("designation.delete"),
  validate({ params: V.idParams }),
  DesignationController.remove,
);

export const DesignationRoute = router;
