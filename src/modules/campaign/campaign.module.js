import { definePermissions } from "#core/rbac/permissions.js";
import { CampaignRoute } from "./campaign.route.js";
import "./campaign.docs.js";

export default {
  name: "campaign",
  basePath: "/campaigns",
  router: CampaignRoute,
  permissions: definePermissions({
    module: "crm",
    resource: "campaign",
    label: "Campaigns",
    scoped: false,
  }),
  dependsOn: ["lead-source"],
};
