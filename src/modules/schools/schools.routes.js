
"use strict";

const express = require("express");

const { pool } = require("../../config/db.config");
const { withTransaction } = require("../../config/db.config");

const {
    requireSchoolContext,
} = require("../../middlewares/requireSchoolContext");
const {
    authorizeSchoolRoles,
} = require("../../middlewares/authorizeSchoolRoles");
const platformService = require("../platform/platform.service");
/**
 * Receive the existing JWT middleware through
 * dependency injection. This avoids assuming
 * the filename of EDUX's authentication middleware.
 */
function createSchoolsRouter({ authenticate }) {
    if (typeof authenticate !== "function") {
        throw new Error(
            "SchoolsRouter requires authenticate middleware"
        );
    }

    const router = express.Router();

    // All school endpoints require verified JWT.
    router.use(authenticate);

    // The invited account must already be authenticated. The service verifies
    // the token, expiry and recipient email atomically before adding a
    // school_admin membership.
    router.post("/invitations/accept", async (req, res, next) => {
        try {
            const result = await platformService.acceptInvitation({
                rawToken: req.body?.token,
                userId: req.user.id,
            });
            return res.status(200).json({ success: true, data: result });
        } catch (error) {
            return next(error);
        }
    });

    // ===========================================
    // GET /api/schools/mine
    // ===========================================

    router.get("/mine", async (req, res) => {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: "Authentication required",
                });
            }

            const { rows } = await pool.query(
                `
        SELECT
          s.id,
          s.code,
          s.name,
          s.slug,

          sm.role,
          sm.status AS membership_status

        FROM public.school_memberships sm

        INNER JOIN public.schools s
          ON s.id = sm.school_id

        WHERE sm.user_id = $1
          AND sm.status = 'active'
          -- Supports pre-SaaS databases where deleted_at does not yet exist.
          AND (to_jsonb(s)->>'deleted_at') IS NULL
          AND (
            s.status = 'active'
            OR (
              sm.role = 'school_admin'
              AND s.status IN ('new', 'pending_setup')
            )
          )

        ORDER BY s.name ASC
        `,
                [userId]
            );

            return res.status(200).json({
                success: true,
                schools: rows,
                total: rows.length,
            });
        } catch (error) {
            console.error(
                "[Schools] Get my schools failed:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Failed to load schools",
            });
        }
    });

    // ===========================================
    // GET /api/schools/context
    // ===========================================

    router.get(
        "/context",
        requireSchoolContext,
        (req, res) => {
            return res.status(200).json({
                success: true,
                tenant: req.tenant,
            });
        }
    );


    // ===========================================
    // GET /api/schools/admin/context
    // Only school_admin can access.
    // ===========================================

    router.get(
        "/admin/context",

        requireSchoolContext,

        authorizeSchoolRoles("school_admin"),

        (req, res) => {
            return res.status(200).json({
                success: true,
                message: "School administrator authorized",

                school: {
                    id: req.tenant.schoolId,
                    code: req.tenant.schoolCode,
                    name: req.tenant.schoolName,
                },

                role: req.tenant.role,
            });
        }
    );

    const schoolAdminOnly = [
        requireSchoolContext,
        authorizeSchoolRoles("school_admin"),
    ];

    router.get("/settings", ...schoolAdminOnly, async (req, res, next) => {
        try {
            const { rows } = await pool.query(
                `
                SELECT s.id, s.code, s.name, s.status, s.setup_completed, s.created_at,
                       ss.display_name, ss.logo_url, ss.address, ss.contact_email,
                       ss.contact_phone, ss.description, ss.website,
                       sub.plan_id, sub.billing_cycle, sub.status AS subscription_status,
                       sub.start_date AS subscription_start, sub.end_date AS subscription_end,
                       sub.price_snapshot,
                       sp.name AS plan_name, sp.student_limit, sp.storage_limit_gb, sp.ai_requests_limit
                FROM public.schools s
                LEFT JOIN public.school_settings ss ON ss.school_id = s.id
                LEFT JOIN LATERAL (
                    SELECT * FROM public.school_subscriptions 
                    WHERE school_id = s.id 
                    ORDER BY created_at DESC 
                    LIMIT 1
                ) sub ON true
                LEFT JOIN public.subscription_plans sp ON sp.id = sub.plan_id
                WHERE s.id = $1 AND s.deleted_at IS NULL
                LIMIT 1
                `,
                [req.tenant.schoolId]
            );
            return res.json({ success: true, data: rows[0] || null });
        } catch (error) {
            return next(error);
        }
    });

    async function saveSettings(req, res, next, { completingSetup }) {
        try {
            const input = req.body || {};
            const name = typeof input.name === "string" ? input.name.trim() : "";
            if (completingSetup && !name) {
                return res.status(400).json({ success: false, message: "School name is required" });
            }
            if (input.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact_email)) {
                return res.status(400).json({ success: false, message: "Contact email is invalid" });
            }
            if (input.website && !/^https?:\/\//i.test(input.website)) {
                return res.status(400).json({ success: false, message: "Website must be an absolute http(s) URL" });
            }

            const result = await withTransaction(async (client) => {
                if (name) {
                    await client.query(
                        `UPDATE public.schools
                         SET name = $2, setup_completed = CASE WHEN $3 THEN TRUE ELSE setup_completed END,
                             setup_completed_at = CASE WHEN $3 THEN COALESCE(setup_completed_at, NOW()) ELSE setup_completed_at END,
                             updated_at = NOW()
                         WHERE id = $1 AND deleted_at IS NULL`,
                        [req.tenant.schoolId, name, completingSetup]
                    );
                }

                const settings = {
                    display_name: input.display_name !== undefined ? (input.display_name?.trim() || null) : null,
                    logo_url: input.logo_url !== undefined ? (input.logo_url?.trim() || null) : null,
                    address: input.address !== undefined ? (input.address?.trim() || null) : null,
                    contact_email: input.contact_email !== undefined ? (input.contact_email?.trim() || null) : null,
                    contact_phone: input.contact_phone !== undefined ? (input.contact_phone?.trim() || null) : null,
                    description: input.description !== undefined ? (input.description?.trim() || null) : null,
                    website: input.website !== undefined ? (input.website?.trim() || null) : null,
                };
                await client.query(
                    `INSERT INTO public.school_settings (
                      school_id, display_name, logo_url, address, contact_email,
                      contact_phone, description, website, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                    ON CONFLICT (school_id) DO UPDATE SET
                      display_name = COALESCE(EXCLUDED.display_name, public.school_settings.display_name),
                      logo_url = EXCLUDED.logo_url,
                      address = EXCLUDED.address,
                      contact_email = EXCLUDED.contact_email,
                      contact_phone = EXCLUDED.contact_phone,
                      description = EXCLUDED.description,
                      website = EXCLUDED.website,
                      updated_at = NOW()`,
                    [req.tenant.schoolId, settings.display_name, settings.logo_url, settings.address,
                        settings.contact_email, settings.contact_phone, settings.description, settings.website]
                );
                const { rows } = await client.query(
                    `SELECT s.id, s.code, s.name, s.status, s.setup_completed, s.created_at,
                            ss.display_name, ss.logo_url, ss.address, ss.contact_email,
                            ss.contact_phone, ss.description, ss.website,
                            sub.plan_id, sub.billing_cycle, sub.status AS subscription_status,
                            sub.start_date AS subscription_start, sub.end_date AS subscription_end,
                            sub.price_snapshot,
                            sp.name AS plan_name, sp.student_limit, sp.storage_limit_gb, sp.ai_requests_limit
                     FROM public.schools s 
                     LEFT JOIN public.school_settings ss ON ss.school_id = s.id
                     LEFT JOIN LATERAL (
                         SELECT * FROM public.school_subscriptions 
                         WHERE school_id = s.id 
                         ORDER BY created_at DESC 
                         LIMIT 1
                     ) sub ON true
                     LEFT JOIN public.subscription_plans sp ON sp.id = sub.plan_id
                     WHERE s.id = $1`, [req.tenant.schoolId]
                );
                return rows[0];
            });
            return res.json({ success: true, data: result });
        } catch (error) {
            return next(error);
        }
    }

    router.put("/setup", ...schoolAdminOnly, (req, res, next) =>
        saveSettings(req, res, next, { completingSetup: true })
    );
    router.patch("/settings", ...schoolAdminOnly, (req, res, next) =>
        saveSettings(req, res, next, { completingSetup: false })
    );

    return router;
}

module.exports = {
    createSchoolsRouter,
};
