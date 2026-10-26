import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { ReportController as C } from "./report.controller.js";
import { ReportValidation as V } from "./report.validation.js";

const router = Router();

router.use(authenticate, authorize("report.view"));

router.get("/overview", C.overview);
router.get("/sales", validate({ query: V.period }), C.sales);
router.get("/collections", validate({ query: V.period }), C.collections);
router.get("/outstanding", validate({ query: V.outstanding }), C.outstanding);
router.get("/customers/:id/statement", validate({ params: V.idParams }), C.customerStatement);

export const ReportRoute = router;
