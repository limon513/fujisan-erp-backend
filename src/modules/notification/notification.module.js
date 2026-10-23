import { NotificationRoute } from "./notification.route.js";
import "./notification.docs.js";

export default {
  name: "notification",
  basePath: "/notifications",
  router: NotificationRoute,
  core: true,
};
