import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { ProjectCostController as C } from "./project-cost.controller.js";
import { ProjectCostValidation as V } from "./project-cost.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("project-cost.view"), validate({ query: V.list }), C.list);
router.get("/summary", authorize("project-cost.view"), validate({ query: V.summary }), C.summary);
router.post("/", authorize("project-cost.create"), validate({ body: V.create }), C.create);
router.post(
  "/:id/reverse",
  authorize("project-cost.reverse"),
  validate({ params: V.idParams, body: V.reverse }),
  C.reverse,
);

export const ProjectCostRoute = router;
