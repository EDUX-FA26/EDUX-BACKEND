
"use strict";

const { pool } = require("../config/db.config");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requirePlatformAdmin(req, res, next) {
  try {
    // authenticate middleware must run first.

    const userId = req.user?.id;

    if (
      typeof userId !== "string" ||
      !UUID_REGEX.test(userId)
    ) {
      return res.status(401).json({
        success: false,
        code: "UNAUTHENTICATED",
        message: "Authentication required",
      });
    }

    // Never trust req.user.role === "admin".
    // Platform permission comes only from DB.

    const { rows } = await pool.query(
      `
      SELECT pa.user_id
      FROM public.platform_admins pa
      WHERE pa.user_id = $1
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

    req.platformAdmin = Object.freeze({
      userId: rows[0].user_id,
    });

    return next();

  } catch (error) {
    console.error(
      "[PlatformAdmin] Authorization failed:",
      error
    );

    return res.status(500).json({
      success: false,
      code: "PLATFORM_AUTHORIZATION_ERROR",
      message: "Unable to verify platform permissions",
    });
  }
}

module.exports = {
  requirePlatformAdmin,
};
