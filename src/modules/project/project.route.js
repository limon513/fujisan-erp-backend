import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { ProjectController as C } from "./project.controller.js";
import { ProjectValidation as V } from "./project.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("project.view"), validate({ query: V.list }), C.list);
router.get("/:id", authorize("project.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("project.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("project.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.delete("/:id", authorize("project.delete"), validate({ params: V.idParams }), C.remove);

router.put(
  "/:id/layout",
  authorize("project.edit"),
  validate({ params: V.idParams, body: V.setLayout }),
  C.setLayout,
);
router.delete(
  "/:id/layout",
  authorize("project.edit"),
  validate({ params: V.idParams }),
  C.removeLayout,
);

// Blocks and roads are part of the project's setup → project.view / project.edit
for (const [path, controller, createSchema, updateSchema] of [
  ["blocks", C.blocks, V.createBlock, V.updateBlock],
  ["roads", C.roads, V.createRoad, V.updateRoad],
]) {
  router.get(
    `/:id/${path}`,
    authorize("project.view"),
    validate({ params: V.idParams }),
    controller.list,
  );
  router.post(
    `/:id/${path}`,
    authorize("project.edit"),
    validate({ params: V.idParams, body: createSchema }),
    controller.create,
  );
  router.patch(
    `/:id/${path}/:childId`,
    authorize("project.edit"),
    validate({ params: V.childParams, body: updateSchema }),
    controller.update,
  );
  router.delete(
    `/:id/${path}/:childId`,
    authorize("project.edit"),
    validate({ params: V.childParams }),
    controller.remove,
  );
}

export const ProjectRoute = router;
