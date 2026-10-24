import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { LeadAssignmentRuleController as C } from "./lead-assignment-rule.controller.js";
import { LeadAssignmentRuleValidation as V } from "./lead-assignment-rule.validation.js";

const router = Router();

router.use(authenticate);

const P = "lead-assignment-rule";

router.get("/", authorize(`${P}.view`), C.list);
router.post("/distribute", authorize(`${P}.edit`), C.distributePool);
router.get("/:id", authorize(`${P}.view`), validate({ params: V.idParams }), C.getById);
router.post("/", authorize(`${P}.create`), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize(`${P}.edit`),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.delete("/:id", authorize(`${P}.delete`), validate({ params: V.idParams }), C.remove);

export const LeadAssignmentRuleRoute = router;
