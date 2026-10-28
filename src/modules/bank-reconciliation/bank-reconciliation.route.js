import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { BankReconciliationController as C } from "./bank-reconciliation.controller.js";
import { BankReconciliationValidation as V } from "./bank-reconciliation.validation.js";

const router = Router();

router.use(authenticate);

const view = authorize("bank-reconciliation.view");
const edit = authorize("bank-reconciliation.edit");

router.get("/accounts", view, C.accounts);
router.get("/statements", view, validate({ query: V.list }), C.list);
router.get("/statements/:id", view, validate({ params: V.idParams }), C.getStatement);
router.post(
  "/statements",
  authorize("bank-reconciliation.create"),
  validate({ body: V.importStatement }),
  C.importStatement,
);
router.delete(
  "/statements/:id",
  authorize("bank-reconciliation.delete"),
  validate({ params: V.idParams }),
  C.removeStatement,
);
router.get("/lines/:id/candidates", view, validate({ params: V.idParams }), C.candidates);
router.post("/lines/:id/match", edit, validate({ params: V.idParams, body: V.match }), C.match);
router.post("/lines/:id/unmatch", edit, validate({ params: V.idParams }), C.unmatch);
router.post("/lines/:id/ignore", edit, validate({ params: V.idParams, body: V.ignore }), C.ignore);
router.post("/lines/:id/book", edit, validate({ params: V.idParams, body: V.book }), C.book);

export const BankReconciliationRoute = router;
