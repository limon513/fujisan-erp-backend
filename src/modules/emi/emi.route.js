import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { EmiController as C } from "./emi.controller.js";
import { EmiValidation as V } from "./emi.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("emi.view"), validate({ query: V.list }), C.list);
router.get("/summary", authorize("emi.view"), C.summary);
router.post(
  "/:id/waive-late-fee",
  authorize("emi.waive"),
  validate({ params: V.idParams, body: V.waive }),
  C.waiveLateFee,
);

export const EmiRoute = router;
