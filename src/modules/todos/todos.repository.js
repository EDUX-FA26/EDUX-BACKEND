const { pool } = require('../../config/db.config');
const { TIMEZONE } = require('../focus/focus.constants');

const TODAY = `(NOW() AT TIME ZONE '${TIMEZONE}')::date`;

// Todo + dữ liệu THAM CHIẾU được JOIN trực tiếp (không sao chép Study Plan)
const SELECT_TODO = `
  SELECT t.*,
         tp.name  AS topic_name,
         sj.name  AS subject_name,
         sj.code  AS subject_code,
         fd.title AS deck_title,
         spd.day_number     AS plan_day_number,
         spd.activity       AS plan_day_activity,
         spd.content_status AS plan_day_content_status,
         sp.id              AS plan_id,
         (sp.starts_on + (spd.day_number - 1)) AS plan_day_date,
         EXISTS (
           SELECT 1 FROM study_plan_day_submissions s
           WHERE s.plan_day_id = spd.id AND s.student_id = t.user_id
         ) AS plan_day_submitted,
         (t.status <> 'COMPLETED' AND t.due_date IS NOT NULL AND t.due_date < ${TODAY}) AS is_overdue
  FROM todos t
  LEFT JOIN topics tp           ON tp.id = t.topic_id
  LEFT JOIN subjects sj         ON sj.id = t.subject_id
  LEFT JOIN flashcard_decks fd  ON fd.id = t.flashcard_deck_id
  LEFT JOIN study_plan_days spd ON spd.id = t.study_plan_day_id
  LEFT JOIN study_plans sp      ON sp.id = spd.plan_id`;

const COLUMN_BY_FIELD = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  status: 'status',
  completedAt: 'completed_at',
  dueDate: 'due_date',
  subjectId: 'subject_id',
  topicId: 'topic_id',
  flashcardDeckId: 'flashcard_deck_id',
  studyPlanDayId: 'study_plan_day_id',
  dedupeKey: 'dedupe_key',
};

const exec = (client) => client || pool;

const TodosRepository = {
  async insert(client, d) {
    const { rows } = await exec(client).query(
      `INSERT INTO todos (
         user_id, title, description, status, priority, due_date, completed_at,
         source_type, subject_id, topic_id, flashcard_deck_id, study_plan_day_id, dedupe_key
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        d.userId, d.title, d.description || '', d.status, d.priority, d.dueDate || null,
        d.status === 'COMPLETED' ? new Date() : null,
        d.sourceType, d.subjectId || null, d.topicId || null,
        d.flashcardDeckId || null, d.studyPlanDayId || null, d.dedupeKey || null,
      ]
    );
    return rows[0].id;
  },

  async findViewById(userId, id) {
    const { rows } = await pool.query(`${SELECT_TODO} WHERE t.id = $1 AND t.user_id = $2`, [id, userId]);
    return rows[0] || null;
  },

  async findRawById(client, userId, id) {
    const { rows } = await exec(client).query(
      `SELECT * FROM todos WHERE id = $1 AND user_id = $2 ${client ? 'FOR UPDATE' : ''}`,
      [id, userId]
    );
    return rows[0] || null;
  },

  async findOpenByDedupeKey(userId, key) {
    const { rows } = await pool.query(
      `SELECT id FROM todos
       WHERE user_id = $1 AND dedupe_key = $2 AND status <> 'COMPLETED'`,
      [userId, key]
    );
    return rows[0] || null;
  },

  async findPlannerTodoByDay(userId, planDayId) {
    const { rows } = await pool.query(
      `SELECT id FROM todos
       WHERE user_id = $1 AND study_plan_day_id = $2 AND source_type = 'STUDY_PLANNER'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, planDayId]
    );
    return rows[0] || null;
  },

  async update(client, userId, id, patch) {
    const sets = [];
    const params = [id, userId];

    for (const [field, value] of Object.entries(patch)) {
      const column = COLUMN_BY_FIELD[field];
      if (!column) continue;
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) return;

    await exec(client).query(
      `UPDATE todos SET ${sets.join(', ')}, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      params
    );
  },

  async delete(userId, id) {
    const { rowCount } = await pool.query(`DELETE FROM todos WHERE id = $1 AND user_id = $2`, [id, userId]);
    return rowCount > 0;
  },

  async list(userId, f) {
    const where = ['t.user_id = $1'];
    const params = [userId];
    const add = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (f.status) add('t.status = ANY(?::text[])', f.status);
    if (f.priority) add('t.priority = ANY(?::text[])', f.priority);
    if (f.sourceType) add('t.source_type = ANY(?::text[])', f.sourceType);
    if (f.dueDate) add('t.due_date = ?::date', f.dueDate);
    if (f.dueFrom) add('t.due_date >= ?::date', f.dueFrom);
    if (f.dueTo) add('t.due_date <= ?::date', f.dueTo);
    if (f.overdue === true) where.push(`t.status <> 'COMPLETED' AND t.due_date < ${TODAY}`);
    if (f.overdue === false) where.push(`NOT (t.status <> 'COMPLETED' AND t.due_date < ${TODAY})`);
    if (f.subjectId) add('t.subject_id = ?', f.subjectId);
    if (f.topicId) add('t.topic_id = ?', f.topicId);
    if (f.q) add(`t.title ILIKE '%' || ? || '%'`, f.q.replace(/[\\%_]/g, '\\$&'));

    const whereSql = where.join(' AND ');
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM todos t WHERE ${whereSql}`,
      params
    );

    const total = countRows[0].total;
    params.push(f.limit, (f.page - 1) * f.limit);

    const { rows } = await pool.query(
      `${SELECT_TODO}
       WHERE ${whereSql}
       ORDER BY (t.status = 'COMPLETED') ASC,
                t.due_date ASC NULLS LAST,
                CASE t.priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
                t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      rows,
      pagination: {
        page: f.page,
        limit: f.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / f.limit)),
      },
    };
  },

  async stats(userId) {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'TODO')::int AS s_todo,
         COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS s_in_progress,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS s_completed,
         COUNT(*) FILTER (WHERE source_type = 'MANUAL')::int AS src_manual,
         COUNT(*) FILTER (WHERE source_type = 'AI_SUGGESTED')::int AS src_ai,
         COUNT(*) FILTER (WHERE source_type = 'STUDY_PLANNER')::int AS src_planner,
         COUNT(*) FILTER (WHERE status <> 'COMPLETED' AND priority = 'HIGH')::int AS open_high,
         COUNT(*) FILTER (WHERE status <> 'COMPLETED' AND priority = 'MEDIUM')::int AS open_medium,
         COUNT(*) FILTER (WHERE status <> 'COMPLETED' AND priority = 'LOW')::int AS open_low,
         COUNT(*) FILTER (WHERE status <> 'COMPLETED' AND due_date < ${TODAY})::int AS overdue,
         COUNT(*) FILTER (WHERE status <> 'COMPLETED' AND due_date = ${TODAY})::int AS due_today
       FROM todos WHERE user_id = $1`,
      [userId]
    );
    const r = rows[0];
    return {
      total: r.total,
      byStatus: { TODO: r.s_todo, IN_PROGRESS: r.s_in_progress, COMPLETED: r.s_completed },
      bySource: { MANUAL: r.src_manual, AI_SUGGESTED: r.src_ai, STUDY_PLANNER: r.src_planner },
      openByPriority: { HIGH: r.open_high, MEDIUM: r.open_medium, LOW: r.open_low },
      overdue: r.overdue,
      dueToday: r.due_today,
      completionRate: r.total ? Math.round((r.s_completed / r.total) * 100) : 0,
    };
  },

  // ── Tham chiếu hợp lệ ────────────────────────────────
  async findTopic(topicId) {
    const { rows } = await pool.query(
      `SELECT id, subject_id, is_active FROM topics WHERE id = $1`,
      [topicId]
    );
    return rows[0] || null;
  },

  async findDeckAccessible(userId, deckId) {
    const { rows } = await pool.query(
      `SELECT fd.id, fd.subject_id
       FROM flashcard_decks fd
       WHERE fd.id = $1 AND fd.is_active = true
         AND (
           fd.is_public = true
           OR fd.created_by = $2
           OR fd.class_id IN (
             SELECT class_id FROM class_members WHERE student_id = $2 AND status = 'active'
           )
         )`,
      [deckId, userId]
    );
    return rows[0] || null;
  },

  /** Ngày học của chính sinh viên này (kèm môn / chủ đề) — tham chiếu, không sao chép. */
  async findPlanDayForUser(userId, planDayId) {
    const { rows } = await pool.query(
      `SELECT spd.id, spd.day_number, spd.topic_id, spd.activity, spd.duration_minutes,
              spd.target_questions, spd.reason,
              sp.subject_id, (sp.starts_on + (spd.day_number - 1)) AS study_date,
              tp.name AS topic_name
       FROM study_plan_days spd
       JOIN study_plans sp ON sp.id = spd.plan_id
       JOIN topics tp ON tp.id = spd.topic_id
       WHERE spd.id = $1 AND sp.student_id = $2`,
      [planDayId, userId]
    );
    return rows[0] || null;
  },

  /** Các ngày học CHƯA nộp bài trong kế hoạch gần nhất, kèm Todo đã tạo (nếu có). */
  async listPlanSuggestions(userId, subjectId) {
    const params = [userId];
    let subjectSql = '';
    if (subjectId) {
      params.push(subjectId);
      subjectSql = `AND sp.subject_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT spd.id AS plan_day_id, spd.day_number, spd.activity, spd.duration_minutes,
              spd.target_questions, spd.reason, spd.content_status,
              (sp.starts_on + (spd.day_number - 1)) AS study_date,
              sp.subject_id, sj.name AS subject_name, sj.code AS subject_code,
              tp.id AS topic_id, tp.name AS topic_name,
              td.id AS todo_id, td.status AS todo_status
       FROM study_plans sp
       JOIN study_plan_days spd ON spd.plan_id = sp.id
       JOIN topics tp ON tp.id = spd.topic_id
       JOIN subjects sj ON sj.id = sp.subject_id
       LEFT JOIN todos td
         ON td.user_id = sp.student_id
        AND td.study_plan_day_id = spd.id
        AND td.source_type = 'STUDY_PLANNER'
       WHERE sp.student_id = $1
         AND sp.starts_on >= ${TODAY} - 6
         AND NOT EXISTS (
           SELECT 1 FROM study_plan_day_submissions s
           WHERE s.plan_day_id = spd.id AND s.student_id = sp.student_id
         )
         ${subjectSql}
       ORDER BY study_date ASC, sj.name ASC
       LIMIT 30`,
      params
    );
    return rows;
  },
};

module.exports = TodosRepository;

