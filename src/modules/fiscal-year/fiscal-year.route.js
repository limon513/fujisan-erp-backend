import { Router } from "express";
import { z } from "zod";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { FiscalYearController as C } from "./fiscal-year.controller.js";

const router = Router();
const idParams = z.object({ id: z.uuid() });

router.use(authenticate);

router.get("/", authorize("fiscal-year.view"), C.list);
router.post("/:id/close", authorize("fiscal-year.edit"), validate({ params: idParams }), C.close);
router.post("/:id/reopen", authorize("fiscal-year.edit"), validate({ params: idParams }), C.reopen);

export const FiscalYearRoute = router;
