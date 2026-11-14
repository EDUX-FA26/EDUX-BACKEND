
"use strict";

const express = require("express");

const {
  pool,
} = require("../../config/db.config");

const {
  requirePlatformAdmin,
  requireSuperAdmin,
  requirePlatformRoles,
} = require("../../middlewares/requirePlatformAdmin");
const platformController = require("./platform.controller");
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

  router.get("/me", platformController.me);

  // Superadmin owns platform identities and commercial catalogue.
  router.get("/managers", requireSuperAdmin, platformController.listManagers);
  router.post("/managers", requireSuperAdmin, platformController.createManager);
  router.patch("/managers/:userId/status", requireSuperAdmin, platformController.setManagerStatus);
  router.get("/plans", requireSuperAdmin, platformController.listPlans);
  router.post("/plans", requireSuperAdmin, platformController.createPlan);
  router.patch("/plans/:planId", requireSuperAdmin, platformController.updatePlan);
  router.get("/revenue", requireSuperAdmin, platformController.revenue);
  router.get("/audit-logs", requireSuperAdmin, platformController.auditLogs);

  router.post(
    "/notifications/broadcast",
    requireSuperAdmin,
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

  // Both platform roles can operate tenant lifecycle and inspect commercial data.
  // These routes deliberately never receive a school context, preventing them
  // from being used as a backdoor to learning data.
  router.get("/schools", requirePlatformRoles("superadmin", "manager"), platformController.listSchools);
  router.post("/schools", requirePlatformRoles("superadmin", "manager"), platformController.createSchool);
  router.post("/schools/:schoolId/invitations", requirePlatformRoles("superadmin", "manager"), platformController.inviteSchoolAdmin);
  router.post("/schools/:schoolId/lock", requirePlatformRoles("superadmin", "manager"), platformController.changeSchoolStatus);
  router.post("/schools/:schoolId/unlock", requirePlatformRoles("superadmin", "manager"), platformController.changeSchoolStatus);
  router.post("/schools/:schoolId/suspend", requirePlatformRoles("superadmin", "manager"), platformController.changeSchoolStatus);
  router.post("/schools/:schoolId/restore", requirePlatformRoles("superadmin", "manager"), platformController.changeSchoolStatus);
  router.post("/schools/:schoolId/delete", requirePlatformRoles("superadmin", "manager"), platformController.changeSchoolStatus);
  router.get("/subscriptions", requirePlatformRoles("superadmin", "manager"), platformController.listContracts);
  router.get("/transactions", requirePlatformRoles("superadmin", "manager"), platformController.listTransactions);

  return router;
}

module.exports = {
  createPlatformRouter,
};
