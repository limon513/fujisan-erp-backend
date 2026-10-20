import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { uploadSingle } from "#core/middleware/upload.js";
import { authorize } from "#core/rbac/authorize.js";
import { PlotController as C } from "./plot.controller.js";
import { PlotValidation as V } from "./plot.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("plot.view"), validate({ query: V.list }), C.list);
router.get("/import-template", authorize("plot.create"), C.importTemplate);
router.post(
  "/import",
  authorize("plot.create"),
  uploadSingle("file"),
  validate({ query: V.importQuery }),
  C.importPlots,
);
router.get("/:id", authorize("plot.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("plot.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("plot.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.post(
  "/:id/price",
  authorize("plot.price"),
  validate({ params: V.idParams, body: V.changePrice }),
  C.changePrice,
);
router.delete("/:id", authorize("plot.delete"), validate({ params: V.idParams }), C.remove);

export const PlotRoute = router;
