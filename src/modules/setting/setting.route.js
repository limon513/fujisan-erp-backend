import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { SettingController } from "./setting.controller.js";
import { SettingValidation as V } from "./setting.validation.js";

const router = Router();

router.get("/branding", SettingController.branding);

// Any signed-in user may read the company profile (shown across the app)
router.get("/company", authenticate, SettingController.getCompany);
router.patch(
  "/company",
  authenticate,
  authorize("setting.edit"),
  validate({ body: V.updateCompany }),
  SettingController.updateCompany,
);

export const SettingRoute = router;
