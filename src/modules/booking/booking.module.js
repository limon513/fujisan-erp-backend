import { definePermissions } from "#core/rbac/permissions.js";
import { BookingRoute } from "./booking.route.js";
import "./booking.docs.js";

export default {
  name: "booking",
  basePath: "/bookings",
  router: BookingRoute,
  dependsOn: ["customer", "plot", "payment-plan", "lead"],
  permissions: definePermissions({
    module: "sales",
    resource: "booking",
    label: "Bookings",
    actions: ["view", "create", "edit", "export", "print"],
  }),
  // One approval per booking: the approver settles the discount (and may change it)
  approvalWorkflows: [
    {
      code: "BOOKING",
      name: "Booking",
      description: "Confirms a booking and its discount. The approver may change the discount.",
      adjustableLabel: "Discount (৳)",
    },
  ],
};
