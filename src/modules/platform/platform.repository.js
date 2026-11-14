"use strict";

const { pool } = require("../../config/db.config");

const PlatformRepository = {
  // =========================================================================
  // MANAGERS MANAGEMENT
  // =========================================================================

  async listManagers() {
    const { rows } = await pool.query(
      `
      SELECT
        pa.user_id AS id,
        pa.role,
        pa.is_active,
        pa.created_at,
        pa.updated_at,
        u.email,
        u.username,
        u.last_login_at,
        up.full_name,
        up.avatar_url,
        gb.email AS granted_by_email
      FROM public.platform_admins pa
      INNER JOIN public.users u ON u.id = pa.user_id
      LEFT JOIN public.user_profiles up ON up.user_id = u.id
      LEFT JOIN public.users gb ON gb.id = pa.granted_by
      ORDER BY pa.role ASC, pa.created_at DESC
      `
    );
    return rows;
  },

  async findManagerById(userId) {
    const { rows } = await pool.query(
      `
      SELECT
        pa.user_id AS id,
        pa.role,
        pa.is_active,
        u.email,
        u.username,
        up.full_name
      FROM public.platform_admins pa
      INNER JOIN public.users u ON u.id = pa.user_id
      LEFT JOIN public.user_profiles up ON up.user_id = u.id
      WHERE pa.user_id = $1
      LIMIT 1
      `,
      [userId]
    );
    return rows[0] || null;
  },

  async createManagerAccount({ email, username, passwordHash, fullName, grantedBy }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Insert user
      const { rows: userRows } = await client.query(
        `
        INSERT INTO public.users (email, username, password_hash, role, is_active)
        VALUES ($1, $2, $3, 'admin', TRUE)
        RETURNING id, email, username, role, created_at
        `,
        [email, username, passwordHash]
      );
      const user = userRows[0];

      // 2. Insert profile
      await client.query(
        `
        INSERT INTO public.user_profiles (user_id, full_name)
        VALUES ($1, $2)
        `,
        [user.id, fullName || username]
      );

      // 3. Grant platform manager role
      await client.query(
        `
        INSERT INTO public.platform_admins (user_id, role, is_active, granted_by)
        VALUES ($1, 'manager', TRUE, $2)
        `,
        [user.id, grantedBy || null]
      );

      await client.query("COMMIT");
      return {
        ...user,
        full_name: fullName || username,
        platform_role: "manager",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async toggleManagerStatus(userId, isActive) {
    const { rows } = await pool.query(
      `
      UPDATE public.platform_admins
      SET is_active = $2, updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, role, is_active
      `,
      [userId, isActive]
    );
    return rows[0] || null;
  },

  async deleteManager(userId) {
    const { rowCount } = await pool.query(
      `DELETE FROM public.platform_admins WHERE user_id = $1 AND role = 'manager'`,
      [userId]
    );
    return rowCount > 0;
  },

  // =========================================================================
  // SUBSCRIPTION PLANS
  // =========================================================================

  async listPlans(includeInactive = false) {
    const where = includeInactive ? "" : "WHERE is_active = TRUE";
    const { rows } = await pool.query(
      `
      SELECT
        id,
        name,
        description,
        price_monthly,
        price_yearly,
        student_limit,
        storage_limit_gb,
        ai_requests_limit,
        features,
        is_active,
        created_at,
        updated_at
      FROM public.subscription_plans
      ${where}
      ORDER BY price_monthly ASC
      `
    );
    return rows;
  },

  async getPlanById(id) {
    const { rows } = await pool.query(
      `SELECT * FROM public.subscription_plans WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  async createPlan(data) {
    const { rows } = await pool.query(
      `
      INSERT INTO public.subscription_plans (
        id,
        name,
        description,
        price_monthly,
        price_yearly,
        student_limit,
        storage_limit_gb,
        ai_requests_limit,
        features,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      RETURNING *
      `,
      [
        data.id,
        data.name,
        data.description || "",
        data.price_monthly,
        data.price_yearly,
        data.student_limit || 500,
        data.storage_limit_gb || 20,
        data.ai_requests_limit || 1000,
        JSON.stringify(data.features || {}),
        data.is_active ?? true,
      ]
    );
    return rows[0];
  },

  async updatePlan(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    for (const [col, val] of Object.entries({
      name: data.name,
      description: data.description,
      price_monthly: data.price_monthly,
      price_yearly: data.price_yearly,
      student_limit: data.student_limit,
      storage_limit_gb: data.storage_limit_gb,
      ai_requests_limit: data.ai_requests_limit,
      features: data.features ? JSON.stringify(data.features) : undefined,
      is_active: data.is_active,
    })) {
      if (val !== undefined) {
        if (col === "features") {
          fields.push(`${col} = $${idx++}::jsonb`);
        } else {
          fields.push(`${col} = $${idx++}`);
        }
        values.push(val);
      }
    }

    if (!fields.length) return this.getPlanById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE public.subscription_plans SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  // =========================================================================
  // SCHOOLS / TENANTS MANAGEMENT
  // =========================================================================

  async listSchools({ page = 1, limit = 20, status, search, includeDeleted = false } = {}) {
    const offset = (Math.max(1, page) - 1) * limit;
    const whereConditions = [];
    const params = [];

    if (!includeDeleted) {
      whereConditions.push("s.deleted_at IS NULL");
    }

    if (status) {
      params.push(status);
      whereConditions.push(`s.status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      whereConditions.push(`(s.name ILIKE $${params.length} OR s.code ILIKE $${params.length} OR s.slug ILIKE $${params.length})`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.schools s ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);

    const { rows } = await pool.query(
      `
      SELECT
        s.id,
        s.name,
        s.code,
        s.slug,
        s.status,
        s.setup_completed,
        s.setup_completed_at,
        s.locked_at,
        s.lock_reason,
        s.suspended_at,
        s.suspension_reason,
        s.deleted_at,
        s.created_at,
        s.updated_at,
        ss.display_name,
        ss.logo_url,
        sub.plan_id AS current_plan_id,
        sub.status AS subscription_status,
        sub.end_date AS subscription_end_date,
        p.name AS plan_name,
        COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.status = 'active')::int AS total_members,
        COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.role = 'school_admin' AND sm.status = 'active')::int AS admin_count,
        COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.role = 'lecturer' AND sm.status = 'active')::int AS lecturer_count,
        COUNT(DISTINCT sm.user_id) FILTER (WHERE sm.role = 'student' AND sm.status = 'active')::int AS student_count
      FROM public.schools s
      LEFT JOIN public.school_settings ss ON ss.school_id = s.id
      LEFT JOIN LATERAL (
        SELECT id, plan_id, status, end_date
        FROM public.school_subscriptions
        WHERE school_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) sub ON TRUE
      LEFT JOIN public.subscription_plans p ON p.id = sub.plan_id
      LEFT JOIN public.school_memberships sm ON sm.school_id = s.id
      ${whereClause}
      GROUP BY
        s.id,
        ss.display_name,
        ss.logo_url,
        sub.plan_id,
        sub.status,
        sub.end_date,
        p.name
      ORDER BY s.created_at DESC
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

  async getSchoolById(schoolId) {
    const { rows } = await pool.query(
      `
      SELECT
        s.*,
        ss.display_name,
        ss.logo_url,
        ss.primary_color,
        ss.timezone,
        ss.locale,
        ss.feature_flags,
        sub.id AS current_subscription_id,
        sub.plan_id AS current_plan_id,
        sub.status AS subscription_status,
        sub.start_date AS subscription_start_date,
        sub.end_date AS subscription_end_date,
        sub.billing_cycle,
        p.name AS plan_name,
        p.student_limit,
        p.storage_limit_gb
      FROM public.schools s
      LEFT JOIN public.school_settings ss ON ss.school_id = s.id
      LEFT JOIN LATERAL (
        SELECT *
        FROM public.school_subscriptions
        WHERE school_id = s.id
        ORDER BY created_at DESC
        LIMIT 1
      ) sub ON TRUE
      LEFT JOIN public.subscription_plans p ON p.id = sub.plan_id
      WHERE s.id = $1
      LIMIT 1
      `,
      [schoolId]
    );

    if (!rows[0]) return null;

    // Get school admins
    const { rows: admins } = await pool.query(
      `
      SELECT
        u.id,
        u.email,
        u.username,
        u.last_login_at,
        up.full_name,
        up.avatar_url,
        sm.created_at AS assigned_at
      FROM public.school_memberships sm
      INNER JOIN public.users u ON u.id = sm.user_id
      LEFT JOIN public.user_profiles up ON up.user_id = u.id
      WHERE sm.school_id = $1 AND sm.role = 'school_admin' AND sm.status = 'active'
      `,
      [schoolId]
    );

    return {
      ...rows[0],
      admins,
    };
  },

  async createSchool() {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Locking nextval in this transaction makes the generated tenant code
      // collision-safe even when managers create schools concurrently.
      const { rows: sequenceRows } = await client.query(
        "SELECT nextval('public.school_code_sequence') AS value"
      );
      const code = `SCH-${String(sequenceRows[0].value).padStart(4, "0")}`;

      // A tenant has no profile until its invited school_admin completes setup.
      const { rows } = await client.query(
        `
        INSERT INTO public.schools (name, code, slug, status, setup_completed)
        VALUES (NULL, $1, $2, 'pending_setup', FALSE)
        RETURNING *
        `,
        [code, code.toLowerCase()]
      );
      const school = rows[0];

      // Insert default school_settings
      await client.query(
        `
        INSERT INTO public.school_settings (school_id, display_name)
        VALUES ($1, $2)
        ON CONFLICT (school_id) DO NOTHING
        `,
        [school.id, null]
      );

      await client.query("COMMIT");
      return school;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async lockSchool(schoolId, reason) {
    const { rows } = await pool.query(
      `
      UPDATE public.schools
      SET status = 'locked', locked_at = NOW(), lock_reason = $2, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [schoolId, reason || "Khóa bởi quản trị viên"]
    );
    return rows[0] || null;
  },

  async unlockSchool(schoolId) {
    const { rows } = await pool.query(
      `
      UPDATE public.schools
      SET status = 'active', locked_at = NULL, lock_reason = NULL, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [schoolId]
    );
    return rows[0] || null;
  },

  async suspendSchool(schoolId, reason) {
    const { rows } = await pool.query(
      `
      UPDATE public.schools
      SET status = 'suspended', suspended_at = NOW(), suspension_reason = $2, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [schoolId, reason || "Hết hạn hợp đồng hoặc tạm dừng"]
    );
    return rows[0] || null;
  },

  async unsuspendSchool(schoolId) {
    const { rows } = await pool.query(
      `
      UPDATE public.schools
      SET status = 'active', suspended_at = NULL, suspension_reason = NULL, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
      `,
      [schoolId]
    );
    return rows[0] || null;
  },

  async softDeleteSchool(schoolId) {
    const { rows } = await pool.query(
      `
      UPDATE public.schools
      SET deleted_at = NOW(), status = 'deleted', updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id, name, status, deleted_at
      `,
      [schoolId]
    );
    return rows[0] || null;
  },

  // =========================================================================
  // HANDOVER & INVITATIONS
  // =========================================================================

  async createInvitation({ schoolId, recipientEmail, tokenHash, invitedBy, expiresAt }) {
    const { rows } = await pool.query(
      `
      INSERT INTO public.school_invitations (
        school_id, recipient_email, token_hash, status, invited_by, expires_at
      )
      VALUES ($1, $2, $3, 'pending', $4, $5)
      RETURNING *
      `,
      [schoolId, recipientEmail.toLowerCase().trim(), tokenHash, invitedBy, expiresAt]
    );
    return rows[0];
  },

  async findInvitationByToken(tokenHash) {
    const { rows } = await pool.query(
      `
      SELECT
        si.*,
        s.name AS school_name,
        s.code AS school_code,
        s.status AS school_status
      FROM public.school_invitations si
      INNER JOIN public.schools s ON s.id = si.school_id
      WHERE si.token_hash = $1
      LIMIT 1
      `,
      [tokenHash]
    );
    return rows[0] || null;
  },

  async acceptInvitation({ tokenHash, userId }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: invitationRows } = await client.query(
        `
        SELECT id, school_id, recipient_email, status, expires_at
        FROM public.school_invitations
        WHERE token_hash = $1
        FOR UPDATE
        `,
        [tokenHash]
      );
      const invitation = invitationRows[0];
      if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date()) {
        const error = new Error("INVITATION_INVALID_OR_EXPIRED");
        error.status = 400;
        throw error;
      }

      const { rows: userRows } = await client.query(
        `SELECT email FROM public.users WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [userId]
      );
      if (!userRows[0] || userRows[0].email.toLowerCase() !== invitation.recipient_email.toLowerCase()) {
        const error = new Error("INVITATION_RECIPIENT_MISMATCH");
        error.status = 403;
        throw error;
      }

      // 1. Mark invitation accepted
      await client.query(
        `
        UPDATE public.school_invitations
        SET status = 'accepted', accepted_at = NOW()
        WHERE id = $1 AND status = 'pending'
        `,
        [invitation.id]
      );

      // 2. Assign user as school_admin in school_memberships
      await client.query(
        `
        INSERT INTO public.school_memberships (school_id, user_id, role, status)
        VALUES ($1, $2, 'school_admin', 'active')
        ON CONFLICT (school_id, user_id)
        DO UPDATE SET role = 'school_admin', status = 'active', updated_at = NOW()
        `,
        [invitation.school_id, userId]
      );

      await client.query("COMMIT");
      return invitation;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async listInvitationsBySchool(schoolId) {
    const { rows } = await pool.query(
      `
      SELECT
        si.*,
        u.email AS invited_by_email
      FROM public.school_invitations si
      LEFT JOIN public.users u ON u.id = si.invited_by
      WHERE si.school_id = $1
      ORDER BY si.created_at DESC
      `,
      [schoolId]
    );
    return rows;
  },

  // =========================================================================
  // CONTRACTS & SUBSCRIPTIONS
  // =========================================================================

  async listContracts({ page = 1, limit = 20, status, schoolId } = {}) {
    const offset = (Math.max(1, page) - 1) * limit;
    const whereConditions = [];
    const params = [];

    if (status) {
      params.push(status);
      whereConditions.push(`ss.status = $${params.length}`);
    }

    if (schoolId) {
      params.push(schoolId);
      whereConditions.push(`ss.school_id = $${params.length}`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.school_subscriptions ss ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);

    const { rows } = await pool.query(
      `
      SELECT
        ss.id,
        ss.school_id,
        s.name AS school_name,
        s.code AS school_code,
        ss.plan_id,
        p.name AS plan_name,
        ss.billing_cycle,
        ss.price_snapshot,
        ss.status,
        ss.start_date,
        ss.end_date,
        ss.created_at,
        ss.updated_at
      FROM public.school_subscriptions ss
      INNER JOIN public.schools s ON s.id = ss.school_id
      INNER JOIN public.subscription_plans p ON p.id = ss.plan_id
      ${whereClause}
      ORDER BY ss.created_at DESC
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

  // =========================================================================
  // TRANSACTIONS
  // =========================================================================

  async listTransactions({ page = 1, limit = 20, status, schoolId } = {}) {
    const offset = (Math.max(1, page) - 1) * limit;
    const whereConditions = [];
    const params = [];

    if (status) {
      params.push(status);
      whereConditions.push(`pt.status = $${params.length}`);
    }

    if (schoolId) {
      params.push(schoolId);
      whereConditions.push(`pt.school_id = $${params.length}`);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.payment_transactions pt ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total || 0;

    params.push(limit);
    params.push(offset);

    const { rows } = await pool.query(
      `
      SELECT
        pt.id,
        pt.school_id,
        s.name AS school_name,
        s.code AS school_code,
        pt.subscription_id,
        pt.plan_id,
        p.name AS plan_name,
        pt.amount,
        pt.payment_method,
        pt.status,
        pt.order_reference,
        pt.transaction_reference,
        pt.vnp_pay_date,
        pt.vnp_bank_code,
        pt.vnp_response_code,
        pt.paid_at,
        pt.created_at
      FROM public.payment_transactions pt
      INNER JOIN public.schools s ON s.id = pt.school_id
      LEFT JOIN public.subscription_plans p ON p.id = pt.plan_id
      ${whereClause}
      ORDER BY pt.created_at DESC
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

  // =========================================================================
  // REVENUE REPORTS
  // =========================================================================

  async getRevenueReports() {
    // 1. Total revenue
    const totalRes = await pool.query(
      `
      SELECT
        COALESCE(SUM(amount), 0)::numeric(15, 2) AS total_revenue,
        COUNT(*)::int AS total_successful_payments
      FROM public.payment_transactions
      WHERE status = 'success'
      `
    );

    // 2. Revenue by plan
    const planRes = await pool.query(
      `
      SELECT
        COALESCE(p.name, 'Chưa xác định') AS plan_name,
        COALESCE(p.id, pt.plan_id) AS plan_id,
        COUNT(pt.id)::int AS transaction_count,
        COALESCE(SUM(pt.amount), 0)::numeric(15, 2) AS revenue
      FROM public.payment_transactions pt
      LEFT JOIN public.subscription_plans p ON p.id = pt.plan_id
      WHERE pt.status = 'success'
      GROUP BY p.name, p.id, pt.plan_id
      ORDER BY revenue DESC
      `
    );

    // 3. Revenue by month (last 12 months)
    const monthlyRes = await pool.query(
      `
      SELECT
        TO_CHAR(COALESCE(paid_at, created_at), 'YYYY-MM') AS month,
        COUNT(id)::int AS transaction_count,
        COALESCE(SUM(amount), 0)::numeric(15, 2) AS revenue
      FROM public.payment_transactions
      WHERE status = 'success'
        AND COALESCE(paid_at, created_at) >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(COALESCE(paid_at, created_at), 'YYYY-MM')
      ORDER BY month ASC
      `
    );

    // 4. Revenue by school (top 10)
    const schoolRes = await pool.query(
      `
      SELECT
        s.id AS school_id,
        s.name AS school_name,
        s.code AS school_code,
        COUNT(pt.id)::int AS transaction_count,
        COALESCE(SUM(pt.amount), 0)::numeric(15, 2) AS total_paid
      FROM public.payment_transactions pt
      INNER JOIN public.schools s ON s.id = pt.school_id
      WHERE pt.status = 'success'
      GROUP BY s.id, s.name, s.code
      ORDER BY total_paid DESC
      LIMIT 10
      `
    );

    return {
      summary: totalRes.rows[0] || { total_revenue: 0, total_successful_payments: 0 },
      by_plan: planRes.rows,
      by_month: monthlyRes.rows,
      by_school: schoolRes.rows,
    };
  },
};

module.exports = PlatformRepository;
