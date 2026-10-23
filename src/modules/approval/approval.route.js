import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { ApprovalController as C } from "./approval.controller.js";
import { ApprovalValidation as V } from "./approval.validation.js";

const router = Router();

router.use(authenticate);

// Approval chains
router.get("/workflows", authorize("approval-workflow.view"), C.listWorkflows);
router.get(
  "/workflows/:id",
  authorize("approval-workflow.view"),
  validate({ params: V.idParams }),
  C.getWorkflow,
);
router.patch(
  "/workflows/:id",
  authorize("approval-workflow.edit"),
  validate({ params: V.idParams, body: V.updateWorkflow }),
  C.updateWorkflow,
);

// Everyone has an inbox and their own requests; who may decide is set by the chain, not a permission
router.get("/inbox", validate({ query: V.list }), C.inbox);
router.get("/inbox/count", C.inboxCount);
router.get("/mine", validate({ query: V.list }), C.mine);
router.get("/", authorize("approval.view"), validate({ query: V.list }), C.list);
router.get("/:id", validate({ params: V.idParams }), C.getById);
router.post("/:id/approve", validate({ params: V.idParams, body: V.approve }), C.approve);
router.post("/:id/reject", validate({ params: V.idParams, body: V.reject }), C.reject);
router.post("/:id/cancel", validate({ params: V.idParams, body: V.cancel }), C.cancel);

export const ApprovalRoute = router;
