import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { cancelApproval, decide } from "#core/approval/engine.js";
import { buildScopeWhere, isInScope } from "#core/rbac/scope.js";
import { buildListArgs, paginationMeta } from "#core/utils/listQuery.js";
import {
  requestDetailSelect,
  requestListSelect,
  searchableFields,
  workflowSelect,
} from "./approval.constant.js";

const SCOPE_FIELDS = { owner: "requesterEmployeeId" };
// Loaded for access checks, not shown
const INTERNAL_FIELDS = [
  "currentApproverIds",
  "requesterEmployeeId",
  "teamId",
  "departmentId",
  "branchId",
];

const userDto = (user) =>
  user ? { id: user.id, name: user.employee?.fullName ?? user.username } : null;

const currentStep = (request) =>
  request.status === "PENDING"
    ? (request.steps.find((step) => step.stepOrder === request.currentStepOrder) ?? null)
    : null;

const toListDto = ({ steps, currentStepOrder, requestedBy, ...request }) => {
  const step = currentStep({ ...request, steps, currentStepOrder });
  return {
    ...request,
    requestedBy: userDto(requestedBy),
    currentStep: step && { stepOrder: step.stepOrder, name: step.name },
  };
};

/** Each step of the chain with where the request stands on it, for the timeline. */
function stepStates(request) {
  const last = new Map();
  for (const action of request.actions) {
    if (action.stepOrder != null && action.decision !== "SUBMITTED")
      last.set(action.stepOrder, action);
  }
  return request.steps.map((step) => {
    const action = last.get(step.stepOrder);
    let state;
    if (action?.decision === "APPROVED" || action?.decision === "REJECTED") state = action.decision;
    else if (action?.decision === "SKIPPED") state = "SKIPPED";
    else if (request.status === "PENDING" && step.stepOrder === request.currentStepOrder)
      state = "CURRENT";
    else if (step.stepOrder > request.finalStepOrder && !step.escalated) state = "NOT_NEEDED";
    else state = request.status === "PENDING" ? "WAITING" : "NOT_REACHED";
    return { ...step, state };
  });
}

const scopeStamp = (request) => ({
  requesterEmployeeId: request.requesterEmployeeId,
  teamId: request.teamId,
  departmentId: request.departmentId,
  branchId: request.branchId,
});

/** Who may open a request: the requester, its approvers (past or current), or approval.view in scope. */
function canView(actor, request) {
  if (actor.isSuperAdmin || request.requestedById === actor.userId) return true;
  if (request.currentApproverIds.includes(actor.userId)) return true;
  if (request.actions.some((action) => action.actor?.id === actor.userId)) return true;
  const scope = actor.permissions["approval.view"];
  return Boolean(scope) && isInScope(actor, scope, scopeStamp(request), SCOPE_FIELDS);
}

async function listRequests(where, query) {
  const { skip, take, orderBy, searchWhere } = buildListArgs(query, searchableFields);
  const filtered = {
    AND: [
      where,
      searchWhere,
      query.status ? { status: query.status } : {},
      query.workflow ? { workflow: { code: query.workflow } } : {},
    ],
  };
  const [rows, total] = await prisma.$transaction([
    prisma.approvalRequest.findMany({
      where: filtered,
      skip,
      take,
      orderBy,
      select: requestListSelect,
    }),
    prisma.approvalRequest.count({ where: filtered }),
  ]);
  return { data: rows.map(toListDto), meta: paginationMeta(query, total) };
}

/** Requests waiting for this user's decision. */
const inbox = (actor, query) =>
  listRequests(
    { status: "PENDING", currentApproverIds: { has: actor.userId } },
    { ...query, status: undefined },
  );

/** Requests this user submitted. */
const mine = (actor, query) => listRequests({ requestedById: actor.userId }, query);

/** Every request inside the actor's approval.view scope. */
const list = ({ actor, scope }, query) =>
  listRequests(buildScopeWhere(actor, scope, SCOPE_FIELDS), query);

/** Number of requests waiting for this user (sidebar badge). */
const inboxCount = async (actor) => ({
  count: await prisma.approvalRequest.count({
    where: { status: "PENDING", currentApproverIds: { has: actor.userId } },
  }),
});

const getById = async (actor, id) => {
  const request = await prisma.approvalRequest.findUnique({
    where: { id },
    select: requestDetailSelect,
  });
  if (!request || !canView(actor, request)) throw AppError.notFound("Approval request not found");

  const approvers = await prisma.user.findMany({
    where: { id: { in: request.currentApproverIds } },
    select: { id: true, username: true, employee: { select: { fullName: true } } },
  });
  const pending = request.status === "PENDING";
  const { steps: _steps, actions, requestedBy, ...fields } = request;
  return {
    ...Object.fromEntries(Object.entries(fields).filter(([key]) => !INTERNAL_FIELDS.includes(key))),
    requestedBy: userDto(requestedBy),
    currentStep: currentStep(request),
    steps: stepStates(request),
    currentApprovers: approvers.map(userDto),
    actions: actions.map(({ actor: user, ...action }) => ({ ...action, actor: userDto(user) })),
    canDecide:
      pending &&
      request.requestedById !== actor.userId &&
      (request.currentApproverIds.includes(actor.userId) || actor.isSuperAdmin),
    canCancel: pending && (request.requestedById === actor.userId || actor.isSuperAdmin),
  };
};

const approve = async (actor, id, { comment }) => {
  await prisma.$transaction((tx) => decide(tx, actor, id, { decision: "APPROVED", comment }));
  return getById(actor, id);
};

const reject = async (actor, id, { comment }) => {
  await prisma.$transaction((tx) => decide(tx, actor, id, { decision: "REJECTED", comment }));
  return getById(actor, id);
};

const cancel = async (actor, id, { comment }) => {
  await prisma.$transaction((tx) => cancelApproval(tx, actor, id, { comment }));
  return getById(actor, id);
};

// ---- Workflows (approval chains) ----

const toWorkflowDto = ({ steps, ...workflow }) => ({
  ...workflow,
  steps: steps.map(({ approverUser, ...step }) => ({
    ...step,
    approverUser: userDto(approverUser),
  })),
});

const listWorkflows = async () =>
  (
    await prisma.approvalWorkflow.findMany({ orderBy: { name: "asc" }, select: workflowSelect })
  ).map(toWorkflowDto);

const findWorkflow = async (id) => {
  const workflow = await prisma.approvalWorkflow.findUnique({
    where: { id },
    select: workflowSelect,
  });
  if (!workflow) throw AppError.notFound("Approval workflow not found");
  return toWorkflowDto(workflow);
};

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

async function checkApprovers(steps) {
  const roleIds = [...new Set(steps.map((s) => s.approverRoleId).filter(Boolean))];
  const userIds = [...new Set(steps.map((s) => s.approverUserId).filter(Boolean))];
  const [roles, users] = await Promise.all([
    prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } }),
    prisma.user.findMany({
      where: { id: { in: userIds }, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    }),
  ]);
  const known = new Set([...roles, ...users].map((row) => row.id));
  steps.forEach((step, index) => {
    if (step.approverType === "ROLE" && !known.has(step.approverRoleId)) {
      throw invalid(`steps.${index}.approverRoleId`, "Role not found");
    }
    if (step.approverType === "USER" && !known.has(step.approverUserId)) {
      throw invalid(`steps.${index}.approverUserId`, "Choose an active user");
    }
  });
}

/** One line per step, for the audit log: "1. Team Leader (team leader, ≤ 2%)". */
const describeChain = (steps) =>
  steps.map((step, index) => {
    const who = {
      ROLE: step.approverRole?.name ?? "role",
      TEAM_LEADER: "team leader",
      REPORTING_MANAGER: "reporting manager",
      DEPARTMENT_HEAD: "department head",
      USER: step.approverUser?.name ?? "user",
    }[step.approverType];
    const limits = [
      step.maxPercent != null && `≤ ${step.maxPercent}%`,
      step.maxAmount != null && `≤ ৳${step.maxAmount}`,
    ].filter(Boolean);
    return `${index + 1}. ${step.name} (${[who, ...limits].join(", ")})`;
  });

/**
 * Edits a workflow. `steps` replaces the whole chain; requests already in flight keep the chain
 * they were submitted with.
 */
const updateWorkflow = async (actor, id, { steps, ...fields }) => {
  const before = await findWorkflow(id);
  if (steps) await checkApprovers(steps);

  await prisma.$transaction(async (tx) => {
    if (Object.keys(fields).length) {
      await tx.approvalWorkflow.update({
        where: { id },
        data: { ...fields, updatedById: actor.userId },
      });
    }
    if (steps) {
      await tx.approvalStep.deleteMany({ where: { workflowId: id } });
      await tx.approvalStep.createMany({
        data: steps.map((step, index) => ({
          workflowId: id,
          stepOrder: index + 1,
          name: step.name,
          approverType: step.approverType,
          approverRoleId: step.approverType === "ROLE" ? step.approverRoleId : null,
          approverUserId: step.approverType === "USER" ? step.approverUserId : null,
          sameBranch: step.approverType === "ROLE" ? (step.sameBranch ?? false) : false,
          maxAmount: step.maxAmount ?? null,
          maxPercent: step.maxPercent ?? null,
        })),
      });
      await tx.approvalWorkflow.update({ where: { id }, data: { updatedById: actor.userId } });
    }
  });

  const after = await findWorkflow(id);
  if (steps) {
    await recordAudit({
      action: "APPROVAL_CHAIN_CHANGED",
      entityType: "ApprovalWorkflow",
      entityId: id,
      description: `Changed the approval chain for ${after.name}`,
      oldValues: { steps: describeChain(before.steps) },
      newValues: { steps: describeChain(after.steps) },
    });
  }
  return after;
};

export const ApprovalService = {
  inbox,
  inboxCount,
  mine,
  list,
  getById,
  approve,
  reject,
  cancel,
  listWorkflows,
  findWorkflow,
  updateWorkflow,
};
