import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { AccountController as C } from "./account.controller.js";
import { AccountValidation as V } from "./account.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("account.view"), validate({ query: V.list }), C.list);
router.get(
  "/trial-balance",
  authorize("account.view"),
  validate({ query: V.trialBalance }),
  C.trialBalance,
);
router.get("/:id", authorize("account.view"), validate({ params: V.idParams }), C.getById);
router.get(
  "/:id/ledger",
  authorize("account.view"),
  validate({ params: V.idParams, query: V.ledger }),
  C.ledger,
);
router.post("/", authorize("account.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("account.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.delete("/:id", authorize("account.delete"), validate({ params: V.idParams }), C.remove);

export const AccountRoute = router;
