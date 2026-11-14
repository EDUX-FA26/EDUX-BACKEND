const { pool } = require('../../config/db.config');

const NotificationsRepository = {
  /**
   * Lấy danh sách thông báo của user có phân trang và Tenant Scope
   * Lấy thông báo thuộc trường hiện tại (notification_scope = 'school' AND school_id = $schoolId)
   * hoặc thông báo toàn hệ thống (notification_scope = 'platform')
   */
  async findByUserId({ userId, schoolId, page, limit, is_read }) {
    page = Number(page) || 1;
    limit = Number(limit) || 20;
    const offset = (page - 1) * limit;
    const params = [userId];
    const whereConditions = ['user_id = $1'];

    if (schoolId) {
      params.push(schoolId);
      whereConditions.push(`((notification_scope = 'school' AND school_id = $${params.length}) OR notification_scope = 'platform')`);
    }

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
    let query = `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`;
    const params = [userId];
    if (schoolId) {
      params.push(schoolId);
      query += ` AND ((notification_scope = 'school' AND school_id = $2) OR notification_scope = 'platform')`;
    }
    const { rows } = await pool.query(query, params);
    return parseInt(rows[0].count, 10);
  },

  /**
   * Lấy chi tiết một thông báo có kiểm tra Tenant Scope
   */
  async findById(id, schoolId) {
    let query = `
      SELECT id, user_id, title, message, type, related_entity_type, related_entity_id,
             school_id, notification_scope,
             is_read, read_at, created_at, updated_at
      FROM notifications
      WHERE id = $1
    `;
    const params = [id];
    if (schoolId) {
      params.push(schoolId);
      query += ` AND ((notification_scope = 'school' AND school_id = $2) OR notification_scope = 'platform')`;
    }
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  /**
   * Đánh dấu một thông báo là đã đọc với Tenant Scope
   */
  async markAsRead(id, userId, schoolId) {
    let query = `
      UPDATE notifications
      SET is_read = true, read_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND is_read = false
    `;
    const params = [id, userId];
    if (schoolId) {
      params.push(schoolId);
      query += ` AND ((notification_scope = 'school' AND school_id = $3) OR notification_scope = 'platform')`;
    }
    query += ` RETURNING *`;
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  /**
   * Đánh dấu tất cả thông báo chưa đọc của user là đã đọc trong Tenant Scope
   */
  async markAllAsRead(userId, schoolId) {
    let query = `
      UPDATE notifications
      SET is_read = true, read_at = NOW(), updated_at = NOW()
      WHERE user_id = $1 AND is_read = false
    `;
    const params = [userId];
    if (schoolId) {
      params.push(schoolId);
      query += ` AND ((notification_scope = 'school' AND school_id = $2) OR notification_scope = 'platform')`;
    }
    const result = await pool.query(query, params);
    return result.rowCount;
  },

  /**
   * Tạo thông báo mới (hỗ trợ school_id và notification_scope)
   * Tuyệt đối không fallback school_id: School notification bắt buộc có school_id hợp lệ,
   * Platform notification bắt buộc notification_scope = 'platform' và school_id = NULL.
   */
  async create({ userId, schoolId = null, scope = null, title, message, type, related_entity_type = null, related_entity_id = null }) {
    const finalScope = scope || (schoolId ? 'school' : 'platform');
    const finalSchoolId = finalScope === 'platform' ? null : schoolId;

    if (finalScope === 'school' && !finalSchoolId) {
      throw new Error('SCHOOL_ID_REQUIRED_FOR_SCHOOL_NOTIFICATION');
    }

    const query = `
      INSERT INTO notifications (user_id, school_id, notification_scope, title, message, type, related_entity_type, related_entity_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [userId, finalSchoolId, finalScope, title, message, type, related_entity_type, related_entity_id];
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Bulk tạo nhiều thông báo cùng lúc với Tenant Scope
   */
  async bulkCreate(notifications, defaultSchoolId = null, defaultScope = null) {
    if (!notifications || notifications.length === 0) return [];

    const values = [];
    const params = [];
    let idx = 1;

    for (const n of notifications) {
      const scope = n.scope || n.notification_scope || defaultScope || (n.schoolId || defaultSchoolId ? 'school' : 'platform');
      const schoolId = scope === 'platform' ? null : (n.schoolId || n.school_id || defaultSchoolId || null);

      if (scope === 'school' && !schoolId) {
        throw new Error('SCHOOL_ID_REQUIRED_FOR_SCHOOL_NOTIFICATION');
      }

      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`);
      params.push(
        n.userId,
        schoolId,
        scope,
        n.title,
        n.message,
        n.type,
        n.related_entity_type || null,
        n.related_entity_id || null
      );
      idx += 8;
    }

    const query = `
      INSERT INTO notifications (user_id, school_id, notification_scope, title, message, type, related_entity_type, related_entity_id)
      VALUES ${values.join(', ')}
      RETURNING *
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  }
};

module.exports = NotificationsRepository;
