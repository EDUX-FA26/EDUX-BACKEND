
"use strict";

const VALID_SCHOOL_ROLES = new Set([
  "school_admin",
  "lecturer",
  "student",
]);

function authorizeSchoolRoles(...allowedRoles) {
  if (
    allowedRoles.length === 0 ||
    allowedRoles.some(
      (role) => !VALID_SCHOOL_ROLES.has(role)
    )
  ) {
    throw new Error(
      "authorizeSchoolRoles: invalid allowed roles"
    );
  }

  return function schoolRoleMiddleware(req, res, next) {
    // requireSchoolContext must run first.

    if (!req.user?.id || !req.tenant) {
      return res.status(401).json({
        success: false,
        code: "SCHOOL_CONTEXT_REQUIRED",
        message: "Authenticated school context required",
      });
    }

    const { schoolId, userId, role } = req.tenant;

    if (
      !schoolId ||
      !userId ||
      userId !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        code: "INVALID_TENANT_CONTEXT",
        message: "Invalid school context",
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        success: false,
        code: "INSUFFICIENT_SCHOOL_ROLE",
        message: "Insufficient school permissions",
      });
    }

    return next();
  };
}

module.exports = {
  authorizeSchoolRoles,
};
