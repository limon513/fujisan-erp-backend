/**
 * What a business module does when its approval finishes. Register once, at import time:
 *
 *   registerApprovalHandlers("BOOKING", {
 *     onApproved: (tx, request) => confirmBooking(tx, request.entityId),
 *     onRejected: (tx, request) => ...,
 *     onCancelled: (tx, request) => ...,
 *   });
 *
 * Handlers run inside the transaction that records the decision: if one throws (e.g. the plot was
 * sold meanwhile), the decision is rolled back and the approver sees the error.
 */
const handlers = new Map();

export function registerApprovalHandlers(workflowCode, { onApproved, onRejected, onCancelled }) {
  handlers.set(workflowCode, { onApproved, onRejected, onCancelled });
}

export const approvalHandlers = (workflowCode) => handlers.get(workflowCode) ?? {};
