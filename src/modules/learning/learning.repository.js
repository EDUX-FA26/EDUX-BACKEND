const { pool } = require('../../config/db.config');

const LearningRepository = {
  /**
   * Lấy 1 streak của user theo subject (kèm thông tin subject)
   */
  async findStreakByUserAndSubject(userId, subjectId, client = null) {
    const q = client || pool;
    const query = `
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ss.user_id = $1 AND ss.subject_id = $2
    `;
    const { rows } = await q.query(query, [userId, subjectId]);
    return rows[0] || null;
  },

  /**
   * Lấy tất cả streak của user (theo từng subject)
   */
  async findAllStreaksByUser(userId) {
    const query = `
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ss.user_id = $1 AND ss.is_active = true
      ORDER BY s.name ASC
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  },

  /**
   * Tạo bản ghi streak khởi tạo nếu chưa tồn tại
   */
  async getOrCreateStreakRow(userId, subjectId, client = null) {
    const q = client || pool;
    const insertQuery = `
      INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, recovery_used)
      VALUES ($1, $2, 0, 0, 0)
      ON CONFLICT (user_id, subject_id) DO NOTHING
      RETURNING *
    `;
    await q.query(insertQuery, [userId, subjectId]);

    const selectQuery = `
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ss.user_id = $1 AND ss.subject_id = $2
    `;
    const { rows } = await q.query(selectQuery, [userId, subjectId]);
    return rows[0];
  },

  /**
   * Khóa row streak phục vụ transaction (chống concurrency race conditions)
   */
  async lockStreakForUpdate(userId, subjectId, client) {
    // Đảm bảo row đã tồn tại
    await client.query(`
      INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, recovery_used)
      VALUES ($1, $2, 0, 0, 0)
      ON CONFLICT (user_id, subject_id) DO NOTHING
    `, [userId, subjectId]);

    const query = `
      SELECT ss.*, s.name AS subject_name
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ss.user_id = $1 AND ss.subject_id = $2
      FOR UPDATE
    `;
    const { rows } = await client.query(query, [userId, subjectId]);
    return rows[0];
  },


  /**
 * Kiểm tra user đã có activity của môn trong ngày chưa
 * Dùng để đảm bảo streak chỉ tăng 1 lần / subject / day
 */

  async hasActivityToday(userId, subjectId, activityDate, client = null) {
    const q = client || pool;

    const query = `
    SELECT 1
    FROM subject_streak_activities
    WHERE user_id = $1
      AND subject_id = $2
      AND activity_date = $3
    LIMIT 1
  `;

    const { rows } = await q.query(query, [
      userId,
      subjectId,
      activityDate,
    ]);

    return rows.length > 0;
  },

  /**
 * Thêm bản ghi activity (idempotent nhờ UNIQUE constraint)
 */

  async insertActivity(userId, subjectId, deckId, activityDate, activityType, client) {
    const q = client || pool;
    const query = `
      INSERT INTO subject_streak_activities
        (user_id, subject_id, flashcard_deck_id, activity_date, activity_type)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (
    user_id,
    subject_id,
    flashcard_deck_id,
    activity_date
) DO NOTHING
      RETURNING *
    `;
    const { rows } = await q.query(query, [
      userId,
      subjectId,
      deckId || null,
      activityDate,
      activityType || 'flashcard_deck_completed',
    ]);
    return rows[0] || null;
  },

  /**
   * Cập nhật bản ghi subject_streaks
   */
  async updateStreak(userId, subjectId, data, client = null) {
    const q = client || pool;
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = [
      'current_streak',
      'longest_streak',
      'last_activity_date',
      'recovery_used',
      'recovery_month',
      'is_active',
      'streak_lost_at',
    ];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(data[key]);
      }
    }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(userId, subjectId);

    const query = `
      UPDATE subject_streaks
      SET ${fields.join(', ')}
      WHERE user_id = $${idx++} AND subject_id = $${idx++}
      RETURNING *
    `;
    const { rows } = await q.query(query, values);
    return rows[0];
  },

  /**
   * Lấy lịch sử hoạt động học tập có phân trang
   */
  async findActivities(userId, { page = 1, limit = 20, subjectId = null } = {}) {
    page = Number(page) || 1;
    limit = Number(limit) || 20;
    const offset = (page - 1) * limit;

    const params = [userId];
    const where = [`ssa.user_id = $1`];

    if (subjectId) {
      params.push(subjectId);
      where.push(`ssa.subject_id = $${params.length}`);
    }

    const whereStr = `WHERE ${where.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*) FROM subject_streak_activities ssa
      ${whereStr}
    `;
    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const dataQuery = `
      SELECT
        ssa.id,
        ssa.user_id,
        ssa.subject_id,
        ssa.flashcard_deck_id,
        TO_CHAR(ssa.activity_date, 'YYYY-MM-DD') AS activity_date,
        ssa.activity_type,
        ssa.created_at,
        s.name AS subject_name,
        s.code AS subject_code,
        fd.title AS deck_title
      FROM subject_streak_activities ssa
      JOIN subjects s ON ssa.subject_id = s.id
      LEFT JOIN flashcard_decks fd ON ssa.flashcard_deck_id = fd.id
      ${whereStr}
      ORDER BY ssa.activity_date DESC, ssa.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await pool.query(dataQuery, params);
    return { data: rows, total, page, limit };
  },

  /**
   * Lấy dữ liệu heatmap tổng hợp theo ngày
   */
  async findHeatmap(userId, { subjectId = null, startDate = null, endDate = null, year = null } = {}) {
    const params = [userId];
    const where = [
      `ssa.user_id = $1`,
      `ssa.activity_type = 'flashcard_deck_completed'`,
    ];

    if (subjectId) {
      params.push(subjectId);
      where.push(`ssa.subject_id = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      where.push(`ssa.activity_date >= $${params.length}::date`);
    }

    if (endDate) {
      params.push(endDate);
      where.push(`ssa.activity_date <= $${params.length}::date`);
    }

    if (year) {
      params.push(year);
      where.push(`EXTRACT(YEAR FROM ssa.activity_date) = $${params.length}`);
    }

    const whereStr = `WHERE ${where.join(' AND ')}`;

    const query = `
      SELECT
        TO_CHAR(ssa.activity_date, 'YYYY-MM-DD') AS date,
        ssa.subject_id AS "subjectId",
        s.name AS "subjectName",
        COUNT(DISTINCT ssa.flashcard_deck_id)::int AS count,
        true AS completed
      FROM subject_streak_activities ssa
      JOIN subjects s ON ssa.subject_id = s.id
      ${whereStr}
      GROUP BY ssa.activity_date, ssa.subject_id, s.name
      ORDER BY ssa.activity_date ASC
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Kiểm tra thông tin flashcard deck (để lấy subject_id và check access)
   */
  async findDeckById(deckId) {
    const query = `
      SELECT fd.*, s.name AS subject_name, s.code AS subject_code
      FROM flashcard_decks fd
      JOIN subjects s ON fd.subject_id = s.id
      WHERE fd.id = $1
    `;
    const { rows } = await pool.query(query, [deckId]);
    return rows[0] || null;
  },

  /**
   * Kiểm tra subject tồn tại
   */
  async findSubjectById(subjectId) {
    const query = `SELECT id, name, code FROM subjects WHERE id = $1 AND is_active = true`;
    const { rows } = await pool.query(query, [subjectId]);
    return rows[0] || null;
  },

  /**
   * Kiểm tra student có trong class_members không
   */
  async isUserInClass(classId, userId) {
    const query = `
      SELECT 1 FROM class_members
      WHERE class_id = $1 AND student_id = $2 AND status = 'active'
    `;
    const { rows } = await pool.query(query, [classId, userId]);
    return rows.length > 0;
  },
};

module.exports = LearningRepository;

