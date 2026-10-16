import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { TeamController } from "./team.controller.js";
import { TeamValidation as V } from "./team.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("team.view"), validate({ query: V.list }), TeamController.list);
router.get(
  "/:id",
  authorize("team.view"),
  validate({ params: V.idParams }),
  TeamController.getById,
);
router.post("/", authorize("team.create"), validate({ body: V.create }), TeamController.create);
router.patch(
  "/:id",
  authorize("team.edit"),
  validate({ params: V.idParams, body: V.update }),
  TeamController.update,
);
router.delete(
  "/:id",
  authorize("team.delete"),
  validate({ params: V.idParams }),
  TeamController.remove,
);

export const TeamRoute = router;
