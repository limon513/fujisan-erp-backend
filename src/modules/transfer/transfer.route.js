import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { TransferController as C } from "./transfer.controller.js";
import { TransferValidation as V } from "./transfer.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("transfer.view"), validate({ query: V.list }), C.list);
router.get("/quote", authorize("transfer.create"), validate({ query: V.quote }), C.quote);
router.get("/:id", authorize("transfer.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("transfer.create"), validate({ body: V.create }), C.create);
router.put(
  "/:id/agreement",
  authorize("transfer.create"),
  validate({ params: V.idParams, body: V.agreement }),
  C.replaceAgreement,
);
router.post(
  "/:id/complete",
  authorize("transfer.complete"),
  validate({ params: V.idParams, body: V.complete }),
  C.complete,
);
router.post(
  "/:id/withdraw",
  authorize("transfer.create"),
  validate({ params: V.idParams, body: V.withdraw }),
  C.withdraw,
);

export const TransferRoute = router;
