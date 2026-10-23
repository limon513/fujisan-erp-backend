import prisma from "#core/db/prisma.js";
import AppError from "#core/errors/AppError.js";
import { assertInScope, isInScope } from "#core/rbac/scope.js";
import { leadStamp } from "./lead.workflow.js";

const invalid = (path, message) => AppError.unprocessable(message, [{ path, message }]);

/**
 * The lead a follow-up or site visit is for: it must exist, still be open to work on, and be
 * inside the actor's scope for that action.
 */
export async function findLeadForWork({ actor, scope }, leadId) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      id: true,
      leadCode: true,
      fullName: true,
      status: true,
      ownerId: true,
      teamId: true,
      departmentId: true,
      branchId: true,
    },
  });
  if (!lead || !isInScope(actor, scope, leadStamp(lead))) {
    throw invalid("leadId", "Lead not found");
  }
  if (lead.status === "LOST") throw AppError.conflict("This lead is lost. Reopen it first.");
  return lead;
}

/**
 * Who does the work (+ their org stamp, for scope): the lead's assigned employee by default, or
 * another active employee inside the actor's scope.
 */
export async function resolveWorkOwner({ actor, scope }, lead, ownerId) {
  if (!ownerId || ownerId === lead.ownerId) return leadStamp(lead);
  const owner = await prisma.employee.findFirst({
    where: { id: ownerId, deletedAt: null, employmentStatus: "ACTIVE" },
    select: { id: true, teamId: true, departmentId: true, branchId: true },
  });
  if (!owner) throw invalid("ownerId", "Choose an active employee");
  const stamp = {
    ownerId: owner.id,
    teamId: owner.teamId,
    departmentId: owner.departmentId,
    branchId: owner.branchId,
  };
  assertInScope(actor, scope, stamp);
  return stamp;
}
