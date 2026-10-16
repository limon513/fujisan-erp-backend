import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { BranchController } from "./branch.controller.js";
import { BranchValidation as V } from "./branch.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("branch.view"), validate({ query: V.list }), BranchController.list);
router.get(
  "/:id",
  authorize("branch.view"),
  validate({ params: V.idParams }),
  BranchController.getById,
);
router.post("/", authorize("branch.create"), validate({ body: V.create }), BranchController.create);
router.patch(
  "/:id",
  authorize("branch.edit"),
  validate({ params: V.idParams, body: V.update }),
  BranchController.update,
);
router.delete(
  "/:id",
  authorize("branch.delete"),
  validate({ params: V.idParams }),
  BranchController.remove,
);

export const BranchRoute = router;
