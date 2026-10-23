/**
 * Which models are audited automatically, and how.
 *
 * - `ignore`: fields whose change alone isn't worth an entry (bookkeeping, or covered by an explicit
 *   business event such as PASSWORD_CHANGED / PERMISSIONS_CHANGED).
 * - `label`: field used in the human description ("Updated Branch Head Office").
 *
 * Models not listed here (sessions, login history, OTPs, notifications, sequences, the audit log
 * itself, permission catalog rows) are not audited automatically.
 */
export const AUDITED_MODELS = {
  Company: { label: "name" },
  Setting: { label: "key" },
  Branch: { label: "name" },
  Department: { label: "name" },
  Designation: { label: "name" },
  Team: { label: "name" },
  Employee: { label: "fullName" },
  User: {
    label: "username",
    ignore: [
      "lastLoginAt",
      "failedLoginCount",
      "lockedUntil",
      "passwordHash",
      "passwordChangedAt",
      "twoFactorSecret",
      "twoFactorBackupCodes",
    ],
  },
  Role: { label: "name", ignore: ["permissionsVersion"] },
  Project: { label: "name" },
  Block: { label: "name" },
  Road: { label: "name" },
  // Status changes have their own history table, but stay in the audit log too
  Plot: { label: "code", ignore: ["statusChangedAt", "mapShape", "mapLabel"] },
  Customer: { label: "fullName" },
  CustomerNominee: { label: "fullName" },
  // Chain edits are logged as one APPROVAL_CHAIN_CHANGED event; requests have their own history
  ApprovalWorkflow: { label: "name", ignore: ["updatedAt"] },
};

/** Ignored on every model. */
export const ALWAYS_IGNORED = ["createdAt", "updatedAt", "createdById", "updatedById"];

/** Never stored in the audit log, on any model. */
export const REDACTED_FIELDS = [
  "passwordHash",
  "twoFactorSecret",
  "twoFactorBackupCodes",
  "refreshTokenHash",
  "previousTokenHash",
  "codeHash",
];
