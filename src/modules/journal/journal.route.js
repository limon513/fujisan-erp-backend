import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { JournalController as C } from "./journal.controller.js";
import { JournalValidation as V } from "./journal.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("journal.view"), validate({ query: V.list }), C.list);
router.get("/:id", authorize("journal.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("journal.create"), validate({ body: V.create }), C.create);
router.post(
  "/:id/reverse",
  authorize("journal.reverse"),
  validate({ params: V.idParams, body: V.reverse }),
  C.reverse,
);

export const JournalRoute = router;
