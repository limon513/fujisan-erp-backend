import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { EmployeeController } from "./employee.controller.js";
import { EmployeeValidation as V } from "./employee.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("employee.view"), validate({ query: V.list }), EmployeeController.list);
router.get(
  "/:id",
  authorize("employee.view"),
  validate({ params: V.idParams }),
  EmployeeController.getById,
);
router.post(
  "/",
  authorize("employee.create"),
  validate({ body: V.create }),
  EmployeeController.create,
);
router.patch(
  "/:id",
  authorize("employee.edit"),
  validate({ params: V.idParams, body: V.update }),
  EmployeeController.update,
);
router.delete(
  "/:id",
  authorize("employee.delete"),
  validate({ params: V.idParams }),
  EmployeeController.remove,
);

export const EmployeeRoute = router;
