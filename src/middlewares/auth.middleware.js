
"use strict";

const jwt = require("jsonwebtoken");

const {
  pool,
} = require("../config/db.config");

const JWT_SECRET = process.env.JWT_SECRET;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (
    typeof authHeader !== "string" ||
    !authHeader.startsWith("Bearer ")
  ) {
    return res.status(401).json({
      success: false,
      message: "Access token is missing or invalid",
    });
  }

  const token = authHeader.slice(7).trim();

  let decoded;

  // =========================================
  // 1. VERIFY ACCESS TOKEN
  // =========================================

  try {
    decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch {
    return res.status(401).json({
      success: false,
      message: "Access token is expired or invalid",
    });
  }

  // Reject new refresh tokens as access tokens.
  // Existing legacy access tokens have no type.
  if (
    decoded.tokenType !== undefined &&
    decoded.tokenType !== "access"
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid access token type",
    });
  }

  const userId = decoded.userId;

  if (
    typeof userId !== "string" ||
    !UUID_REGEX.test(userId)
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid user identity",
    });
  }

  // =========================================
  // 2. CHECK CURRENT ACCOUNT STATUS
  // =========================================

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        role
      FROM public.users
      WHERE id = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [userId]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Account is inactive or unavailable",
      });
    }

    // =========================================
    // 3. TRUSTED GLOBAL IDENTITY
    // =========================================

    req.user = {
      id: user.id,
      userId: user.id,

      // Legacy role for unmigrated modules.
      // School RBAC must use req.tenant.role.
      role: user.role,
    };

    return next();

  } catch (error) {
    console.error(
      "[Auth] Account verification failed:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Authentication service unavailable",
    });
  }
}

module.exports = {
  authenticate,
};
