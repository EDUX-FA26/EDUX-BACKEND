const { pool } = require('../../config/db.config');

const LearningRepository = {
  /** Verify that a student is actively enrolled in at least one class of a subject. */
  async isStudentActiveInSubject(studentId, subjectId) {
    const { rows } = await pool.query(
      `SELECT 1
       FROM class_members cm
       JOIN classes c ON c.id = cm.class_id
       WHERE cm.student_id = $1
         AND c.subject_id = $2
         AND cm.status = 'active'
         AND c.is_active = true
       LIMIT 1`,
      [studentId, subjectId]
    );
    return rows.length > 0;
  },

  async findAssignmentGradesBySubject(studentId, subjectId) {
    const { rows } = await pool.query(
      `SELECT g.id AS grade_id, g.assignment_id, a.title AS assignment_title,
              g.score, g.max_score, g.feedback, g.graded_at
       FROM grades g
       JOIN submissions sub ON sub.id = g.submission_id
       JOIN assignments a ON a.id = g.assignment_id
       JOIN classes c ON c.id = a.class_id
       WHERE g.student_id = $1
         AND c.subject_id = $2
         AND sub.student_id = $1
         AND sub.status = 'graded'
       ORDER BY g.graded_at DESC NULLS LAST, g.created_at DESC`,
      [studentId, subjectId]
    );
    return rows;
  },

  async findSubmittedFlashcardTestsBySubject(studentId, subjectId, limit) {
    const { rows } = await pool.query(
      `SELECT ft.id AS test_id, ft.deck_id, fd.title AS deck_title, ft.total_questions,
              ft.score, ft.started_at, ft.submitted_at,
              COUNT(fta.id)::int AS answered_count,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = true)::int AS correct_count,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = false)::int AS incorrect_count
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON fd.id = ft.deck_id
       LEFT JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       WHERE ft.user_id = $1 AND fd.subject_id = $2 AND ft.status = 'submitted'
         AND (
           fd.is_public = true
           OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
           OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
         )
       GROUP BY ft.id, fd.id
       ORDER BY ft.submitted_at DESC NULLS LAST, ft.started_at DESC
       LIMIT $3`,
      [studentId, subjectId, limit]
    );
    return rows;
  },

  async getFlashcardTestAnswerSummaryBySubject(studentId, subjectId) {
    const { rows } = await pool.query(
      `SELECT COUNT(fta.id)::int AS total_answers,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = true)::int AS correct_answers,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = false)::int AS incorrect_answers,
              COUNT(DISTINCT fta.flashcard_id)::int AS distinct_flashcards
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON fd.id = ft.deck_id
       JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       WHERE ft.user_id = $1 AND fd.subject_id = $2 AND ft.status = 'submitted'
         AND (
           fd.is_public = true
           OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
           OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
         )`,
      [studentId, subjectId]
    );
    return rows[0];
  },

  async findWrongFlashcardTestAnswersBySubject(studentId, subjectId, limit) {
    const { rows } = await pool.query(
      `SELECT ft.id AS test_id, ft.deck_id, fd.title AS deck_title, ft.submitted_at,
              fta.flashcard_id, fta.student_answer, fta.score,
              fc.question, fc.type AS question_type, fc.options,
              fc.answer AS correct_answer, fc.explanation
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON fd.id = ft.deck_id
       JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       JOIN flashcards fc ON fc.id = fta.flashcard_id
       WHERE ft.user_id = $1
         AND fd.subject_id = $2
         AND ft.status = 'submitted'
         AND fta.is_correct = false
         AND (
           fd.is_public = true
           OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
           OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
         )
       ORDER BY ft.submitted_at DESC NULLS LAST, ft.started_at DESC
       LIMIT $3`,
      [studentId, subjectId, limit]
    );
    return rows;
  },

  async getFlashcardReviewSummaryBySubject(studentId, subjectId) {
    const { rows } = await pool.query(
      `SELECT COUNT(fr.id)::int AS total_reviews,
              COUNT(fr.id) FILTER (WHERE fr.result = 'again')::int AS again,
              COUNT(fr.id) FILTER (WHERE fr.result = 'hard')::int AS hard,
              COUNT(fr.id) FILTER (WHERE fr.result = 'good')::int AS good,
              COUNT(fr.id) FILTER (WHERE fr.result = 'easy')::int AS easy
       FROM flashcard_reviews fr
       JOIN flashcards fc ON fc.id = fr.flashcard_id
       JOIN flashcard_decks fd ON fd.id = fc.deck_id
       WHERE fr.user_id = $1 AND fd.subject_id = $2
         AND (
           fd.is_public = true
           OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
           OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
         )`,
      [studentId, subjectId]
    );
    return rows[0];
  },

  async findFlashcardReviewHistoryBySubject(studentId, subjectId, limit) {
    const { rows } = await pool.query(
      `SELECT fr.id AS review_id, fr.flashcard_id, fr.result, fr.reviewed_at,
              fc.question, fd.id AS deck_id, fd.title AS deck_title
       FROM flashcard_reviews fr
       JOIN flashcards fc ON fc.id = fr.flashcard_id
       JOIN flashcard_decks fd ON fd.id = fc.deck_id
       WHERE fr.user_id = $1 AND fd.subject_id = $2
         AND (
           fd.is_public = true
           OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
           OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
         )
       ORDER BY fr.reviewed_at DESC
       LIMIT $3`,
      [studentId, subjectId, limit]
    );
    return rows;
  },

  async findDueFlashcardsBySubject(studentId, subjectId) {
    const { rows } = await pool.query(
      `SELECT fc.id AS flashcard_id, fc.type AS question_type, fc.question, fc.options,
              fc.difficulty, fc.position, fd.id AS deck_id, fd.title AS deck_title,
              fs.due_date, fs.interval_days, fs.repetitions, fs.ease_factor, fs.last_reviewed_at
       FROM flashcard_schedules fs
       JOIN flashcards fc ON fc.id = fs.flashcard_id AND fc.is_active = true
       JOIN flashcard_decks fd ON fd.id = fc.deck_id AND fd.is_active = true
       WHERE fs.user_id = $1
         AND fd.subject_id = $2
         AND fs.due_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         AND (
           fd.is_public = true
           OR fd.class_id IN (
             SELECT class_id FROM class_members
             WHERE student_id = $1 AND status = 'active'
           )
           OR fd.id IN (
             SELECT fdca.deck_id
             FROM flashcard_deck_class_access fdca
             JOIN class_members cm ON cm.class_id = fdca.class_id
             WHERE cm.student_id = $1 AND cm.status = 'active'
           )
         )
       ORDER BY fs.due_date ASC, fc.position ASC`,
      [studentId, subjectId]
    );
    return rows;
  },
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
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
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

