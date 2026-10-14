/**
 * Permission catalog helpers. Every module declares its permissions in its manifest:
 *
 *   permissions: definePermissions({
 *     module: "project",
 *     resource: "unit",
 *     label: "Plots / Units",
 *     actions: ["view", "create", "edit", "delete", "export"],
 *     extra: [{ action: "hold", label: "Hold / release plots" }],
 *   })
 *
 * `npm run db:seed` syncs the catalog into the Permission table.
 */

export const STANDARD_ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "print"];

const ACTION_LABELS = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export",
  print: "Print",
};

/**
 * @param {object} options
 * @param {string} options.module     module name (manifest `name`)
 * @param {string} [options.resource] permission key prefix (defaults to module)
 * @param {string} options.label      human label of the resource, e.g. "Branches"
 * @param {string[]} [options.actions]  standard actions to include
 * @param {{ action: string, label: string }[]} [options.extra]  custom actions
 * @param {boolean} [options.scoped]  whether data scope applies (OWN/TEAM/... vs. always ALL)
 */
export function definePermissions({
  module,
  resource = module,
  label,
  actions = ["view", "create", "edit", "delete"],
  extra = [],
  scoped = true,
}) {
  const unknown = actions.filter((action) => !STANDARD_ACTIONS.includes(action));
  if (unknown.length) {
    throw new Error(
      `Unknown standard action(s) for ${resource}: ${unknown.join(", ")} — use "extra"`,
    );
  }

  return [
    ...actions.map((action) => ({ action, label: `${label}: ${ACTION_LABELS[action]}` })),
    ...extra.map(({ action, label: actionLabel }) => ({
      action,
      label: `${label}: ${actionLabel}`,
    })),
  ].map(({ action, label: permissionLabel }, index) => ({
    key: `${resource}.${action}`,
    module,
    resource,
    action,
    label: permissionLabel,
    supportsScope: scoped,
    sortOrder: index,
  }));
}

/**
 * Does a permission key match a template pattern?
 *   "lead.view"  exact
 *   "lead.*"     every action on lead
 *   "*.view"     view on every resource
 *   "*"          everything
 */
export function matchesPattern(pattern, key) {
  if (pattern === "*") return true;
  const [patternResource, patternAction] = pattern.split(".");
  const [resource, action] = key.split(".");
  return (
    (patternResource === "*" || patternResource === resource) &&
    (patternAction === "*" || patternAction === action)
  );
}

/**
 * Resolve a role template (ordered [pattern, scope] rules; later rules win) for one permission.
 * Returns the scope to grant, or null when the template doesn't grant it.
 * Unscoped permissions are always granted with scope ALL.
 */
export function resolveTemplateScope(rules, permission) {
  let scope = null;
  for (const [pattern, ruleScope] of rules) {
    if (matchesPattern(pattern, permission.key)) scope = ruleScope;
  }
  if (scope && !permission.supportsScope) return "ALL";
  return scope;
}
