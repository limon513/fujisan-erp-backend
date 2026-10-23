import { z } from "zod";
import { listQuerySchema } from "#core/utils/listQuery.js";
import { optionalText } from "#core/utils/validators.js";
import {
  APPROVAL_STATUSES,
  APPROVER_TYPES,
  MAX_STEPS,
  sortableFields,
} from "./approval.constant.js";

const idParams = z.object({ id: z.uuid() });

const optionalLimit = (max, label) =>
  z.preprocess(
    (value) => (value === "" ? null : value),
    z.coerce
      .number({ error: `Enter ${label}` })
      .min(0)
      .max(max)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
        message: "At most 2 decimals",
      })
      .nullable()
      .optional(),
  );

const step = z
  .object({
    name: z.string().trim().min(2).max(60).meta({ example: "Sales Manager" }),
    approverType: z.enum(APPROVER_TYPES),
    approverRoleId: z.uuid().nullable().optional(),
    approverUserId: z.uuid().nullable().optional(),
    sameBranch: z.boolean().optional(),
    maxAmount: optionalLimit(1_000_000_000_000, "an amount").meta({
      description: "This step is the last one needed when the amount is at most this (BDT)",
    }),
    maxPercent: optionalLimit(100, "a percentage").meta({
      description: "This step is the last one needed when the percentage is at most this",
      example: 5,
    }),
  })
  .superRefine((value, ctx) => {
    if (value.approverType === "ROLE" && !value.approverRoleId) {
      ctx.addIssue({ code: "custom", path: ["approverRoleId"], message: "Choose a role" });
    }
    if (value.approverType === "USER" && !value.approverUserId) {
      ctx.addIssue({ code: "custom", path: ["approverUserId"], message: "Choose a user" });
    }
  });

const updateWorkflow = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: optionalText(300),
    isActive: z.boolean().meta({ description: "When off, requests are approved immediately" }),
    steps: z.array(step).max(MAX_STEPS, `At most ${MAX_STEPS} steps`),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const list = listQuerySchema({
  sortable: sortableFields,
  filters: {
    status: z.enum(APPROVAL_STATUSES).optional(),
    workflow: z.string().trim().min(1).optional().meta({ description: "Workflow code" }),
  },
});

const approve = z.object({ comment: optionalText(500) });
const reject = z.object({ comment: z.string().trim().min(3, "Say why").max(500) });
const cancel = z.object({ comment: optionalText(500) });

export const ApprovalValidation = { idParams, list, updateWorkflow, approve, reject, cancel };
