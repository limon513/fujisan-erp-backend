export const APPROVER_TYPES = [
  "ROLE",
  "TEAM_LEADER",
  "REPORTING_MANAGER",
  "DEPARTMENT_HEAD",
  "USER",
];
export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"];
export const MAX_STEPS = 10;

export const sortableFields = ["createdAt", "requestNo", "completedAt"];
export const searchableFields = ["requestNo", "title", "summary"];

const userName = { id: true, username: true, employee: { select: { fullName: true } } };

export const requestListSelect = {
  id: true,
  requestNo: true,
  title: true,
  summary: true,
  link: true,
  amount: true,
  percent: true,
  status: true,
  steps: true,
  currentStepOrder: true,
  createdAt: true,
  completedAt: true,
  workflow: { select: { id: true, code: true, name: true, adjustableLabel: true } },
  requestedBy: { select: userName },
};

export const requestDetailSelect = {
  ...requestListSelect,
  approvedAmount: true,
  entityType: true,
  entityId: true,
  snapshot: true,
  finalStepOrder: true,
  currentApproverIds: true,
  requestedById: true,
  requesterEmployeeId: true,
  teamId: true,
  departmentId: true,
  branchId: true,
  actions: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      stepOrder: true,
      decision: true,
      comment: true,
      createdAt: true,
      actor: { select: userName },
    },
  },
};

export const workflowSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  module: true,
  isActive: true,
  adjustableLabel: true,
  updatedAt: true,
  steps: {
    orderBy: { stepOrder: "asc" },
    select: {
      id: true,
      stepOrder: true,
      name: true,
      approverType: true,
      sameBranch: true,
      maxAmount: true,
      maxPercent: true,
      approverRole: { select: { id: true, name: true } },
      approverUser: { select: userName },
    },
  },
};
