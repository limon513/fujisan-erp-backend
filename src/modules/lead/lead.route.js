import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { LeadController as C } from "./lead.controller.js";
import { LeadValidation as V } from "./lead.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("lead.view"), validate({ query: V.list }), C.list);
// Anyone who adds or edits leads can check for duplicates (across all scopes, minimal details)
router.get(
  "/duplicates",
  authorize(["lead.create", "lead.edit"]),
  validate({ query: V.duplicateCheck }),
  C.checkDuplicates,
);
router.get("/assignees", authorize("lead.assign"), C.assignees);
router.get("/:id", authorize("lead.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("lead.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("lead.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.delete("/:id", authorize("lead.delete"), validate({ params: V.idParams }), C.remove);

router.post(
  "/:id/status",
  authorize("lead.edit"),
  validate({ params: V.idParams, body: V.changeStatus }),
  C.changeStatus,
);
router.post(
  "/:id/activities",
  authorize("lead.edit"),
  validate({ params: V.idParams, body: V.addActivity }),
  C.addActivity,
);
router.post(
  "/:id/assign",
  authorize("lead.assign"),
  validate({ params: V.idParams, body: V.assign }),
  C.assign,
);
router.post(
  "/:id/convert",
  authorize("lead.edit"),
  validate({ params: V.idParams, body: V.convert }),
  C.convert,
);

export const LeadRoute = router;
