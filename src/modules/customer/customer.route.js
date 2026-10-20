import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { CustomerController as C } from "./customer.controller.js";
import { CustomerValidation as V } from "./customer.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("customer.view"), validate({ query: V.list }), C.list);
// Anyone who can add or edit customers can check for duplicates (across all scopes, minimal details)
router.get(
  "/duplicates",
  authorize(["customer.create", "customer.edit"]),
  validate({ query: V.duplicateCheck }),
  C.checkDuplicates,
);
router.get("/:id", authorize("customer.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("customer.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("customer.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.delete("/:id", authorize("customer.delete"), validate({ params: V.idParams }), C.remove);

router.post(
  "/:id/nominees",
  authorize("customer.edit"),
  validate({ params: V.idParams, body: V.createNominee }),
  C.addNominee,
);
router.patch(
  "/:id/nominees/:childId",
  authorize("customer.edit"),
  validate({ params: V.childParams, body: V.updateNominee }),
  C.updateNominee,
);
router.delete(
  "/:id/nominees/:childId",
  authorize("customer.edit"),
  validate({ params: V.childParams }),
  C.removeNominee,
);

router.post(
  "/:id/documents",
  authorize("customer.edit"),
  validate({ params: V.idParams, body: V.addDocument }),
  C.addDocument,
);
router.delete(
  "/:id/documents/:childId",
  authorize("customer.edit"),
  validate({ params: V.childParams }),
  C.removeDocument,
);

export const CustomerRoute = router;
