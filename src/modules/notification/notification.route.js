import { Router } from "express";
import authenticate from "#core/middleware/authenticate.js";
import validate from "#core/middleware/validate.js";
import { NotificationController as C } from "./notification.controller.js";
import { NotificationValidation as V } from "./notification.validation.js";

const router = Router();

// Everyone has their own notifications: no permission, always filtered by the signed-in user
router.use(authenticate);

router.get("/", validate({ query: V.list }), C.list);
router.get("/unread-count", C.unreadCount);
router.post("/read-all", C.markAllRead);
router.post("/:id/read", validate({ params: V.idParams }), C.markRead);

export const NotificationRoute = router;
