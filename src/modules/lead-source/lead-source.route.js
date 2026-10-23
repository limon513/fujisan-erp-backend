import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { LeadSourceController } from "./lead-source.controller.js";
import { LeadSourceValidation as V } from "./lead-source.validation.js";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  authorize("lead-source.view"),
  validate({ query: V.list }),
  LeadSourceController.list,
);
router.get(
  "/:id",
  authorize("lead-source.view"),
  validate({ params: V.idParams }),
  LeadSourceController.getById,
);
router.post(
  "/",
  authorize("lead-source.create"),
  validate({ body: V.create }),
  LeadSourceController.create,
);
router.patch(
  "/:id",
  authorize("lead-source.edit"),
  validate({ params: V.idParams, body: V.update }),
  LeadSourceController.update,
);
router.delete(
  "/:id",
  authorize("lead-source.delete"),
  validate({ params: V.idParams }),
  LeadSourceController.remove,
);

export const LeadSourceRoute = router;
