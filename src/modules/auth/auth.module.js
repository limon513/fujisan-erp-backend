import { AuthRoute } from "./auth.route.js";
import "./auth.docs.js";

export default {
  name: "auth",
  basePath: "/auth",
  router: AuthRoute,
  core: true,
  // Self-service only; managing other users' accounts lives in the user module.
  permissions: [],
};
