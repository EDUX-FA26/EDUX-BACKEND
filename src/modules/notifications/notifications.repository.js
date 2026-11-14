const { pool } = require('../../config/db.config');

function validateNotificationScope(scope, schoolId) {
  if (scope === "school" && schoolId) {
    return;
  }

  if (scope === "platform" && schoolId == null) {
    return;
  }

  const error = new Error("INVALID_NOTIFICATION_SCOPE");
  error.status = 400;
  throw error;
}

function addSchoolVisibility(whereConditions, params, schoolId) {
  if (!schoolId) {
    const error = new Error("SCHOOL_CONTEXT_REQUIRED");
    error.status = 400;
    throw error;
  }

  params.push(schoolId);

  whereConditions.push(`
    (
      (
        notification_scope = 'school'
        AND school_id = $${params.length}
      )
      OR
      (
        notification_scope = 'platform'
        AND school_id IS NULL
      )
    )
  `);
}

const NotificationsRepository = {
  /**
   * Lấy danh sách thông báo của user có phân trang và Tenant Scope
   * Lấy thông báo thuộc trường hiện tại (notification_scope = 'school' AND school_id = $schoolId)
   * hoặc thông báo toàn hệ thống (notification_scope = 'platform')
   */
  async findByUserId({ userId, schoolId, page, limit, is_read }) {
    page = Math.max(
      1,
      Math.floor(Number(page) || 1)
    );

    limit = Math.min(
      100,
      Math.max(1, Math.floor(Number(limit) || 20))
    );
    const offset = (page - 1) * limit;
    const params = [userId];
    const whereConditions = ['user_id = $1'];

    addSchoolVisibility(
      whereConditions,
      params,
      schoolId
    );
    if (typeof is_read === 'boolean') {
      params.push(is_read);
      whereConditions.push(`is_read = $${params.length}`);
    }

    const where = `WHERE ${whereConditions.join(' AND ')}`;

    // Count total
    const countQuery = `SELECT COUNT(*) FROM notifications ${where}`;
    const totalResult = await pool.query(countQuery, params);
    const total = parseInt(totalResult.rows[0].count, 10);

    // Fetch paginated rows
    const query = `
      SELECT id, user_id, title, message, type, related_entity_type, related_entity_id,
             school_id, notification_scope,
             is_read, read_at, created_at, updated_at
      FROM notifications
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    return { data: rows, total };
  },

  /**
   * Lấy số lượng thông báo chưa đọc trong Tenant Scope
   */
  async countUnread(userId, schoolId) {
    const params = [userId];

    const whereConditions = [
      'user_id = $1',
      'is_read = false'
    ];

    addSchoolVisibility(
      whereConditions,
      params,
      schoolId
    );

    const query = `
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE ${whereConditions.join(' AND ')}
  `;

    const { rows } = await pool.query(
      query,
      params
    );

    return Number(rows[0]?.count || 0);
  },

  /**
   * Lấy chi tiết một thông báo có kiểm tra Tenant Scope
   */
  async findById(id, userId, schoolId) {
    const params = [id, userId];
    const whereConditions = ['id = $1', 'user_id = $2'];
    addSchoolVisibility(whereConditions, params, schoolId);
    const query = `
      SELECT id, user_id, title, message, type, related_entity_type, related_entity_id,
             notification_scope, school_id,
             is_read, read_at, created_at, updated_at
      FROM notifications
      WHERE ${whereConditions.join(' AND ')}
    `;
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  /**
   * Đánh dấu một thông báo là đã đọc với Tenant Scope
   */
  async markAsRead(id, userId, schoolId) {
    const params = [id, userId];
    const whereConditions = ['id = $1', 'user_id = $2', 'is_read = false'];
    addSchoolVisibility(whereConditions, params, schoolId);
    const query = `
      UPDATE notifications
      SET is_read = true, read_at = NOW(), updated_at = NOW()
      WHERE ${whereConditions.join(' AND ')}
      RETURNING *
    `;
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  /**
   * Đánh dấu tất cả thông báo chưa đọc của user là đã đọc trong Tenant Scope
   */
  async markAllAsRead(userId, schoolId) {
    const params = [userId];
    const whereConditions = ['user_id = $1', 'is_read = false'];
    addSchoolVisibility(whereConditions, params, schoolId);
    const query = `
      UPDATE notifications
      SET is_read = true, read_at = NOW(), updated_at = NOW()
      WHERE ${whereConditions.join(' AND ')}
    `;
    const result = await pool.query(query, params);
    return result.rowCount;
  },

  /**
   * Tạo thông báo mới (hỗ trợ school_id và notification_scope)
   * Tuyệt đối không fallback school_id: School notification bắt buộc có school_id hợp lệ,
   * Platform notification bắt buộc notification_scope = 'platform' và school_id = NULL.
   */
  async create({
    userId,
    title,
    message,
    type,
    related_entity_type = null,
    related_entity_id = null,
    notification_scope = null,
    school_id = null,
  }) {
    validateNotificationScope(
      notification_scope,
      school_id
    );
    const query = `
      INSERT INTO notifications (
        user_id, title, message, type, related_entity_type,
        related_entity_id, notification_scope, school_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [
      userId,
      title,
      message,
      type,
      related_entity_type,
      related_entity_id,
      notification_scope,
      school_id,
    ];
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Bulk tạo nhiều thông báo cùng lúc với Tenant Scope
   */
  /**
 * Bulk tạo notifications theo Tenant Scope
 */
  async bulkCreate(notifications) {
    if (!Array.isArray(notifications) || notifications.length === 0) {
      return [];
    }

    const values = [];
    const params = [];
    let idx = 1;

    for (const n of notifications) {
      // Kiểm tra scope trước khi INSERT
      validateNotificationScope(
        n.notification_scope,
        n.school_id
      );

      values.push(
        `(
        $${idx},
        $${idx + 1},
        $${idx + 2},
        $${idx + 3},
        $${idx + 4},
        $${idx + 5},
        $${idx + 6},
        $${idx + 7}
      )`
      );

      params.push(
        n.userId,
        n.title,
        n.message,
        n.type,
        n.related_entity_type ?? null,
        n.related_entity_id ?? null,
        n.notification_scope,
        n.school_id ?? null
      );

      idx += 8;
    }

    const query = `
    INSERT INTO notifications (
      user_id,
      title,
      message,
      type,
      related_entity_type,
      related_entity_id,
      notification_scope,
      school_id
    )
    VALUES ${values.join(', ')}
    RETURNING *
  `;

    const { rows } = await pool.query(
      query,
      params
    );

    return rows;
  },
};

module.exports = NotificationsRepository;
