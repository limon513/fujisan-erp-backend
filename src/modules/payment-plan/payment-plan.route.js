import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { PaymentPlanController as C } from "./payment-plan.controller.js";
import { PaymentPlanValidation as V } from "./payment-plan.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("payment-plan.view"), validate({ query: V.list }), C.list);
router.post(
  "/preview",
  authorize(["payment-plan.create", "payment-plan.edit"]),
  validate({ body: V.preview }),
  C.preview,
);
router.get("/:id", authorize("payment-plan.view"), validate({ params: V.idParams }), C.getById);
router.post(
  "/:id/schedule",
  authorize("payment-plan.view"),
  validate({ params: V.idParams, body: V.schedule }),
  C.schedule,
);
router.post("/", authorize("payment-plan.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("payment-plan.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.delete("/:id", authorize("payment-plan.delete"), validate({ params: V.idParams }), C.remove);

export const PaymentPlanRoute = router;
