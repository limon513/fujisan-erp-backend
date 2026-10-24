import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { CollectionController as C } from "./collection.controller.js";
import { CollectionValidation as V } from "./collection.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("collection.view"), validate({ query: V.list }), C.list);
router.get("/:id", authorize("collection.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("collection.create"), validate({ body: V.create }), C.create);
router.post(
  "/:id/verify",
  authorize("collection.verify"),
  validate({ params: V.idParams }),
  C.verify,
);
router.post(
  "/:id/reject",
  authorize("collection.verify"),
  validate({ params: V.idParams, body: V.reason }),
  C.reject,
);
router.post(
  "/:id/reverse",
  authorize("collection.reverse"),
  validate({ params: V.idParams, body: V.reason }),
  C.reverse,
);

export const CollectionRoute = router;
