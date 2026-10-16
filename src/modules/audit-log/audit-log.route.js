import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { AuditLogController } from "./audit-log.controller.js";
import { AuditLogValidation as V } from "./audit-log.validation.js";

const router = Router();

router.use(authenticate, authorize("audit-log.view"));

router.get("/", validate({ query: V.list }), AuditLogController.list);
router.get("/filter-options", AuditLogController.filterOptions);
router.get("/:id", validate({ params: V.idParams }), AuditLogController.getById);

export const AuditLogRoute = router;
