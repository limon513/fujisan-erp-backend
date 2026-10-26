import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { CancellationController as C } from "./cancellation.controller.js";
import { CancellationValidation as V } from "./cancellation.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("cancellation.view"), validate({ query: V.list }), C.list);
router.get("/quote", authorize("cancellation.create"), validate({ query: V.quote }), C.quote);
router.get("/:id", authorize("cancellation.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("cancellation.create"), validate({ body: V.create }), C.create);
router.post(
  "/:id/refund",
  authorize("cancellation.refund"),
  validate({ params: V.idParams, body: V.refund }),
  C.payRefund,
);
router.post(
  "/:id/withdraw",
  authorize("cancellation.create"),
  validate({ params: V.idParams, body: V.withdraw }),
  C.withdraw,
);

export const CancellationRoute = router;
