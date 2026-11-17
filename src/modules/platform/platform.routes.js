
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
const EmailService = require("../../config/email.config");

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

  // Superadmin owns platform identities and commercial catalogue mutations.
  router.get("/managers", requireSuperAdmin, platformController.listManagers);
  router.post("/managers", requireSuperAdmin, platformController.createManager);
  router.patch("/managers/:userId/status", requireSuperAdmin, platformController.setManagerStatus);
  router.patch("/managers/:userId", requireSuperAdmin, platformController.updateManager);
  router.delete("/managers/:userId", requireSuperAdmin, platformController.deactivateManager);
  
  // Both Superadmin and Manager can view active plans, but only Superadmin can mutate
  router.get("/plans", requirePlatformRoles("superadmin", "manager"), platformController.listPlans);
  router.post("/plans", requireSuperAdmin, platformController.createPlan);
  router.patch("/plans/:planId", requireSuperAdmin, platformController.updatePlan);
  router.delete("/plans/:planId", requireSuperAdmin, platformController.deletePlan);
  router.get("/revenue", requireSuperAdmin, platformController.revenue);
  router.get("/audit-logs", requireSuperAdmin, platformController.auditLogs);

  // Both Superadmin and Manager can view refunds (read-only for Manager), but only Superadmin can approve/reject/execute
  router.get("/refunds", requirePlatformRoles("superadmin", "manager"), platformController.listRefunds);
  router.post("/refunds/:id/approve", requireSuperAdmin, platformController.approveRefund);
  router.post("/refunds/:id/reject", requireSuperAdmin, platformController.rejectRefund);
  router.post("/refunds/:id/execute", requireSuperAdmin, platformController.executeRefund);

  router.post(
    "/notifications/broadcast",
    requirePlatformRoles("superadmin", "manager"),
    validate(broadcastNotificationSchema),
    async (req, res, next) => {
      try {
        const targetUsers =
          await adminRepository.findUsersByPlatformTarget(
            req.body.target
          );
        const userIds = targetUsers.map((u) => u.id);

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

        // Filter valid email addresses
        const recipientEmails = targetUsers
          .map((u) => u.email)
          .filter((email) => email && typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

        if (recipientEmails.length > 0) {
          setImmediate(async () => {
            try {
              console.log(`[Platform Broadcast Email] Sending broadcast emails to ${recipientEmails.length} recipients...`);
              const chunkSize = 25;
              for (let i = 0; i < recipientEmails.length; i += chunkSize) {
                const chunk = recipientEmails.slice(i, i + chunkSize);
                try {
                  await EmailService.sendEmail({
                    to: process.env.EMAIL,
                    bcc: chunk,
                    subject: `[EDUX THÔNG BÁO] ${req.body.title}`,
                    message: req.body.message,
                    html: `
                      <div style="max-width: 600px; margin: 0 auto; font-family: 'Segoe UI', Arial, sans-serif; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
                        <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 24px; text-align: center; color: #ffffff;">
                          <h1 style="margin: 0; font-size: 22px; font-weight: 700;">EDUX PLATFORM</h1>
                          <p style="margin: 6px 0 0; font-size: 13px; opacity: 0.9;">Hệ thống Quản lý Đào tạo & Vận hành Toàn diện</p>
                        </div>
                        <div style="padding: 28px 24px;">
                          <div style="display: inline-block; padding: 4px 12px; background-color: #eff6ff; color: #1d4ed8; font-size: 12px; font-weight: 600; border-radius: 9999px; margin-bottom: 16px;">
                            THÔNG BÁO TỪ BAN QUẢN TRỊ
                          </div>
                          <h2 style="margin: 0 0 16px; font-size: 19px; color: #0f172a;">${req.body.title}</h2>
                          <div style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-wrap; background-color: #f8fafc; padding: 16px; border-radius: 8px; border-left: 4px solid #3b82f6;">${req.body.message}</div>
                          <div style="margin-top: 24px; font-size: 13px; color: #64748b; line-height: 1.5;">
                            <p style="margin: 0 0 4px;">Thông báo này được gửi từ <strong>Ban Quản trị Nền tảng EDUX</strong> tới tài khoản của bạn.</p>
                            <p style="margin: 0;">Vui lòng truy cập <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}" style="color: #2563eb; text-decoration: underline;">Cổng thông tin EDUX</a> để xem chi tiết.</p>
                          </div>
                        </div>
                        <div style="background-color: #f1f5f9; padding: 14px 20px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
                          © 2026 EDUX System. All rights reserved. • Email thông báo tự động.
                        </div>
                      </div>
                    `,
                  });
                  console.log(`[Platform Broadcast Email] Successfully dispatched chunk of ${chunk.length} emails via BCC.`);
                } catch (chunkErr) {
                  console.warn(`[Platform Broadcast Email] Batch BCC failed, falling back to individual sending:`, chunkErr.message);
                  for (const singleEmail of chunk) {
                    try {
                      await EmailService.sendEmail({
                        to: singleEmail,
                        subject: `[EDUX THÔNG BÁO] ${req.body.title}`,
                        message: req.body.message,
                      });
                      console.log(`[Platform Broadcast Email] Sent individual email to ${singleEmail}`);
                    } catch (singleErr) {
                      console.warn(`[Platform Broadcast Email] Individual send failed for ${singleEmail}:`, singleErr.message);
                    }
                  }
                }
              }
            } catch (bgErr) {
              console.error("[Platform Broadcast Email] Background dispatch error:", bgErr);
            }
          });
        }

        return res.status(200).json({
          success: true,
          data: { 
            count: created.length,
            recipient_emails_count: recipientEmails.length,
            emails_queued: true,
          },
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
      const [schoolsResult, subscriptionResult, revenueResult, managerResult, planResult] = await Promise.all([
        pool.query(
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
        ),
        pool.query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'active')::int AS active_contracts,
            COUNT(*) FILTER (WHERE status = 'active' AND end_date <= NOW() + INTERVAL '30 days')::int AS expiring_contracts
          FROM public.school_subscriptions
        `),
        pool.query(`
          SELECT COALESCE(SUM(amount), 0)::numeric(15, 2) AS total_revenue
          FROM public.payment_transactions
          WHERE status = 'success'
        `),
        pool.query(`SELECT COUNT(*)::int AS manager_count FROM public.platform_admins WHERE role = 'manager' AND is_active = TRUE`),
        pool.query(`
          SELECT sp.id, sp.name, COUNT(ss.id)::int AS active_subscriptions
          FROM public.subscription_plans sp
          LEFT JOIN public.school_subscriptions ss ON ss.plan_id = sp.id AND ss.status = 'active'
          GROUP BY sp.id, sp.name
          ORDER BY sp.price_monthly ASC
        `),
      ]);
      const schools = schoolsResult.rows;

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
          pending_setup_schools: schools.filter((school) => school.status === "pending_setup").length,
          locked_schools: schools.filter((school) => school.status === "locked").length,
          suspended_schools: schools.filter((school) => school.status === "suspended").length,
          active_contracts: subscriptionResult.rows[0]?.active_contracts || 0,
          expiring_contracts: subscriptionResult.rows[0]?.expiring_contracts || 0,
          total_revenue: revenueResult.rows[0]?.total_revenue || 0,
          manager_count: managerResult.rows[0]?.manager_count || 0,
          plans: planResult.rows,

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
  router.post("/subscriptions/:subscriptionId/remind", requirePlatformRoles("superadmin", "manager"), platformController.remindSubscriptionRenewal);
  router.get("/transactions", requirePlatformRoles("superadmin", "manager"), platformController.listTransactions);

  return router;
}

module.exports = {
  createPlatformRouter,
};
