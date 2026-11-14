"use strict";

const { pool } = require("../../config/db.config");

const PlatformAuditService = {
  /**
   * Log an administrative action to platform_audit_logs.
   */
  async log({
    actorId,
    actorRole,
    action,
    targetType = null,
    targetId = null,
    metadata = {},
    ipAddress = null,
  }) {
    try {
      await pool.query(
        `
        INSERT INTO public.platform_audit_logs (
          actor_id,
          actor_role,
          action,
          target_type,
          target_id,
          metadata,
          ip_address
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          actorId || null,
          actorRole || null,
          action,
          targetType,
          targetId ? String(targetId) : null,
          JSON.stringify(metadata || {}),
          ipAddress || null,
        ]
      );
    } catch (error) {
      console.error("[PlatformAuditService] Error logging action:", error);
      // Non-blocking error: do not crash the primary transaction unless required
    }
  },

  /**
   * List platform audit logs with pagination and filters.
   */
  async listLogs({ page = 1, limit = 20, action, actorId, targetType } = {}) {
    const offset = (Math.max(1, page) - 1) * limit;
    const whereConditions = [];
    const params = [];

    if (action) {
      params.push(`%${action}%`);
      whereConditions.push(`pal.action ILIKE $${params.length}`);
    }

    if (actorId) {
      params.push(actorId);
      whereConditions.push(`pal.actor_id = $${params.length}`);
    }

    if (targetType) {
      params.push(targetType);
      whereConditions.push(`pal.target_type = $${params.length}`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.platform_audit_logs pal ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);

    const { rows } = await pool.query(
      `
      SELECT
        pal.id,
        pal.actor_id,
        u.email AS actor_email,
        u.full_name AS actor_name,
        pal.actor_role,
        pal.action,
        pal.target_type,
        pal.target_id,
        pal.metadata,
        pal.ip_address,
        pal.created_at
      FROM public.platform_audit_logs pal
      LEFT JOIN public.users u ON u.id = pal.actor_id
      ${whereClause}
      ORDER BY pal.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );

    return {
      items: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },
};

module.exports = PlatformAuditService;
