
"use strict";

const { pool } = require("../config/db.config");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * EDUX Multi-Tenant School Context
 *
 * REQUIREMENTS:
 * - authenticate middleware must run first.
 * - req.user.id comes from verified JWT.
 * - X-School-Id is only a requested school,
 *   never proof of authorization.
 */
async function requireSchoolContext(req, res, next) {
  try {
    // =========================================
    // 1. AUTHENTICATED USER
    // =========================================

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

    // =========================================
    // 2. SELECTED SCHOOL
    // =========================================

    const schoolIdHeader = req.get("X-School-Id");

    if (
      typeof schoolIdHeader !== "string" ||
      !UUID_REGEX.test(schoolIdHeader.trim())
    ) {
      return res.status(400).json({
        success: false,
        code: "SCHOOL_CONTEXT_REQUIRED",
        message: "Valid X-School-Id header is required",
      });
    }

    const requestedSchoolId = schoolIdHeader.trim();

    // =========================================
    // 3. VERIFY SCHOOL MEMBERSHIP
    // =========================================

    const { rows } = await pool.query(
      `
      SELECT
        sm.school_id,
        sm.user_id,
        sm.role,
        sm.status AS membership_status,

        s.code AS school_code,
        s.name AS school_name,
        s.slug AS school_slug,
        s.status AS school_status

      FROM public.school_memberships sm

      INNER JOIN public.schools s
        ON s.id = sm.school_id

      WHERE sm.user_id = $1
        AND sm.school_id = $2
        AND sm.status = 'active'
        AND s.status = 'active'

      LIMIT 1
      `,
      [userId, requestedSchoolId]
    );

    const membership = rows[0];

    if (!membership) {
      return res.status(403).json({
        success: false,
        code: "SCHOOL_ACCESS_DENIED",
        message: "You do not have access to this school",
      });
    }

    // =========================================
    // 4. TRUSTED TENANT CONTEXT
    // =========================================

    req.tenant = Object.freeze({
      schoolId: membership.school_id,
      userId: membership.user_id,

      // Role from DB membership, not legacy JWT.
      role: membership.role,

      schoolCode: membership.school_code,
      schoolName: membership.school_name,
      schoolSlug: membership.school_slug,
    });

    return next();
  } catch (error) {
    console.error(
      "[SchoolContext] Error:",
      error
    );

    return res.status(500).json({
      success: false,
      code: "SCHOOL_CONTEXT_ERROR",
      message: "Failed to verify school context",
    });
  }
}

module.exports = {
  requireSchoolContext,
};
