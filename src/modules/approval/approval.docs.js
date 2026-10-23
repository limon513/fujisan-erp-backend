import { z } from "zod";
import { defineRoute } from "#core/docs/openapi.js";
import { APPROVAL_STATUSES, APPROVER_TYPES } from "./approval.constant.js";
import { ApprovalValidation as V } from "./approval.validation.js";

const tags = ["Approvals"];

const Person = z.object({ id: z.uuid(), name: z.string() });
const Status = z.enum(APPROVAL_STATUSES);

const ApprovalListItem = z
  .object({
    id: z.uuid(),
    requestNo: z.string().meta({ example: "APR-000001" }),
    title: z.string().meta({ example: "3% discount on plot A-5" }),
    summary: z.string().nullable(),
    link: z.string().nullable().meta({ description: "Frontend path of the record" }),
    amount: z.string().nullable(),
    percent: z.string().nullable(),
    status: Status,
    workflow: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
    requestedBy: Person,
    currentStep: z.object({ stepOrder: z.number().int(), name: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "ApprovalListItem" });

const ChainStep = z.object({
  stepOrder: z.number().int(),
  name: z.string(),
  approverType: z.enum(APPROVER_TYPES),
  approverRoleName: z.string().nullable(),
  approverUserName: z.string().nullable(),
  maxAmount: z.string().nullable(),
  maxPercent: z.string().nullable(),
  escalated: z.boolean().optional(),
  state: z.enum([
    "APPROVED",
    "REJECTED",
    "SKIPPED",
    "CURRENT",
    "WAITING",
    "NOT_NEEDED",
    "NOT_REACHED",
  ]),
});

const ApprovalRequest = ApprovalListItem.extend({
  entityType: z.string().meta({ example: "Booking" }),
  entityId: z.string(),
  snapshot: z.record(z.string(), z.unknown()).nullable(),
  finalStepOrder: z.number().int(),
  steps: z.array(ChainStep),
  currentApprovers: z.array(Person),
  actions: z.array(
    z.object({
      id: z.uuid(),
      stepOrder: z.number().int().nullable(),
      decision: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "CANCELLED", "SKIPPED"]),
      comment: z.string().nullable(),
      createdAt: z.iso.datetime(),
      actor: Person.nullable().meta({ description: "null for automatic steps" }),
    }),
  ),
  canDecide: z.boolean(),
  canCancel: z.boolean(),
}).meta({ id: "ApprovalRequest" });

const Workflow = z
  .object({
    id: z.uuid(),
    code: z.string().meta({ example: "DISCOUNT" }),
    name: z.string(),
    description: z.string().nullable(),
    module: z.string(),
    isActive: z.boolean(),
    updatedAt: z.iso.datetime(),
    steps: z.array(
      z.object({
        id: z.uuid(),
        stepOrder: z.number().int(),
        name: z.string(),
        approverType: z.enum(APPROVER_TYPES),
        sameBranch: z.boolean(),
        maxAmount: z.string().nullable(),
        maxPercent: z.string().nullable(),
        approverRole: z.object({ id: z.uuid(), name: z.string() }).nullable(),
        approverUser: Person.nullable(),
      }),
    ),
  })
  .meta({ id: "ApprovalWorkflow" });

const lists = [
  ["/approvals/inbox", "Requests waiting for my decision", "Any signed-in user."],
  ["/approvals/mine", "Requests I submitted", "Any signed-in user."],
  [
    "/approvals",
    "All approval requests",
    "Requires `approval.view`; follows its data scope (by the requester's place in the organisation).",
  ],
];
for (const [path, summary, description] of lists) {
  defineRoute({
    method: "get",
    path,
    tags,
    summary,
    description,
    request: { query: V.list },
    response: ApprovalListItem,
    paginated: true,
  });
}

defineRoute({
  method: "get",
  path: "/approvals/inbox/count",
  tags,
  summary: "How many requests are waiting for me",
  response: z.object({ count: z.number().int() }),
  errors: [401],
});

defineRoute({
  method: "get",
  path: "/approvals/:id",
  tags,
  summary: "Approval request with its chain and history",
  description:
    "Visible to the requester, its approvers (past and current) and holders of `approval.view` in scope.",
  request: { params: V.idParams },
  response: ApprovalRequest,
  errors: [400, 401, 404],
});

for (const [action, summary, description, body] of [
  [
    "approve",
    "Approve the current step",
    "Only the current step's approvers (or a Super Admin). Nobody approves their own request. The request moves to the next needed step or is approved.",
    V.approve,
  ],
  ["reject", "Reject the request", "Same approvers as approve. A comment is required.", V.reject],
  ["cancel", "Withdraw a pending request", "The requester or a Super Admin.", V.cancel],
]) {
  defineRoute({
    method: "post",
    path: `/approvals/:id/${action}`,
    tags,
    summary,
    description,
    request: { params: V.idParams, body },
    response: ApprovalRequest,
    errors: [400, 401, 403, 404, 409, 422],
  });
}

defineRoute({
  method: "get",
  path: "/approvals/workflows",
  tags,
  summary: "Approval chains, one per process",
  description: "Requires `approval-workflow.view`. Processes are declared by business modules.",
  response: z.array(Workflow),
});

defineRoute({
  method: "get",
  path: "/approvals/workflows/:id",
  tags,
  summary: "One approval chain",
  description: "Requires `approval-workflow.view`.",
  request: { params: V.idParams },
  response: Workflow,
  errors: [400, 401, 403, 404],
});

defineRoute({
  method: "patch",
  path: "/approvals/workflows/:id",
  tags,
  summary: "Edit an approval chain",
  description:
    "Requires `approval-workflow.edit`. `steps` replaces the whole chain, in order; requests already waiting keep the chain they were submitted with. A step with limits is the last one needed when the request fits them (e.g. Team Leader ≤ 2%, Sales Manager ≤ 5%, Director).",
  request: { params: V.idParams, body: V.updateWorkflow },
  response: Workflow,
  errors: [400, 401, 403, 404, 422],
});
