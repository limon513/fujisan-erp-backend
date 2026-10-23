import AppError from "#core/errors/AppError.js";
import { recordAudit } from "#core/audit/audit.service.js";
import { SUPER_ADMIN_ROLE } from "#core/auth/actor.js";
import { nextCode } from "#core/numbering/sequence.js";
import { approvalHandlers } from "./handlers.js";

/**
 * Approval engine (docs/02-architecture.md §6).
 *
 * A request walks its workflow's steps in order. Each step's approvers are resolved from the
 * requester's place in the organisation when the step starts. Steps with amount/percent limits end
 * the chain early: a 3% discount with "Team Leader ≤ 2%, Sales Manager ≤ 5%, Director" needs the
 * Team Leader and the Sales Manager only.
 *
 * - A step nobody can approve (no team leader, nobody in the role) is skipped; if that leaves the
 *   chain without an approver, it escalates to the Super Admins.
 * - A step whose only approvers already approved an earlier step counts as approved.
 * - Nobody approves their own request.
 *
 * Business modules call `submitApproval(tx, actor, ...)` inside their own transaction and react in
 * handlers (handlers.js).
 */

const SEQUENCE = { key: "APPROVAL", prefix: "APR-", padding: 6 };

const userName = (user) => user?.employee?.fullName ?? user?.username ?? null;
const userNameSelect = { id: true, username: true, employee: { select: { fullName: true } } };

/** Users who may act as approvers: active accounts of active employees (or non-employee admins). */
const ACTIVE_USER = {
  status: "ACTIVE",
  deletedAt: null,
  OR: [{ employeeId: null }, { employee: { employmentStatus: "ACTIVE", deletedAt: null } }],
};

/** Can the chain end at this step? Only a step with limits that the request fits; others always pass it on. */
export function stepCovers(step, { amount, percent }) {
  const limits = [
    [step.maxAmount, amount],
    [step.maxPercent, percent],
  ].filter(([limit]) => limit != null);
  if (!limits.length) return false;
  // A limit on a value the request doesn't carry can't be checked: go further up
  return limits.every(([limit, value]) => value != null && Number(value) <= Number(limit));
}

/** Last step the request needs: the first one whose limits cover it, else the last step. */
export const finalStepFor = (steps, values) =>
  (steps.find((step) => stepCovers(step, values)) ?? steps.at(-1)).stepOrder;

const decimalText = (value) => (value == null ? null : String(value));

/** Workflow steps frozen into the request, with display names for the timeline. */
const snapshotSteps = (steps) =>
  steps.map((step) => ({
    stepOrder: step.stepOrder,
    name: step.name,
    approverType: step.approverType,
    approverRoleId: step.approverRoleId,
    approverRoleName: step.approverRole?.name ?? null,
    approverUserId: step.approverUserId,
    approverUserName: userName(step.approverUser),
    sameBranch: step.sameBranch,
    maxAmount: decimalText(step.maxAmount),
    maxPercent: decimalText(step.maxPercent),
  }));

/** Where the requester sits in the organisation now (used to resolve approvers). */
async function requesterContext(tx, request) {
  const employee = request.requesterEmployeeId
    ? await tx.employee.findUnique({
        where: { id: request.requesterEmployeeId },
        select: {
          branchId: true,
          reportingManagerId: true,
          team: { select: { leaderId: true, deletedAt: true } },
          department: { select: { headId: true } },
        },
      })
    : null;
  return {
    requestedById: request.requestedById,
    branchId: employee?.branchId ?? request.branchId ?? null,
    teamLeaderId: employee?.team && !employee.team.deletedAt ? employee.team.leaderId : null,
    reportingManagerId: employee?.reportingManagerId ?? null,
    departmentHeadId: employee?.department?.headId ?? null,
  };
}

async function usersOfEmployee(tx, employeeId) {
  if (!employeeId) return [];
  return tx.user.findMany({ where: { AND: [ACTIVE_USER, { employeeId }] }, select: { id: true } });
}

/** User ids who can approve `step` for this requester (never the requester). */
async function resolveApprovers(tx, step, context) {
  let users;
  switch (step.approverType) {
    case "ROLE":
      users = await tx.user.findMany({
        where: {
          AND: [
            ACTIVE_USER,
            { roleId: step.approverRoleId },
            step.sameBranch && context.branchId ? { employee: { branchId: context.branchId } } : {},
          ],
        },
        select: { id: true },
      });
      break;
    case "TEAM_LEADER":
      users = await usersOfEmployee(tx, context.teamLeaderId);
      break;
    case "REPORTING_MANAGER":
      users = await usersOfEmployee(tx, context.reportingManagerId);
      break;
    case "DEPARTMENT_HEAD":
      users = await usersOfEmployee(tx, context.departmentHeadId);
      break;
    case "USER":
      users = await tx.user.findMany({
        where: { AND: [ACTIVE_USER, { id: step.approverUserId }] },
        select: { id: true },
      });
      break;
    default:
      users = [];
  }
  return users.map((user) => user.id).filter((id) => id !== context.requestedById);
}

/**
 * Finds the next step that needs someone's decision, after `afterOrder`.
 * Returns { done: true } when the chain is complete, or { stepOrder, approverIds }, plus the steps
 * passed over on the way (and the chain, with a Super Admin step added when it had to escalate).
 */
async function advance(tx, { steps, finalStepOrder, context, approvedBy, afterOrder }) {
  const skipped = [];
  for (const step of steps.filter((s) => s.stepOrder > afterOrder)) {
    const approverIds = await resolveApprovers(tx, step, context);
    if (!approverIds.length) {
      skipped.push({
        stepOrder: step.stepOrder,
        comment: `Nobody available to approve as ${step.name}`,
      });
      continue;
    }
    if (approverIds.every((id) => approvedBy.has(id))) {
      skipped.push({ stepOrder: step.stepOrder, comment: "Already approved at an earlier step" });
      if (step.stepOrder >= finalStepOrder) return { done: true, skipped, steps };
      continue;
    }
    return { done: false, stepOrder: step.stepOrder, approverIds, skipped, steps };
  }

  // Nobody left in the chain: escalate to the Super Admins
  const superAdmins = await tx.user.findMany({
    where: { AND: [ACTIVE_USER, { role: { slug: SUPER_ADMIN_ROLE } }] },
    select: { id: true },
  });
  const approverIds = superAdmins.map((u) => u.id).filter((id) => id !== context.requestedById);
  if (!approverIds.length) {
    throw AppError.unprocessable(
      "Nobody can approve this request. Ask an administrator to check the approval chain.",
    );
  }
  const stepOrder = Math.max(0, ...steps.map((s) => s.stepOrder)) + 1;
  return {
    done: false,
    stepOrder,
    approverIds,
    skipped,
    steps: [
      ...steps,
      {
        stepOrder,
        name: "Super Admin (escalated)",
        approverType: "ROLE",
        approverRoleId: null,
        approverRoleName: "Super Admin",
        approverUserId: null,
        approverUserName: null,
        sameBranch: false,
        maxAmount: null,
        maxPercent: null,
        escalated: true,
      },
    ],
  };
}

async function notify(tx, userIds, { type, title, body, link }) {
  if (!userIds.length) return;
  await tx.notification.createMany({
    data: userIds.map((userId) => ({ userId, type, title, body, link })),
  });
}

const requestLink = (request) => `/approvals/${request.id}`;

async function notifyApprovers(tx, request, requesterName) {
  await notify(tx, request.currentApproverIds, {
    type: "APPROVAL_PENDING",
    title: `Approval needed: ${request.title}`,
    body: `${request.requestNo} from ${requesterName}`,
    link: requestLink(request),
  });
}

async function finish(tx, request, status, { comment } = {}) {
  const completed = await tx.approvalRequest.update({
    where: { id: request.id },
    data: { status, completedAt: new Date(), currentApproverIds: [] },
    include: { workflow: { select: { code: true, name: true } } },
  });
  const handler = approvalHandlers(completed.workflow.code);
  const hook = {
    APPROVED: handler.onApproved,
    REJECTED: handler.onRejected,
    CANCELLED: handler.onCancelled,
  }[status];
  if (hook) await hook(tx, completed);

  if (status !== "CANCELLED") {
    await notify(tx, [completed.requestedById], {
      type: `APPROVAL_${status}`,
      title: `${completed.workflow.name} ${status.toLowerCase()}: ${completed.title}`,
      body: comment ?? completed.requestNo,
      link: requestLink(completed),
    });
  }
  return completed;
}

/**
 * Starts an approval. Call inside the business module's transaction.
 *
 * @param {object} tx      transaction client
 * @param {object} actor   the requester (req.actor)
 * @param {object} input   { workflow: code, entityType, entityId, title, summary?, link?,
 *                           amount?, percent?, snapshot? }
 * @returns the request; `status` is APPROVED right away when the workflow is switched off or empty
 */
export async function submitApproval(tx, actor, input) {
  const workflow = await tx.approvalWorkflow.findUnique({
    where: { code: input.workflow },
    include: {
      steps: {
        orderBy: { stepOrder: "asc" },
        include: {
          approverRole: { select: { name: true } },
          approverUser: { select: userNameSelect },
        },
      },
    },
  });
  if (!workflow)
    throw new Error(`Approval workflow ${input.workflow} is not set up (run the seed)`);
  const pending = await pendingApprovalFor(tx, input);
  if (pending) {
    throw AppError.conflict(`This is already waiting for approval (${pending.requestNo})`);
  }

  const employee = actor.employeeId
    ? await tx.employee.findUnique({
        where: { id: actor.employeeId },
        select: { teamId: true, departmentId: true, branchId: true, fullName: true },
      })
    : null;
  const requesterName = employee?.fullName ?? actor.username;
  const values = { amount: input.amount ?? null, percent: input.percent ?? null };
  const base = {
    requestNo: await nextCode(tx, SEQUENCE),
    workflowId: workflow.id,
    entityType: input.entityType,
    entityId: String(input.entityId),
    title: input.title,
    summary: input.summary ?? null,
    link: input.link ?? null,
    amount: values.amount,
    percent: values.percent,
    snapshot: input.snapshot ?? undefined,
    requestedById: actor.userId,
    requesterEmployeeId: actor.employeeId,
    teamId: employee?.teamId ?? null,
    departmentId: employee?.departmentId ?? null,
    branchId: employee?.branchId ?? null,
  };

  let request;
  if (!workflow.isActive || !workflow.steps.length) {
    request = await tx.approvalRequest.create({
      data: {
        ...base,
        status: "APPROVED",
        steps: [],
        finalStepOrder: 0,
        actions: {
          create: [
            { actorId: actor.userId, decision: "SUBMITTED" },
            { decision: "APPROVED", comment: "No approval needed (approval is switched off)" },
          ],
        },
      },
    });
    request = await finish(tx, request, "APPROVED");
  } else {
    const steps = snapshotSteps(workflow.steps);
    const finalStepOrder = finalStepFor(steps, values);
    const context = await requesterContext(tx, base);
    const next = await advance(tx, {
      steps,
      finalStepOrder,
      context,
      approvedBy: new Set(),
      afterOrder: 0,
    });
    request = await tx.approvalRequest.create({
      data: {
        ...base,
        steps: next.steps,
        finalStepOrder,
        currentStepOrder: next.stepOrder,
        currentApproverIds: next.approverIds,
        actions: {
          create: [
            { actorId: actor.userId, decision: "SUBMITTED" },
            ...next.skipped.map((s) => ({ ...s, decision: "SKIPPED" })),
          ],
        },
      },
    });
    await notifyApprovers(tx, request, requesterName);
  }

  await recordAudit(
    {
      action: "APPROVAL_SUBMITTED",
      entityType: request.entityType,
      entityId: request.entityId,
      description: `Submitted ${request.requestNo} for ${workflow.name.toLowerCase()}: ${request.title}`,
    },
    tx,
  );
  return request;
}

/** Locks a pending request for a decision. */
async function lockPending(tx, id) {
  await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${id}::uuid FOR UPDATE`;
  const request = await tx.approvalRequest.findUnique({
    where: { id },
    include: {
      workflow: { select: { code: true, name: true } },
      actions: { where: { decision: "APPROVED" }, select: { actorId: true } },
      requestedBy: { select: userNameSelect },
    },
  });
  if (!request) throw AppError.notFound("Approval request not found");
  if (request.status !== "PENDING") {
    throw AppError.conflict(`This request is already ${request.status.toLowerCase()}`);
  }
  return request;
}

const stepName = (request, order) =>
  request.steps.find((step) => step.stepOrder === order)?.name ?? `step ${order}`;

/** Approve or reject the current step. Super Admins may act on any step. */
export async function decide(tx, actor, id, { decision, comment }) {
  const request = await lockPending(tx, id);
  if (request.requestedById === actor.userId) {
    throw AppError.forbidden("You can't decide on your own request");
  }
  if (!request.currentApproverIds.includes(actor.userId) && !actor.isSuperAdmin) {
    throw AppError.forbidden("This request is waiting for someone else");
  }

  const stepOrder = request.currentStepOrder;
  const step = stepName(request, stepOrder);
  await tx.approvalAction.create({
    data: { requestId: id, stepOrder, actorId: actor.userId, decision, comment: comment ?? null },
  });
  await recordAudit(
    {
      action: decision === "APPROVED" ? "APPROVE" : "REJECT",
      entityType: request.entityType,
      entityId: request.entityId,
      description: `${decision === "APPROVED" ? "Approved" : "Rejected"} ${request.requestNo} as ${step}${comment ? `: ${comment}` : ""}`,
    },
    tx,
  );

  if (decision === "REJECTED") return finish(tx, request, "REJECTED", { comment });
  if (stepOrder >= request.finalStepOrder) return finish(tx, request, "APPROVED");

  const next = await advance(tx, {
    steps: request.steps,
    finalStepOrder: request.finalStepOrder,
    context: await requesterContext(tx, request),
    approvedBy: new Set([...request.actions.map((a) => a.actorId), actor.userId]),
    afterOrder: stepOrder,
  });
  if (next.skipped.length) {
    await tx.approvalAction.createMany({
      data: next.skipped.map((s) => ({ ...s, requestId: id, decision: "SKIPPED" })),
    });
  }
  if (next.done) return finish(tx, request, "APPROVED");

  const updated = await tx.approvalRequest.update({
    where: { id },
    data: {
      currentStepOrder: next.stepOrder,
      currentApproverIds: next.approverIds,
      steps: next.steps,
    },
  });
  await notifyApprovers(tx, updated, userName(request.requestedBy));
  return updated;
}

/** Withdraws a pending request: by its requester, a Super Admin, or the system (actor null). */
export async function cancelApproval(tx, actor, id, { comment } = {}) {
  const request = await lockPending(tx, id);
  if (actor && request.requestedById !== actor.userId && !actor.isSuperAdmin) {
    throw AppError.forbidden("Only the person who asked can withdraw this request");
  }
  await tx.approvalAction.create({
    data: {
      requestId: id,
      stepOrder: request.currentStepOrder,
      actorId: actor?.userId ?? null,
      decision: "CANCELLED",
      comment: comment ?? null,
    },
  });
  await recordAudit(
    {
      action: "APPROVAL_CANCELLED",
      entityType: request.entityType,
      entityId: request.entityId,
      description: `Withdrew ${request.requestNo}${comment ? `: ${comment}` : ""}`,
    },
    tx,
  );
  return finish(tx, request, "CANCELLED");
}

/** The pending request for a record, if any (e.g. to cancel it when the record is deleted). */
export const pendingApprovalFor = (tx, { workflow, entityType, entityId }) =>
  tx.approvalRequest.findFirst({
    where: {
      workflow: { code: workflow },
      entityType,
      entityId: String(entityId),
      status: "PENDING",
    },
  });
