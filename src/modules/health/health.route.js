import { Router } from "express";
import { HealthController } from "./health.controller.js";

const router = Router();

router.get("/", HealthController.getStatus);

export const HealthRoute = router;
