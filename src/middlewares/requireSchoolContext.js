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
 * - X-School-Id is only a requested school, never proof of authorization.
 * - Handles school lifecycle: active, new, locked, suspended, soft-deleted.
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
        s.status AS school_status,
        s.setup_completed,
        s.lock_reason,
        s.suspension_reason,
        s.deleted_at

      FROM public.school_memberships sm

      INNER JOIN public.schools s
        ON s.id = sm.school_id

      WHERE sm.user_id = $1
        AND sm.school_id = $2
        AND sm.status = 'active'

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
    // 4. CHECK SCHOOL LIFECYCLE & STATUS
    // =========================================

    // Soft-deleted school
    if (membership.deleted_at) {
      return res.status(404).json({
        success: false,
        code: "SCHOOL_NOT_FOUND",
        message: "Trường học không tồn tại hoặc đã bị xóa",
      });
    }

    // Locked school: all actions blocked
    if (membership.school_status === "locked") {
      return res.status(403).json({
        success: false,
        code: "SCHOOL_LOCKED",
        message: "Trường học hiện đang bị khóa.",
        lock_reason: membership.lock_reason || null,
      });
    }

    // Suspended school (e.g. overdue contract):
    // School Admin is allowed to access billing/settings to renew
    const isBillingOrSettingsPath =
      req.originalUrl &&
      (req.originalUrl.includes("/billing") ||
        req.originalUrl.includes("/schools/settings"));

    if (membership.school_status === "suspended") {
      if (membership.role === "school_admin" && isBillingOrSettingsPath) {
        // Allow school admin to renew contract
      } else {
        return res.status(403).json({
          success: false,
          code: "SCHOOL_SUSPENDED",
          message:
            "Trường học đang bị tạm dừng dịch vụ do hết hạn hợp đồng. Vui lòng liên hệ quản trị trường để gia hạn.",
          suspension_reason: membership.suspension_reason || null,
        });
      }
    }

    // Pending tenant (not yet set up):
    // Only school_admin can access to complete onboarding/setup and billing
    if (
      ["new", "pending_setup"].includes(membership.school_status) &&
      membership.role !== "school_admin"
    ) {
      return res.status(403).json({
        success: false,
        code: "SCHOOL_PENDING_SETUP",
        message: "Trường học đang trong quá trình thiết lập ban đầu.",
      });
    }

    // =========================================
    // 5. TRUSTED TENANT CONTEXT
    // =========================================

    req.tenant = Object.freeze({
      schoolId: membership.school_id,
      userId: membership.user_id,

      // Role from DB membership, not legacy JWT.
      role: membership.role,

      schoolCode: membership.school_code,
      schoolName: membership.school_name,
      schoolSlug: membership.school_slug,
      schoolStatus: membership.school_status,
      setupCompleted: Boolean(membership.setup_completed),
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
