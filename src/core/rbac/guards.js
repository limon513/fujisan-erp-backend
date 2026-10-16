import AppError from "#core/errors/AppError.js";
import { compareScope } from "./scope.js";

/**
 * Hierarchy guard: you can only manage roles (and users holding them) strictly below your own
 * role level. Super Admin passes; protecting the Super Admin role itself is up to the caller.
 */
export function assertCanManageLevel(actor, level, what = "this role") {
  if (actor.isSuperAdmin) return;
  if (level >= actor.roleLevel) {
    throw AppError.forbidden(`You can only manage ${what} if it is below your own role level`);
  }
}

/**
 * Escalation guard for permission assignment: a non-Super-Admin may only grant permissions they
 * hold themselves, with a scope no broader than their own.
 * @param {{ key: string, scope: string }[]} grants
 */
export function assertCanGrant(actor, grants) {
  if (actor.isSuperAdmin) return;
  const problems = grants
    .filter(({ key, scope }) => {
      const own = actor.permissions[key];
      return !own || compareScope(scope, own) > 0;
    })
    .map(({ key }) => ({ path: key, message: "You can't grant more access than you have" }));
  if (problems.length) {
    throw AppError.forbidden("You can't grant permissions beyond your own access", problems);
  }
}
