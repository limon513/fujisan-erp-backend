import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { SiteVisitController as C } from "./site-visit.controller.js";
import { SiteVisitValidation as V } from "./site-visit.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("site-visit.view"), validate({ query: V.list }), C.list);
router.get("/counts", authorize("site-visit.view"), validate({ query: V.counts }), C.counts);
router.get("/:id", authorize("site-visit.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("site-visit.create"), validate({ body: V.create }), C.create);
router.patch(
  "/:id",
  authorize("site-visit.edit"),
  validate({ params: V.idParams, body: V.update }),
  C.update,
);
router.post(
  "/:id/complete",
  authorize("site-visit.edit"),
  validate({ params: V.idParams, body: V.complete }),
  C.complete,
);
router.post(
  "/:id/cancel",
  authorize("site-visit.edit"),
  validate({ params: V.idParams, body: V.cancel }),
  C.cancel,
);

export const SiteVisitRoute = router;
