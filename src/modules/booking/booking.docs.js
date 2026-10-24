import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { BOOKING_STATUSES } from "./booking.constant.js";
import { BookingValidation as V } from "./booking.validation.js";

const tags = ["Sales: bookings"];
const Ref = z.object({ id: z.uuid(), name: z.string() });

const Booking = z
  .object({
    id: z.uuid(),
    bookingNo: z.string().meta({ example: "BK-000001" }),
    bookingDate: z.iso.datetime(),
    status: z.enum(BOOKING_STATUSES),
    listPrice: z.string(),
    discountRequested: z.string().optional(),
    discountAmount: z
      .string()
      .meta({ description: "As asked while pending; as approved once confirmed" }),
    netPrice: z.string(),
    interestAmount: z.string().optional(),
    totalPayable: z.string(),
    planName: z.string(),
    planTerms: z.record(z.string(), z.unknown()).optional(),
    plot: z.object({ id: z.uuid(), code: z.string() }).passthrough(),
    project: Ref,
    customer: z.object({
      id: z.uuid(),
      customerCode: z.string(),
      fullName: z.string(),
      mobile: z.string(),
    }),
    owner: z.object({ id: z.uuid(), fullName: z.string() }).nullable(),
    installments: z.array(z.record(z.string(), z.unknown())).optional(),
    approval: z.record(z.string(), z.unknown()).nullable().optional(),
    payments: z.array(z.record(z.string(), z.unknown())).optional(),
    balance: z
      .object({
        due: z.string(),
        paid: z.string(),
        outstanding: z.string(),
        overdue: z.string(),
        overdueCount: z.number().int(),
        lateFees: z.string(),
      })
      .optional(),
  })
  .meta({ id: "Booking", description: "Detail fields are included on GET /bookings/{id}" });

const scope =
  "Follows `booking.view` scope (OWN = bookings you sold, TEAM, DEPARTMENT, BRANCH, ALL).";

defineRoute({
  method: "get",
  path: "/bookings",
  tags,
  summary: "List bookings",
  description: `${scope} Search by booking no, customer name or plot code.`,
  request: { query: V.list },
  response: Booking,
  paginated: true,
});
defineRoute({
  method: "post",
  path: "/bookings/quote",
  tags,
  summary: "Price and schedule for a booking (nothing saved)",
  description: "For the booking form's live preview. Requires `booking.create`.",
  request: { body: V.quote },
  response: z.object({
    listPrice: z.string(),
    discountAmount: z.string(),
    discountPercent: z.string(),
    netPrice: z.string(),
    planName: z.string(),
    schedule: z.record(z.string(), z.unknown()),
  }),
  errors: [400, 401, 403, 422],
});
defineRoute({
  method: "get",
  path: "/bookings/:id",
  tags,
  summary: "Booking with its schedule and approval",
  description: scope,
  request: { params: V.idParams },
  response: Booking,
  errors: [400, 401, 403, 404],
});
defineRoute({
  method: "post",
  path: "/bookings",
  tags,
  summary: "Submit a booking for approval",
  description:
    "The plot must be AVAILABLE, or on hold for this customer or by this salesperson; it becomes BOOKED at once (one live booking per plot). A discount needs a reason. The BOOKING approval (Sales Manager by default) settles the discount — the approver may change it — and confirmation creates the installments from the plan's terms copied into the booking. Rejected or withdrawn bookings free the plot.",
  request: { body: V.create },
  response: Booking,
  status: 201,
  errors: [400, 401, 403, 409, 422],
});
defineRoute({
  method: "post",
  path: "/bookings/:id/register",
  tags,
  summary: "Register the deed: booking REGISTERED, plot SOLD",
  description:
    "Requires `booking.register`. Confirmed bookings; payments can continue afterwards (the outstanding amount is recorded in the audit log).",
  request: { params: V.idParams, body: V.register },
  response: Booking,
  errors: [400, 401, 403, 404, 409],
});

defineRoute({
  method: "post",
  path: "/bookings/:id/withdraw",
  tags,
  summary: "Withdraw a booking waiting for approval",
  description:
    "Only the person who submitted it (or a Super Admin). The plot becomes available again.",
  request: { params: V.idParams, body: V.withdraw },
  response: Booking,
  errors: [400, 401, 403, 404, 409],
});
