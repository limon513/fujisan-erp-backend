import { HealthRoute } from "./health.route.js";
import "./health.docs.js";

export default {
  name: "health",
  basePath: "/health",
  router: HealthRoute,
  core: true,
};
