export const PAYMENT_SEQUENCE = { key: "PAYMENT", prefix: "PAY-", padding: 6 };
export const RECEIPT_SEQUENCE = { key: "RECEIPT", prefix: "MR-", padding: 6 };
export const PAYMENT_METHODS = ["CASH", "BANK_TRANSFER", "CHEQUE", "BKASH", "NAGAD", "CARD"];
export const PAYMENT_STATUSES = ["PENDING", "VERIFIED", "REJECTED", "REVERSED"];
export const METHOD_LABELS = {
  CASH: "cash",
  BANK_TRANSFER: "bank transfer",
  CHEQUE: "cheque",
  BKASH: "bKash",
  NAGAD: "Nagad",
  CARD: "card",
};

export const sortableFields = ["paidOn", "createdAt", "amount"];

const userName = { select: { id: true, username: true, employee: { select: { fullName: true } } } };

export const paymentListSelect = {
  id: true,
  paymentNo: true,
  receiptNo: true,
  amount: true,
  method: true,
  reference: true,
  paidOn: true,
  status: true,
  createdAt: true,
  booking: {
    select: {
      id: true,
      bookingNo: true,
      plot: { select: { code: true } },
      project: { select: { name: true } },
    },
  },
  customer: { select: { id: true, customerCode: true, fullName: true, mobile: true } },
};

export const paymentDetailSelect = {
  ...paymentListSelect,
  bankName: true,
  chequeDate: true,
  note: true,
  verifiedAt: true,
  rejectReason: true,
  reversedAt: true,
  reverseReason: true,
  createdById: true,
  verifiedById: true,
  allocations: {
    orderBy: { createdAt: "asc" },
    select: {
      amount: true,
      installment: { select: { number: true, kind: true, dueDate: true } },
    },
  },
  booking: {
    select: {
      id: true,
      bookingNo: true,
      netPrice: true,
      plot: { select: { code: true, block: { select: { name: true } } } },
      project: { select: { name: true } },
      owner: { select: { id: true, fullName: true } },
    },
  },
  customer: {
    select: { id: true, customerCode: true, fullName: true, mobile: true, presentAddress: true },
  },
};

export { userName };
