"use strict";

const { pool } = require("../config/db.config");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Middleware verify user has active platform permission (Superadmin or Manager).
 * Must be preceded by `authenticate` middleware.
 */
async function requirePlatformAdmin(req, res, next) {
  try {
    const userId = req.user?.id;

    if (typeof userId !== "string" || !UUID_REGEX.test(userId)) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.role AS user_role,
        pa.role AS platform_role,
        pa.is_active AS platform_is_active
      FROM public.users u
      LEFT JOIN public.platform_admins pa
        ON pa.user_id = u.id AND pa.is_active = TRUE
      WHERE u.id = $1 AND u.is_active = TRUE
      LIMIT 1
      `,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({
        success: false,
        code: "PLATFORM_ACCESS_DENIED",
        message: "Platform administrator access required",
      });
    }

    // Determine platform role:
    // 1. From platform_admins if active
    // 2. Fallback to users.role if it's 'superadmin' or 'manager'
    const role =
      rows[0].platform_role ||
      (["superadmin", "manager"].includes(rows[0].user_role)
        ? rows[0].user_role
        : null);

    if (!role) {
      return res.status(403).json({
        success: false,
        code: "PLATFORM_ACCESS_DENIED",
        message: "Platform administrator access required",
      });
    }

    req.platformAdmin = Object.freeze({
      userId: rows[0].user_id,
      role,
    });

    return next();
  } catch (error) {
    console.error("[PlatformAdmin] Authorization failed:", error);
    return res.status(500).json({
      success: false,
      code: "PLATFORM_AUTHORIZATION_ERROR",
      message: "Unable to verify platform permissions",
    });
  }
}

/**
 * Middleware requiring strictly 'superadmin' role.
 */
function requireSuperAdmin(req, res, next) {
  if (!req.platformAdmin) {
    return res.status(401).json({
      success: false,
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
  }

  if (req.platformAdmin.role !== "superadmin") {
    return res.status(403).json({
      success: false,
      code: "SUPERADMIN_ACCESS_REQUIRED",
      message: "Superadmin privileges are required for this action",
    });
  }

  return next();
}

/**
 * Middleware requiring one of allowed platform roles (e.g. 'superadmin', 'manager').
 */
function requirePlatformRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.platformAdmin) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }

    const role = req.platformAdmin.role;
    // Superadmin has universal platform access, or role must be explicitly allowed
    if (role === "superadmin" || allowedRoles.includes(role)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: "PLATFORM_FORBIDDEN",
      message: `Requires one of roles: ${allowedRoles.join(", ")}`,
    });

    return next();
  };
}

module.exports = {
  requirePlatformAdmin,
  requireSuperAdmin,
  requirePlatformRoles,
};
