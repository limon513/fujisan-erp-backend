import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { NotificationValidation as V } from "./notification.validation.js";

const tags = ["Notifications"];

const Notification = z
  .object({
    id: z.uuid(),
    type: z.string().meta({ example: "FOLLOW_UP_DUE" }),
    title: z.string(),
    body: z.string().nullable(),
    link: z.string().nullable().meta({ description: "Frontend path to open" }),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "Notification" });

defineRoute({
  method: "get",
  path: "/notifications",
  tags,
  summary: "My notifications, newest first",
  description: "Only the signed-in user's own. `meta.unread` is the total unread count.",
  request: { query: V.list },
  response: Notification,
  paginated: true,
  errors: [400, 401],
});
defineRoute({
  method: "get",
  path: "/notifications/unread-count",
  tags,
  summary: "How many of my notifications are unread",
  response: z.object({ count: z.number().int() }),
  errors: [401],
});
defineRoute({
  method: "post",
  path: "/notifications/read-all",
  tags,
  summary: "Mark all my notifications as read",
  response: z.object({ marked: z.number().int() }),
  errors: [401],
});
defineRoute({
  method: "post",
  path: "/notifications/:id/read",
  tags,
  summary: "Mark one notification as read",
  request: { params: V.idParams },
  response: Notification,
  errors: [400, 401, 404],
});
