/**
 * Creates the approval workflows that modules declare (manifest `approvalWorkflows`), with
 * the client's default chain from `approvalChains`. Existing workflows keep the chain edited in the
 * app; only their name/description follow the code.
 */
export async function syncApprovalWorkflows(tx, { modules, chains = {} }) {
  const summary = { created: 0 };
  const roles = new Map(
    (await tx.role.findMany({ select: { id: true, slug: true } })).map((r) => [r.slug, r.id]),
  );

  for (const module of modules) {
    for (const { code, name, description = null } of module.approvalWorkflows ?? []) {
      const existing = await tx.approvalWorkflow.findUnique({ where: { code } });
      if (existing) {
        if (existing.name !== name || existing.description !== description) {
          await tx.approvalWorkflow.update({ where: { code }, data: { name, description } });
        }
        continue;
      }

      const steps = (chains[code] ?? []).map(({ role, ...step }, index) => {
        if (role && !roles.has(role))
          throw new Error(`Approval chain ${code}: unknown role "${role}"`);
        return { ...step, stepOrder: index + 1, approverRoleId: role ? roles.get(role) : null };
      });
      await tx.approvalWorkflow.create({
        data: { code, name, description, module: module.name, steps: { create: steps } },
      });
      summary.created += 1;
    }
  }
  return summary;
}
