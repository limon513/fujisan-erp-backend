import { leadStamp, logActivity, moveOpenWork, notifyEmployee } from "./lead.workflow.js";

/**
 * Automatic lead assignment (blueprint §6: round robin, team-, project- and location-wise).
 * A rule's conditions that are set must all match; its pool gets the leads in turn.
 */

const matches = (rule, lead) => {
  if (rule.sourceId && rule.sourceId !== lead.sourceId) return false;
  if (rule.projectId && rule.projectId !== lead.preferredProjectId) return false;
  if (rule.locationKeywords.length) {
    const location = (lead.location ?? "").toLowerCase();
    if (!rule.locationKeywords.some((word) => location.includes(word.toLowerCase()))) return false;
  }
  return true;
};

const poolSelect = { id: true, fullName: true, teamId: true, departmentId: true, branchId: true };

/** Active employees of the rule's pool, in a stable order (team: by name; list: as chosen). */
export async function rulePool(tx, rule) {
  if (rule.poolType === "TEAM") {
    return tx.employee.findMany({
      where: { teamId: rule.teamId, deletedAt: null, employmentStatus: "ACTIVE" },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      select: poolSelect,
    });
  }
  const people = await tx.employee.findMany({
    where: { id: { in: rule.employeeIds }, deletedAt: null, employmentStatus: "ACTIVE" },
    select: poolSelect,
  });
  return rule.employeeIds.map((id) => people.find((p) => p.id === id)).filter(Boolean);
}

/**
 * Assigns an unassigned lead by the first matching active rule. Returns { rule, owner } or null
 * (no rule matched or every matching pool is empty: the lead stays in the pool).
 * The rule row is locked while its round-robin position moves, so parallel leads never collide.
 */
export async function autoAssign(tx, lead, actor) {
  const rules = await tx.leadAssignmentRule.findMany({
    where: { isActive: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  for (const rule of rules) {
    if (!matches(rule, lead)) continue;
    const pool = await rulePool(tx, rule);
    if (!pool.length) continue;

    const [locked] = await tx.$queryRaw`
      SELECT "nextIndex" FROM "LeadAssignmentRule" WHERE id = ${rule.id}::uuid FOR UPDATE`;
    const owner = pool[locked.nextIndex % pool.length];
    await tx.leadAssignmentRule.update({
      where: { id: rule.id },
      data: {
        nextIndex: (locked.nextIndex + 1) % pool.length,
        assignedCount: { increment: 1 },
        lastAssignedAt: new Date(),
      },
    });

    const stamp = {
      ownerId: owner.id,
      teamId: owner.teamId,
      departmentId: owner.departmentId,
      branchId: owner.branchId,
    };
    const updated = await tx.lead.update({
      where: { id: lead.id },
      data: { ...stamp, assignedAt: new Date() },
    });
    await moveOpenWork(tx, lead.id, leadStamp(updated));
    await logActivity(tx, lead.id, null, {
      type: "ASSIGNMENT",
      body: `Assigned by rule "${rule.name}"`,
      data: { from: null, to: owner.fullName, ruleId: rule.id },
    });
    await notifyEmployee(tx, actor, owner.id, {
      type: "LEAD_ASSIGNED",
      title: `New lead: ${updated.fullName}`,
      body: `${updated.leadCode} · by rule "${rule.name}"`,
      link: `/crm/leads/${lead.id}`,
    });
    return { rule, owner };
  }
  return null;
}
