import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { FollowUpController as C } from "./follow-up.controller.js";
import { FollowUpValidation as V } from "./follow-up.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("follow-up.view"), validate({ query: V.list }), C.list);
router.get("/counts", authorize("follow-up.view"), validate({ query: V.counts }), C.counts);
router.get("/:id", authorize("follow-up.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("follow-up.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("follow-up.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.post(
  "/:id/complete",
  authorize("follow-up.edit"),
  validate({ params: V.idParams, body: V.complete }),
  C.complete,
);
router.post(
  "/:id/cancel",
  authorize("follow-up.edit"),
  validate({ params: V.idParams, body: V.cancel }),
  C.cancel,
);

export const FollowUpRoute = router;
