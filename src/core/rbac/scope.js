import AppError from "#core/errors/AppError.js";

export const SCOPE_ORDER = ["OWN", "TEAM", "DEPARTMENT", "BRANCH", "ALL"];

/** Compares scopes: positive when a is broader than b. */
export const compareScope = (a, b) => SCOPE_ORDER.indexOf(a) - SCOPE_ORDER.indexOf(b);

// Prisma filter that matches nothing
const NOTHING = { id: { in: [] } };

const DEFAULT_FIELDS = {
  owner: "ownerId",
  team: "teamId",
  department: "departmentId",
  branch: "branchId",
};

/**
 * Turns a data scope into a Prisma `where` fragment for scoped records (leads, customers,
 * bookings, ...). Those tables store ownerId/teamId/departmentId/branchId at creation time.
 *
 *   const where = { ...searchWhere, ...buildScopeWhere(actor, req.access.scope) };
 *
 * Map fields when a model names them differently, e.g. for Employee:
 *   buildScopeWhere(actor, scope, { owner: "id" })
 *
 * - TEAM also includes the actor's own records (a member without a team still sees their own).
 * - An actor missing the needed org link (e.g. no employee record for OWN) sees nothing.
 */
export function buildScopeWhere(actor, scope, fieldOverrides = {}) {
  if (!actor) throw AppError.unauthorized();
  if (actor.isSuperAdmin || scope === "ALL") return {};

  const fields = { ...DEFAULT_FIELDS, ...fieldOverrides };
  const own = actor.employeeId ? { [fields.owner]: actor.employeeId } : null;

  switch (scope) {
    case "OWN":
      return own ?? NOTHING;
    case "TEAM": {
      const conditions = [
        actor.teamIds.length ? { [fields.team]: { in: actor.teamIds } } : null,
        own,
      ].filter(Boolean);
      return conditions.length ? { OR: conditions } : NOTHING;
    }
    case "DEPARTMENT":
      return actor.departmentId ? { [fields.department]: actor.departmentId } : NOTHING;
    case "BRANCH":
      return actor.branchId ? { [fields.branch]: actor.branchId } : NOTHING;
    default:
      return NOTHING;
  }
}

/**
 * Does a plain record (e.g. the employee being created) fall inside the actor's scope?
 * Same rules as buildScopeWhere, evaluated in memory.
 */
export function isInScope(actor, scope, record, fieldOverrides = {}) {
  if (actor.isSuperAdmin || scope === "ALL") return true;
  const f = { ...DEFAULT_FIELDS, ...fieldOverrides };
  const own = Boolean(actor.employeeId) && record[f.owner] === actor.employeeId;
  switch (scope) {
    case "OWN":
      return own;
    case "TEAM":
      return own || (record[f.team] != null && actor.teamIds.includes(record[f.team]));
    case "DEPARTMENT":
      return Boolean(actor.departmentId) && record[f.department] === actor.departmentId;
    case "BRANCH":
      return Boolean(actor.branchId) && record[f.branch] === actor.branchId;
    default:
      return false;
  }
}

/** Throws 403 unless the record is inside the actor's scope. */
export function assertInScope(actor, scope, record, fieldOverrides) {
  if (!isInScope(actor, scope, record, fieldOverrides)) {
    throw AppError.forbidden("This record is outside your access scope");
  }
}

/** Org fields to stamp on a new scoped record so scope filters can find it later. */
export const ownershipFields = (actor) => ({
  ownerId: actor.employeeId,
  teamId: actor.teamIds[0] ?? null,
  departmentId: actor.departmentId,
  branchId: actor.branchId,
});
