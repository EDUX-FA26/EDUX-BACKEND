
"use strict";

const express = require("express");

const { pool } = require("../../config/db.config");

const {
    requireSchoolContext,
} = require("../../middlewares/requireSchoolContext");
const {
    authorizeSchoolRoles,
} = require("../../middlewares/authorizeSchoolRoles");
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
          AND s.status = 'active'

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

    return router;
}

module.exports = {
    createSchoolsRouter,
};
