const { pool } = require('../../config/db.config');
const { TIMEZONE } = require('./focus.constants');

const SELECT_SESSION = `
  SELECT fs.*, t.title AS todo_title
  FROM focus_sessions fs
  LEFT JOIN todos t ON t.id = fs.todo_id`;

const exec = (client) => client || pool;
const num = (v) => Number(v ?? 0);

function pagination(page, limit, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

const FocusRepository = {
  // ── Session ──────────────────────────────────────────
  async findById(client, id, userId) {
    const { rows } = await exec(client).query(
      `${SELECT_SESSION} WHERE fs.id = $1 AND fs.user_id = $2`,
      [id, userId]
    );
    return rows[0] || null;
  },

  /** Khóa dòng để xử lý tuần tự các thao tác pause/resume/finish đồng thời. */
  async lockById(client, id, userId) {
    const { rows } = await client.query(
      `${SELECT_SESSION}
       WHERE fs.id = $1 AND fs.user_id = $2
       FOR UPDATE OF fs`,
      [id, userId]
    );
    return rows[0] || null;
  },

  async lockActive(client, userId) {
    const { rows } = await client.query(
      `${SELECT_SESSION}
       WHERE fs.user_id = $1 AND fs.status IN ('IN_PROGRESS', 'PAUSED')
       FOR UPDATE OF fs`,
      [userId]
    );
    return rows[0] || null;
  },

  async findActive(userId) {
    const { rows } = await pool.query(
      `${SELECT_SESSION}
       WHERE fs.user_id = $1 AND fs.status IN ('IN_PROGRESS', 'PAUSED')`,
      [userId]
    );
    return rows[0] || null;
  },

  async insert(client, s) {
    const { rows } = await client.query(
      `INSERT INTO focus_sessions (
         user_id, todo_id, status, phase, phase_seq,
         phase_elapsed_ms, phase_resumed_at,
         focus_minutes, short_break_minutes, long_break_minutes, long_break_every,
         note, started_at
       )
       VALUES ($1, $2, 'IN_PROGRESS', 'FOCUS', 1, 0, $3, $4, $5, $6, $7, $8, $3)
       RETURNING id`,
      [
        s.userId, s.todoId, s.now,
        s.focusMinutes, s.shortBreakMinutes, s.longBreakMinutes, s.longBreakEvery,
        s.note || '',
      ]
    );
    return rows[0].id;
  },

  /** Ghi lại toàn bộ trạng thái đã tính của phiên (các cột có thể thay đổi). */
  async persist(client, s) {
    await client.query(
      `UPDATE focus_sessions SET
         status = $2, phase = $3, phase_seq = $4,
         phase_elapsed_ms = $5, phase_resumed_at = $6,
         completed_pomodoros = $7, focus_ms = $8,
         note = $9, todo_id = $10, ended_at = $11,
         updated_at = NOW()
       WHERE id = $1`,
      [
        s.id, s.status, s.phase, s.phase_seq,
        s.phase_elapsed_ms, s.phase_resumed_at,
        s.completed_pomodoros, s.focus_ms,
        s.note, s.todo_id, s.ended_at,
      ]
    );
  },

  async list(userId, { statuses, todoId, from, to, page, limit }) {
    const where = ['fs.user_id = $1'];
    const params = [userId];

    if (statuses?.length) {
      params.push(statuses);
      where.push(`fs.status = ANY($${params.length}::text[])`);
    }
    if (todoId) {
      params.push(todoId);
      where.push(`fs.todo_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      where.push(`(fs.started_at AT TIME ZONE '${TIMEZONE}')::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      where.push(`(fs.started_at AT TIME ZONE '${TIMEZONE}')::date <= $${params.length}::date`);
    }

    const whereSql = where.join(' AND ');
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM focus_sessions fs WHERE ${whereSql}`,
      params
    );

    const total = countRows[0].total;
    params.push(limit, (page - 1) * limit);
    const { rows } = await pool.query(
      `${SELECT_SESSION}
       WHERE ${whereSql}
       ORDER BY fs.started_at DESC, fs.id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { rows, pagination: pagination(page, limit, total) };
  },

  // ── Todo liên kết ────────────────────────────────────
  async findLinkableTodo(client, todoId, userId) {
    const { rows } = await exec(client).query(
      `SELECT id, status FROM todos WHERE id = $1 AND user_id = $2`,
      [todoId, userId]
    );
    return rows[0] || null;
  },

  // ── Thống kê (chỉ tính phiên đã kết thúc) ────────────
  async summary(userId, { from, to }) {
    const params = [userId];
    const range = [];
    if (from) {
      params.push(from);
      range.push(`(ended_at AT TIME ZONE '${TIMEZONE}')::date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      range.push(`(ended_at AT TIME ZONE '${TIMEZONE}')::date <= $${params.length}::date`);
    }
    const rangeSql = range.length ? `AND ${range.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS sessions_completed,
         COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS sessions_cancelled,
         COALESCE(SUM(focus_ms), 0) AS focus_ms,
         COALESCE(SUM(completed_pomodoros), 0)::int AS pomodoros,
         COALESCE(MAX(focus_ms), 0) AS longest_ms
       FROM focus_sessions
       WHERE user_id = $1 AND ended_at IS NOT NULL ${rangeSql}`,
      params
    );

    const { rows: todayRows } = await pool.query(
      `SELECT
         COALESCE(SUM(focus_ms), 0) AS focus_ms,
         COALESCE(SUM(completed_pomodoros), 0)::int AS pomodoros,
         COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS sessions
       FROM focus_sessions
       WHERE user_id = $1 AND ended_at IS NOT NULL
         AND (ended_at AT TIME ZONE '${TIMEZONE}')::date
             = (NOW() AT TIME ZONE '${TIMEZONE}')::date`,
      [userId]
    );

    const r = rows[0];
    const t = todayRows[0];
    return {
      total: {
        focusSeconds: Math.floor(num(r.focus_ms) / 1000),
        sessions: r.sessions_completed,
        cancelledSessions: r.sessions_cancelled,
        pomodoros: r.pomodoros,
        longestSessionSeconds: Math.floor(num(r.longest_ms) / 1000),
        averageSessionSeconds: r.sessions_completed + r.sessions_cancelled
          ? Math.floor(num(r.focus_ms) / 1000 / (r.sessions_completed + r.sessions_cancelled))
          : 0,
      },
      today: {
        focusSeconds: Math.floor(num(t.focus_ms) / 1000),
        sessions: t.sessions,
        pomodoros: t.pomodoros,
      },
    };
  },

  async daily(userId, days) {
    const { rows } = await pool.query(
      `WITH today AS (SELECT (NOW() AT TIME ZONE '${TIMEZONE}')::date AS d),
       series AS (
         SELECT gs::date AS day
         FROM today, generate_series(today.d - ($2::int - 1), today.d, interval '1 day') gs
       )
       SELECT to_char(series.day, 'YYYY-MM-DD') AS date,
              COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
              COUNT(fs.id) FILTER (WHERE fs.status = 'COMPLETED')::int AS sessions,
              COALESCE(SUM(fs.completed_pomodoros), 0)::int AS pomodoros
       FROM series
       LEFT JOIN focus_sessions fs
         ON fs.user_id = $1 AND fs.ended_at IS NOT NULL
        AND (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date = series.day
       GROUP BY series.day
       ORDER BY series.day`,
      [userId, days]
    );
    return rows.map((r) => ({
      date: r.date,
      focusSeconds: Math.floor(num(r.focus_ms) / 1000),
      sessions: r.sessions,
      pomodoros: r.pomodoros,
    }));
  },

  async weekly(userId, weeks) {
    const { rows } = await pool.query(
      `WITH cur AS (
         SELECT date_trunc('week', NOW() AT TIME ZONE '${TIMEZONE}')::date AS w
       ),
       series AS (
         SELECT (cur.w - (gs * 7))::date AS week_start
         FROM cur, generate_series(0, $2::int - 1) gs
       )
       SELECT to_char(series.week_start, 'YYYY-MM-DD') AS week_start,
              COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
              COUNT(fs.id) FILTER (WHERE fs.status = 'COMPLETED')::int AS sessions,
              COALESCE(SUM(fs.completed_pomodoros), 0)::int AS pomodoros
       FROM series
       LEFT JOIN focus_sessions fs
         ON fs.user_id = $1 AND fs.ended_at IS NOT NULL
        AND date_trunc('week', fs.ended_at AT TIME ZONE '${TIMEZONE}')::date = series.week_start
       GROUP BY series.week_start
       ORDER BY series.week_start`,
      [userId, weeks]
    );
    return rows.map((r) => ({
      weekStart: r.week_start,
      focusSeconds: Math.floor(num(r.focus_ms) / 1000),
      sessions: r.sessions,
      pomodoros: r.pomodoros,
    }));
  },

  // ── Preferences ──────────────────────────────────────
  async getPreferences(userId) {
    const { rows } = await pool.query(`SELECT * FROM focus_preferences WHERE user_id = $1`, [userId]);
    return rows[0] || null;
  },

  async upsertPreferences(userId, p) {
    const { rows } = await pool.query(
      `INSERT INTO focus_preferences (
         user_id, background_id, master_volume, sounds,
         focus_minutes, short_break_minutes, long_break_minutes, long_break_every,
         auto_start_next, updated_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         background_id = EXCLUDED.background_id,
         master_volume = EXCLUDED.master_volume,
         sounds = EXCLUDED.sounds,
         focus_minutes = EXCLUDED.focus_minutes,
         short_break_minutes = EXCLUDED.short_break_minutes,
         long_break_minutes = EXCLUDED.long_break_minutes,
         long_break_every = EXCLUDED.long_break_every,
         auto_start_next = EXCLUDED.auto_start_next,
         updated_at = NOW()
       RETURNING *`,
      [
        userId, p.backgroundId, p.masterVolume, JSON.stringify(p.sounds),
        p.focusMinutes, p.shortBreakMinutes, p.longBreakMinutes, p.longBreakEvery,
        p.autoStartNext,
      ]
    );
    return rows[0];
  },
};

module.exports = FocusRepository;

