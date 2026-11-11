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
         user_id, todo_id, timer_mode, status, phase, phase_seq,
         phase_elapsed_ms, phase_resumed_at,
         focus_minutes, short_break_minutes, long_break_minutes, long_break_every,
         note, started_at
       )
       VALUES ($1, $2, $3, 'IN_PROGRESS', 'FOCUS', 1, 0, $4, $5, $6, $7, $8, $9, $4)
       RETURNING id`,
      [
        s.userId, s.todoId, s.timerMode || 'pomodoro', s.now,
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
         focus_minutes = $12, short_break_minutes = $13, long_break_minutes = $14,
         updated_at = NOW()
       WHERE id = $1`,
      [
        s.id, s.status, s.phase, s.phase_seq,
        s.phase_elapsed_ms, s.phase_resumed_at,
        s.completed_pomodoros, s.focus_ms,
        s.note, s.todo_id, s.ended_at,
        s.focus_minutes, s.short_break_minutes, s.long_break_minutes,
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

  // ── Thống kê chuyên sâu (P0: Statistics Dashboard) ──────

  /**
   * Xác định mốc ngày đầu và cuối theo múi giờ Việt Nam.
   */
  async resolveTimeframeDates(timeframe = 'last_7_days', customFrom, customTo) {
    if (customFrom && customTo) {
      return {
        startDate: customFrom,
        endDate: customTo,
        prevStartDate: null,
        prevEndDate: null,
      };
    }

    const { rows } = await pool.query(
      `SELECT (NOW() AT TIME ZONE '${TIMEZONE}')::date::text AS today`
    );
    const todayStr = rows[0]?.today || new Date().toISOString().slice(0, 10);
    const today = new Date(todayStr);

    const addDays = (d, n) => {
      const res = new Date(d);
      res.setDate(res.getDate() + n);
      return res.toISOString().slice(0, 10);
    };

    if (timeframe === 'today') {
      return {
        startDate: todayStr,
        endDate: todayStr,
        prevStartDate: addDays(today, -1),
        prevEndDate: addDays(today, -1),
      };
    }

    if (timeframe === 'last_7_days') {
      return {
        startDate: addDays(today, -6),
        endDate: todayStr,
        prevStartDate: addDays(today, -13),
        prevEndDate: addDays(today, -7),
      };
    }

    if (timeframe === 'last_30_days') {
      return {
        startDate: addDays(today, -29),
        endDate: todayStr,
        prevStartDate: addDays(today, -59),
        prevEndDate: addDays(today, -30),
      };
    }

    if (timeframe === 'this_semester') {
      try {
        const { rows: semRows } = await pool.query(
          `SELECT start_date::date::text AS start_date, end_date::date::text AS end_date
           FROM semesters
           WHERE is_current = true OR (start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE)
           ORDER BY is_current DESC, start_date DESC
           LIMIT 1`
        );
        if (semRows.length > 0 && semRows[0].start_date) {
          const sStart = semRows[0].start_date;
          const sEnd = semRows[0].end_date || todayStr;
          const boundedEnd = sEnd < todayStr ? sEnd : todayStr;
          const diff = Math.max(1, Math.round((new Date(boundedEnd) - new Date(sStart)) / 86400000));
          return {
            startDate: sStart,
            endDate: boundedEnd,
            prevStartDate: addDays(new Date(sStart), -(diff + 1)),
            prevEndDate: addDays(new Date(sStart), -1),
          };
        }
      } catch {
        // fallback
      }
      return {
        startDate: addDays(today, -119),
        endDate: todayStr,
        prevStartDate: addDays(today, -239),
        prevEndDate: addDays(today, -120),
      };
    }

    // all_time
    return {
      startDate: null,
      endDate: null,
      prevStartDate: null,
      prevEndDate: null,
    };
  },

  /**
   * Tính chuỗi ngày học liên tục (Study Streak) an toàn, không lỗi khi rỗng.
   */
  async getStreak(userId) {
    const { rows } = await pool.query(
      `SELECT DISTINCT (ended_at AT TIME ZONE '${TIMEZONE}')::date::text AS study_date
       FROM focus_sessions
       WHERE user_id = $1
         AND status = 'COMPLETED'
         AND focus_ms > 0
         AND ended_at IS NOT NULL
       ORDER BY study_date DESC`,
      [userId]
    );

    if (rows.length === 0) {
      return { currentStreak: 0, longestStreak: 0, lastStudyDate: null };
    }

    const dates = rows.map((r) => r.study_date);
    const lastStudyDate = dates[0];

    const { rows: todayRows } = await pool.query(
      `SELECT (NOW() AT TIME ZONE '${TIMEZONE}')::date::text AS today,
              ((NOW() AT TIME ZONE '${TIMEZONE}')::date - 1)::text AS yesterday`
    );
    const today = todayRows[0]?.today;
    const yesterday = todayRows[0]?.yesterday;

    let currentStreak = 0;
    if (lastStudyDate === today || lastStudyDate === yesterday) {
      let expected = new Date(lastStudyDate);
      for (const dStr of dates) {
        const d = new Date(dStr);
        const diffDays = Math.round((expected - d) / 86400000);
        if (diffDays === 0) {
          currentStreak++;
          expected.setDate(expected.getDate() - 1);
        } else {
          break;
        }
      }
    }

    let longestStreak = 0;
    let tempStreak = 0;
    let prevDate = null;
    const sortedAsc = [...dates].sort();
    for (const dStr of sortedAsc) {
      const cur = new Date(dStr);
      if (!prevDate) {
        tempStreak = 1;
      } else {
        const diff = Math.round((cur - prevDate) / 86400000);
        if (diff === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
      }
      if (tempStreak > longestStreak) longestStreak = tempStreak;
      prevDate = cur;
    }

    return {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      lastStudyDate,
    };
  },

  /**
   * Thống kê tổng quan (Overview) chuẩn xác.
   */
  async statsOverview(userId, { timeframe = 'last_7_days', from, to }) {
    const streak = await this.getStreak(userId);
    const bounds = await this.resolveTimeframeDates(timeframe, from, to);

    // 1. Dữ liệu kỳ hiện tại
    const { rows: curRows } = await pool.query(
      `SELECT
         COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
         COUNT(fs.id) FILTER (WHERE fs.status = 'COMPLETED')::int AS completed_sessions,
         COUNT(fs.id) FILTER (WHERE fs.status = 'CANCELLED')::int AS cancelled_sessions,
         COALESCE(SUM(fs.completed_pomodoros), 0)::int AS pomodoros,
         COALESCE(MAX(fs.focus_ms), 0) AS longest_ms,
         COUNT(DISTINCT fs.todo_id) FILTER (WHERE fs.todo_id IS NOT NULL)::int AS total_todos,
         COUNT(DISTINCT fs.todo_id) FILTER (WHERE fs.todo_id IS NOT NULL AND td.status = 'COMPLETED')::int AS completed_todos
       FROM focus_sessions fs
       LEFT JOIN todos td ON td.id = fs.todo_id
       WHERE fs.user_id = $1
         AND fs.ended_at IS NOT NULL
         AND ($2::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date >= $2::date)
         AND ($3::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date <= $3::date)`,
      [userId, bounds.startDate, bounds.endDate]
    );

    // 2. Dữ liệu kỳ đối chiếu trước đó
    let prevFocusSeconds = 0;
    if (bounds.prevStartDate && bounds.prevEndDate) {
      const { rows: prevRows } = await pool.query(
        `SELECT COALESCE(SUM(fs.focus_ms), 0) AS focus_ms
         FROM focus_sessions fs
         WHERE fs.user_id = $1
           AND fs.ended_at IS NOT NULL
           AND (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date >= $2::date
           AND (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date <= $3::date`,
        [userId, bounds.prevStartDate, bounds.prevEndDate]
      );
      prevFocusSeconds = Math.floor(num(prevRows[0]?.focus_ms) / 1000);
    }

    // 3. Số liệu hôm nay
    const { rows: todayRows } = await pool.query(
      `SELECT
         COALESCE(SUM(focus_ms), 0) AS focus_ms,
         COUNT(id) FILTER (WHERE status = 'COMPLETED')::int AS completed_sessions,
         COALESCE(SUM(completed_pomodoros), 0)::int AS pomodoros
       FROM focus_sessions
       WHERE user_id = $1
         AND ended_at IS NOT NULL
         AND (ended_at AT TIME ZONE '${TIMEZONE}')::date = (NOW() AT TIME ZONE '${TIMEZONE}')::date`,
      [userId]
    );

    const c = curRows[0] || {};
    const t = todayRows[0] || {};

    const curFocusSeconds = Math.floor(num(c.focus_ms) / 1000);
    const completedSessions = num(c.completed_sessions);
    const cancelledSessions = num(c.cancelled_sessions);
    const totalSessions = completedSessions + cancelledSessions;

    let diffPercent = 0;
    if (prevFocusSeconds > 0) {
      diffPercent = Math.round(((curFocusSeconds - prevFocusSeconds) / prevFocusSeconds) * 100);
    } else if (curFocusSeconds > 0) {
      diffPercent = 100;
    }

    const totalTodos = num(c.total_todos);
    const completedTodos = num(c.completed_todos);
    const todoCompletionRate = totalTodos > 0 ? Math.round((completedTodos / totalTodos) * 100) : 0;

    return {
      timeframe,
      range: {
        startDate: bounds.startDate,
        endDate: bounds.endDate,
      },
      metrics: {
        totalFocusSeconds: curFocusSeconds,
        completedSessions,
        cancelledSessions,
        totalSessions,
        pomodoros: num(c.pomodoros),
        longestSessionSeconds: Math.floor(num(c.longest_ms) / 1000),
        averageSessionSeconds: totalSessions > 0 ? Math.floor(curFocusSeconds / totalSessions) : 0,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        lastStudyDate: streak.lastStudyDate,
        todoCompletionRate,
        totalLinkedTodos: totalTodos,
        completedLinkedTodos: completedTodos,
      },
      comparison: {
        prevFocusSeconds,
        diffPercent,
        trend: diffPercent > 0 ? 'up' : diffPercent < 0 ? 'down' : 'neutral',
      },
      today: {
        focusSeconds: Math.floor(num(t.focus_ms) / 1000),
        completedSessions: num(t.completed_sessions),
        pomodoros: num(t.pomodoros),
      },
    };
  },

  /**
   * Biểu đồ hoạt động hàng ngày (Daily Bar Chart), lấp đầy ngày 0s.
   */
  async statsDaily(userId, { timeframe = 'last_7_days', days, from, to }) {
    let startDate, endDate;
    if (days) {
      const { rows: tRows } = await pool.query(`SELECT (NOW() AT TIME ZONE '${TIMEZONE}')::date::text AS today`);
      const todayStr = tRows[0]?.today || new Date().toISOString().slice(0, 10);
      endDate = todayStr;
      const s = new Date(todayStr);
      s.setDate(s.getDate() - (days - 1));
      startDate = s.toISOString().slice(0, 10);
    } else {
      const b = await this.resolveTimeframeDates(timeframe, from, to);
      startDate = b.startDate;
      endDate = b.endDate;
      if (!startDate) {
        // all_time -> lấy 30 ngày gần nhất cho biểu đồ cột
        const s = new Date(endDate || new Date().toISOString().slice(0, 10));
        s.setDate(s.getDate() - 29);
        startDate = s.toISOString().slice(0, 10);
      }
    }

    const { rows } = await pool.query(
      `WITH series AS (
         SELECT gs::date AS day
         FROM generate_series($2::date, $3::date, interval '1 day') gs
       )
       SELECT
         to_char(series.day, 'YYYY-MM-DD') AS date,
         COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
         COALESCE(SUM(CASE WHEN fs.timer_mode = 'pomodoro' OR fs.timer_mode IS NULL THEN fs.focus_ms ELSE 0 END), 0) AS pomodoro_focus_ms,
         COALESCE(SUM(CASE WHEN fs.timer_mode = 'stopwatch' THEN fs.focus_ms ELSE 0 END), 0) AS stopwatch_focus_ms,
         COUNT(fs.id) FILTER (WHERE fs.status = 'COMPLETED')::int AS sessions,
         COALESCE(SUM(fs.completed_pomodoros), 0)::int AS pomodoros
       FROM series
       LEFT JOIN focus_sessions fs
         ON fs.user_id = $1
        AND fs.ended_at IS NOT NULL
        AND (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date = series.day
       GROUP BY series.day
       ORDER BY series.day`,
      [userId, startDate, endDate]
    );

    return rows.map((r) => ({
      date: r.date,
      focusSeconds: Math.floor(num(r.focus_ms) / 1000),
      pomodoroFocusSeconds: Math.floor(num(r.pomodoro_focus_ms) / 1000),
      stopwatchFocusSeconds: Math.floor(num(r.stopwatch_focus_ms) / 1000),
      sessions: r.sessions,
      pomodoros: r.pomodoros,
    }));
  },

  /**
   * Bản đồ nhiệt nhất quán học tập (Consistency Heatmap) cho N ngày.
   */
  async statsHeatmap(userId, days = 120) {
    const { rows } = await pool.query(
      `WITH today_val AS (
         SELECT (NOW() AT TIME ZONE '${TIMEZONE}')::date AS d
       ),
       series AS (
         SELECT gs::date AS day
         FROM today_val, generate_series(today_val.d - ($2::int - 1), today_val.d, interval '1 day') gs
       )
       SELECT
         to_char(series.day, 'YYYY-MM-DD') AS date,
         COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
         COUNT(fs.id) FILTER (WHERE fs.status = 'COMPLETED')::int AS sessions,
         COALESCE(SUM(fs.completed_pomodoros), 0)::int AS pomodoros
       FROM series
       LEFT JOIN focus_sessions fs
         ON fs.user_id = $1
        AND fs.ended_at IS NOT NULL
        AND (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date = series.day
       GROUP BY series.day
       ORDER BY series.day`,
      [userId, days]
    );

    return rows.map((r) => {
      const focusSec = Math.floor(num(r.focus_ms) / 1000);
      const mins = Math.floor(focusSec / 60);
      let level = 0;
      if (mins > 120) level = 4;
      else if (mins >= 60) level = 3;
      else if (mins >= 30) level = 2;
      else if (mins > 0) level = 1;

      return {
        date: r.date,
        count: r.sessions,
        focusSeconds: focusSec,
        pomodoros: r.pomodoros,
        level,
      };
    });
  },

  /**
   * Phân bổ chế độ học (Pomodoro vs Stopwatch) và khung giờ học trong ngày.
   */
  async statsDistribution(userId, { timeframe = 'last_7_days' }) {
    const bounds = await this.resolveTimeframeDates(timeframe);

    // 1. Phân bổ theo chế độ (Mode Distribution)
    const { rows: modeRows } = await pool.query(
      `SELECT
         COALESCE(fs.timer_mode, 'pomodoro') AS mode,
         COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
         COUNT(fs.id)::int AS sessions
       FROM focus_sessions fs
       WHERE fs.user_id = $1
         AND fs.ended_at IS NOT NULL
         AND ($2::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date >= $2::date)
         AND ($3::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date <= $3::date)
       GROUP BY COALESCE(fs.timer_mode, 'pomodoro')`,
      [userId, bounds.startDate, bounds.endDate]
    );

    // 2. Phân bổ theo khung giờ (Time of Day Slots)
    const { rows: slotRows } = await pool.query(
      `SELECT
         CASE
           WHEN EXTRACT(HOUR FROM (fs.started_at AT TIME ZONE '${TIMEZONE}')) BETWEEN 5 AND 11 THEN 'morning'
           WHEN EXTRACT(HOUR FROM (fs.started_at AT TIME ZONE '${TIMEZONE}')) BETWEEN 12 AND 17 THEN 'afternoon'
           WHEN EXTRACT(HOUR FROM (fs.started_at AT TIME ZONE '${TIMEZONE}')) BETWEEN 18 AND 21 THEN 'evening'
           ELSE 'night'
         END AS slot,
         COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
         COUNT(fs.id)::int AS sessions
       FROM focus_sessions fs
       WHERE fs.user_id = $1
         AND fs.ended_at IS NOT NULL
         AND ($2::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date >= $2::date)
         AND ($3::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date <= $3::date)
       GROUP BY 1`,
      [userId, bounds.startDate, bounds.endDate]
    );

    let totalModeSeconds = 0;
    const modeMap = { pomodoro: { focusSeconds: 0, sessions: 0 }, stopwatch: { focusSeconds: 0, sessions: 0 } };
    modeRows.forEach((r) => {
      const sec = Math.floor(num(r.focus_ms) / 1000);
      totalModeSeconds += sec;
      const m = r.mode === 'stopwatch' ? 'stopwatch' : 'pomodoro';
      modeMap[m] = { focusSeconds: sec, sessions: r.sessions };
    });

    const modes = [
      {
        mode: 'pomodoro',
        label: 'Pomodoro',
        focusSeconds: modeMap.pomodoro.focusSeconds,
        sessions: modeMap.pomodoro.sessions,
        percentage: totalModeSeconds > 0 ? Math.round((modeMap.pomodoro.focusSeconds / totalModeSeconds) * 100) : 0,
      },
      {
        mode: 'stopwatch',
        label: 'Stopwatch',
        focusSeconds: modeMap.stopwatch.focusSeconds,
        sessions: modeMap.stopwatch.sessions,
        percentage: totalModeSeconds > 0 ? Math.round((modeMap.stopwatch.focusSeconds / totalModeSeconds) * 100) : 0,
      },
    ];

    let totalSlotSeconds = 0;
    const slotLabels = {
      morning: 'Buổi sáng (5h - 12h)',
      afternoon: 'Buổi chiều (12h - 18h)',
      evening: 'Buổi tối (18h - 22h)',
      night: 'Đêm muộn (22h - 5h)',
    };
    const slotMap = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    slotRows.forEach((r) => {
      const sec = Math.floor(num(r.focus_ms) / 1000);
      totalSlotSeconds += sec;
      if (slotMap[r.slot] !== undefined) slotMap[r.slot] = sec;
    });

    const timeSlots = Object.keys(slotMap).map((key) => ({
      slot: key,
      label: slotLabels[key],
      focusSeconds: slotMap[key],
      percentage: totalSlotSeconds > 0 ? Math.round((slotMap[key] / totalSlotSeconds) * 100) : 0,
    }));

    const peakSlot = timeSlots.reduce((prev, curr) => (curr.focusSeconds > prev.focusSeconds ? curr : prev), timeSlots[0]);

    return {
      timeframe,
      totalFocusSeconds: totalModeSeconds,
      modes,
      timeSlots,
      peakSlot: peakSlot.focusSeconds > 0 ? peakSlot : null,
    };
  },

  /**
   * Tiến độ hoàn thành nhiệm vụ gắn phiên học (Todo Completion Progress).
   */
  async statsTodos(userId, { timeframe = 'last_7_days', limit = 10 }) {
    const bounds = await this.resolveTimeframeDates(timeframe);

    // 1. Danh sách Top Todo
    const { rows: topRows } = await pool.query(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.priority,
         COALESCE(SUM(fs.focus_ms), 0) AS focus_ms,
         COUNT(fs.id)::int AS sessions,
         COALESCE(SUM(fs.completed_pomodoros), 0)::int AS pomodoros
       FROM focus_sessions fs
       JOIN todos t ON t.id = fs.todo_id
       WHERE fs.user_id = $1
         AND fs.ended_at IS NOT NULL
         AND ($2::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date >= $2::date)
         AND ($3::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date <= $3::date)
       GROUP BY t.id, t.title, t.status, t.priority
       ORDER BY focus_ms DESC
       LIMIT $4`,
      [userId, bounds.startDate, bounds.endDate, limit]
    );

    // 2. Tổng quan Todo
    const { rows: summaryRows } = await pool.query(
      `SELECT
         COUNT(DISTINCT t.id)::int AS total_linked,
         COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'COMPLETED')::int AS completed_count,
         COUNT(DISTINCT t.id) FILTER (WHERE t.status <> 'COMPLETED')::int AS pending_count
       FROM focus_sessions fs
       JOIN todos t ON t.id = fs.todo_id
       WHERE fs.user_id = $1
         AND fs.ended_at IS NOT NULL
         AND ($2::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date >= $2::date)
         AND ($3::date IS NULL OR (fs.ended_at AT TIME ZONE '${TIMEZONE}')::date <= $3::date)`,
      [userId, bounds.startDate, bounds.endDate]
    );

    const s = summaryRows[0] || {};
    const total = num(s.total_linked);
    const completed = num(s.completed_count);
    const pending = num(s.pending_count);

    return {
      timeframe,
      overview: {
        totalLinkedTasks: total,
        completedTasks: completed,
        pendingTasks: pending,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      },
      topTasks: topRows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        focusSeconds: Math.floor(num(r.focus_ms) / 1000),
        sessions: r.sessions,
        pomodoros: r.pomodoros,
      })),
    };
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

