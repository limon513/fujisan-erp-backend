export const sortableFields = ["createdAt"];

export const searchableFields = ["description", "entityId"];

/** Business timezone: date filters are whole days in Asia/Dhaka. */
export const DHAKA_OFFSET = "+06:00";

export const auditLogSelect = {
  id: true,
  userId: true,
  action: true,
  entityType: true,
  entityId: true,
  description: true,
  changedFields: true,
  ip: true,
  createdAt: true,
};

export const auditLogDetailSelect = {
  ...auditLogSelect,
  oldValues: true,
  newValues: true,
  userAgent: true,
  requestId: true,
};
