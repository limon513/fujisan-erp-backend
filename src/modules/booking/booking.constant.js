export const BOOKING_SEQUENCE = { key: "BOOKING", prefix: "BK-", padding: 6 };
export const BOOKING_STATUSES = [
  "PENDING_APPROVAL",
  "CONFIRMED",
  "REGISTERED",
  "REJECTED",
  "CANCELLED",
];
export const LIVE_STATUSES = ["PENDING_APPROVAL", "CONFIRMED", "REGISTERED"];

/** Payment plan fields copied into a booking (its own terms from then on). */
export const PLAN_TERMS = [
  "downPaymentType",
  "downPaymentValue",
  "installmentCount",
  "frequency",
  "interestRate",
  "gracePeriodDays",
  "lateFeeType",
  "lateFeeValue",
  "cancellationChargeType",
  "cancellationChargeValue",
  "transferFeeType",
  "transferFeeValue",
];

export const sortableFields = ["createdAt", "bookingDate", "bookingNo", "netPrice"];

const person = { select: { id: true, fullName: true } };

export const bookingListSelect = {
  id: true,
  bookingNo: true,
  bookingDate: true,
  status: true,
  listPrice: true,
  discountAmount: true,
  netPrice: true,
  totalPayable: true,
  planName: true,
  createdAt: true,
  plot: { select: { id: true, code: true } },
  project: { select: { id: true, name: true } },
  customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
  owner: person,
};

export const bookingDetailSelect = {
  ...bookingListSelect,
  discountRequested: true,
  discountReason: true,
  interestAmount: true,
  planTerms: true,
  paymentPlanId: true,
  approvalRequestId: true,
  notes: true,
  confirmedAt: true,
  registeredOn: true,
  deedNo: true,
  closedAt: true,
  closeReason: true,
  ownerId: true,
  teamId: true,
  departmentId: true,
  branchId: true,
  plot: {
    select: {
      id: true,
      code: true,
      areaSqft: true,
      status: true,
      block: { select: { name: true } },
      road: { select: { name: true } },
    },
  },
  lead: { select: { id: true, leadCode: true, fullName: true, status: true } },
  installments: {
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      kind: true,
      dueDate: true,
      amount: true,
      paidAmount: true,
      lateFee: true,
      status: true,
      paidAt: true,
    },
  },
};
