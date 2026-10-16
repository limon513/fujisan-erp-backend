import AppError from "#core/errors/AppError.js";

/**
 * Requires a permission (after `authenticate`). Sets `req.access = { permission, scope }`, where
 * scope is the data scope granted for it (Super Admin always gets ALL).
 *
 *   router.get("/", authenticate, authorize("lead.view"), LeadController.list)
 *
 * With several keys the first one the actor holds is used:
 *   authorize(["booking.approve", "booking.edit"])
 */
export function authorize(permission) {
  const keys = Array.isArray(permission) ? permission : [permission];

  return (req, _res, next) => {
    const { actor } = req;
    if (!actor) throw AppError.unauthorized();

    if (actor.isSuperAdmin) {
      req.access = { permission: keys[0], scope: "ALL" };
      return next();
    }

    const key = keys.find((candidate) => actor.permissions[candidate]);
    if (!key) throw AppError.forbidden();

    req.access = { permission: key, scope: actor.permissions[key] };
    next();
  };
}

/** True when the actor holds the permission (for conditional logic inside services). */
export const can = (actor, permission) =>
  Boolean(actor?.isSuperAdmin || actor?.permissions?.[permission]);
