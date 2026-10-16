import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { DepartmentController } from "./department.controller.js";
import { DepartmentValidation as V } from "./department.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  authorize("department.view"),
  validate({ query: V.list }),
  DepartmentController.list,
);
router.get(
  "/:id",
  authorize("department.view"),
  validate({ params: V.idParams }),
  DepartmentController.getById,
);
router.post(
  "/",
  authorize("department.create"),
  validate({ body: V.create }),
  DepartmentController.create,
);
router.patch(
  "/:id",
  authorize("department.edit"),
  validate({ params: V.idParams, body: V.update }),
  DepartmentController.update,
);
router.delete(
  "/:id",
  authorize("department.delete"),
  validate({ params: V.idParams }),
  DepartmentController.remove,
);

export const DepartmentRoute = router;
