const { pool } = require('../../config/db.config');

const NotificationsRepository = {
  /**
   * Lấy danh sách thông báo của user có phân trang
   */
  async findByUserId({ userId, page, limit, is_read }) {
    page = Number(page) || 1;
    limit = Number(limit) || 20;
    const offset = (page - 1) * limit;
    const params = [userId];
    const whereConditions = ['user_id = $1'];

    if (typeof is_read === 'boolean') {
      whereConditions.push(`is_read = $${params.length + 1}`);
      params.push(is_read);
    }

    const where = `WHERE ${whereConditions.join(' AND ')}`;

    // Count total
    const countQuery = `SELECT COUNT(*) FROM notifications ${where}`;
    const totalResult = await pool.query(countQuery, params);
    const total = parseInt(totalResult.rows[0].count, 10);

    // Fetch paginated rows
    const query = `
      SELECT id, title, message, type, related_entity_type, related_entity_id,
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
   * Lấy số lượng thông báo chưa đọc
   */
  async countUnread(userId) {
    const query = `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false`;
    const { rows } = await pool.query(query, [userId]);
    return parseInt(rows[0].count, 10);
  },

  /**
   * Lấy chi tiết một thông báo
   */
  async findById(id) {
    const query = `
      SELECT id, user_id, title, message, type, related_entity_type, related_entity_id,
             is_read, read_at, created_at, updated_at
      FROM notifications
      WHERE id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  },

  /**
   * Đánh dấu một thông báo là đã đọc
   */
  async markAsRead(id, userId) {
    const query = `
      UPDATE notifications
      SET is_read = true, read_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND is_read = false
      RETURNING *
    `;
    const { rows } = await pool.query(query, [id, userId]);
    return rows[0];
  },

  /**
   * Đánh dấu tất cả thông báo chưa đọc của user là đã đọc
   */
  async markAllAsRead(userId) {
    const query = `
      UPDATE notifications
      SET is_read = true, read_at = NOW(), updated_at = NOW()
      WHERE user_id = $1 AND is_read = false
    `;
    const result = await pool.query(query, [userId]);
    return result.rowCount;
  },

  /**
   * Tạo thông báo mới (dùng cho các module khác gọi vào)
   */
  async create({ userId, title, message, type, related_entity_type = null, related_entity_id = null }) {
    const query = `
      INSERT INTO notifications (user_id, title, message, type, related_entity_type, related_entity_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [userId, title, message, type, related_entity_type, related_entity_id];
    const { rows } = await pool.query(query, values);
    return rows[0];
  },

  /**
   * Bulk tạo nhiều thông báo cùng lúc (ví dụ: broadcast tới nhiều user)
   */
  async bulkCreate(notifications) {
    if (!notifications || notifications.length === 0) return [];

    const values = [];
    const params = [];
    let idx = 1;

    for (const n of notifications) {
      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`);
      params.push(
        n.userId,
        n.title,
        n.message,
        n.type,
        n.related_entity_type || null,
        n.related_entity_id || null
      );
      idx += 6;
    }

    const query = `
      INSERT INTO notifications (user_id, title, message, type, related_entity_type, related_entity_id)
      VALUES ${values.join(', ')}
      RETURNING *
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  }
};

module.exports = NotificationsRepository;
