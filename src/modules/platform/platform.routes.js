
"use strict";

const express = require("express");

const {
  pool,
} = require("../../config/db.config");

const {
  requirePlatformAdmin,
} = require("../../middlewares/requirePlatformAdmin");
const { validate } = require("../../middlewares/validate.middleware");
const {
  broadcastNotificationSchema,
} = require("../admin/admin.validation");
const adminRepository = require("../admin/admin.repository");
const notificationsRepository = require("../notifications/notifications.repository");
const {
  emitCreatedNotifications,
} = require("../notifications/notifications.realtime");

function createPlatformRouter({ authenticate }) {
  if (typeof authenticate !== "function") {
    throw new Error(
      "PlatformRouter requires authenticate middleware"
    );
  }

  const router = express.Router();

  // =========================================
  // GLOBAL AUTHENTICATION
  // =========================================

  router.use(authenticate);

  // =========================================
  // PLATFORM ADMIN AUTHORIZATION
  // =========================================

  router.use(requirePlatformAdmin);

  // Prevent cached admin data.
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // =========================================
  // GET /api/platform/me
  // Verify Super Admin permissions
  // =========================================

  router.get("/me", (req, res) => {
    return res.status(200).json({
      success: true,

      platformAdmin: {
        userId: req.platformAdmin.userId,
        role: "platform_admin",
      },
    });
  });

  router.post(
    "/notifications/broadcast",
    validate(broadcastNotificationSchema),
    async (req, res, next) => {
      try {
        const userIds =
          await adminRepository.findUserIdsByPlatformTarget(
            req.body.target
          );
        const notifications = userIds.map((userId) => ({
          userId,
          title: req.body.title,
          message: req.body.message,
          type: "system_announcement",
          related_entity_type: "platform_broadcast",
          notification_scope: "platform",
          school_id: null,
        }));
        const created =
          await notificationsRepository.bulkCreate(notifications);

        emitCreatedNotifications(created);

        return res.status(200).json({
          success: true,
          data: { count: created.length },
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  // =========================================
  // GET /api/platform/overview
  // Multi-Tenant Platform Dashboard
  // =========================================

  router.get("/overview", async (req, res, next) => {
    try {
      const { rows: schools } = await pool.query(
        `
        SELECT
          s.id,
          s.name,
          s.code,
          s.slug,
          s.status,

          COUNT(DISTINCT sm.user_id)
            FILTER (
              WHERE sm.status = 'active'
                AND u.is_active = TRUE
            )::int AS active_members,

          COUNT(DISTINCT sm.user_id)
            FILTER (
              WHERE sm.role = 'school_admin'
                AND sm.status = 'active'
                AND u.is_active = TRUE
            )::int AS school_admins

        FROM public.schools s

        LEFT JOIN public.school_memberships sm
          ON sm.school_id = s.id

        LEFT JOIN public.users u
          ON u.id = sm.user_id

        GROUP BY
          s.id,
          s.name,
          s.code,
          s.slug,
          s.status

        ORDER BY s.name ASC
        `
      );

      // =====================================
      // PLATFORM METRICS
      // =====================================

      const totalSchools = schools.length;

      const activeSchools = schools.filter(
        (school) => school.status === "active"
      ).length;

      const activeMemberships = schools.reduce(
        (total, school) =>
          total + Number(school.active_members),
        0
      );

      // =====================================
      // RESPONSE
      // =====================================

      return res.status(200).json({
        success: true,

        data: {
          total_schools: totalSchools,

          active_schools: activeSchools,

          active_memberships: activeMemberships,

          schools,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createPlatformRouter,
};
