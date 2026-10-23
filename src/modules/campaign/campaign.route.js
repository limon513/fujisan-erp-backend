import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { authorize } from "#core/rbac/authorize.js";
import { CampaignController } from "./campaign.controller.js";
import { CampaignValidation as V } from "./campaign.validation.js";

const router = Router();

router.use(authenticate);

router.get("/", authorize("campaign.view"), validate({ query: V.list }), CampaignController.list);
router.get(
  "/:id",
  authorize("campaign.view"),
  validate({ params: V.idParams }),
  CampaignController.getById,
);
router.post(
  "/",
  authorize("campaign.create"),
  validate({ body: V.create }),
  CampaignController.create,
);
router.patch(
  "/:id",
  authorize("campaign.edit"),
  validate({ params: V.idParams, body: V.update }),
  CampaignController.update,
);
router.delete(
  "/:id",
  authorize("campaign.delete"),
  validate({ params: V.idParams }),
  CampaignController.remove,
);

export const CampaignRoute = router;
