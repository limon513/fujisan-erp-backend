import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import { authorize } from "#core/rbac/authorize.js";
import { DashboardController } from "./dashboard.controller.js";

const router = Router();

router.get("/summary", authenticate, authorize("dashboard.view"), DashboardController.summary);

export const DashboardRoute = router;
