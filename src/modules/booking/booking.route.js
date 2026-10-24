import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { BookingController as C } from "./booking.controller.js";
import { BookingValidation as V } from "./booking.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("booking.view"), validate({ query: V.list }), C.list);
router.post("/quote", authorize("booking.create"), validate({ body: V.quote }), C.quote);
router.get("/:id", authorize("booking.view"), validate({ params: V.idParams }), C.getById);
router.post("/", authorize("booking.create"), validate({ body: V.create }), C.create);
router.post(
  "/:id/withdraw",
  authorize("booking.create"),
  validate({ params: V.idParams, body: V.withdraw }),
  C.withdraw,
);

router.post(
  "/:id/register",
  authorize("booking.register"),
  validate({ params: V.idParams, body: V.register }),
  C.register,
);

export const BookingRoute = router;
