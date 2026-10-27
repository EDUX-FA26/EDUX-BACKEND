const { pool } = require('../../config/db.config');
const { AppError } = require('../../utils/appError');
const Timer = require('./focusTimer');
const Repo = require('./focus.repository');
const {
  BACKGROUNDS,
  SOUNDS,
  SOUND_IDS,
  DEFAULT_PREFERENCES,
} = require('./focus.constants');

// ── helpers ──────────────────────────────────────────────

function viewOf(row, now) {
  return Timer.toView(Timer.withLiveFocus(row, now), now);
}

function isEnded(row) {
  return row.status === Timer.STATUS.COMPLETED || row.status === Timer.STATUS.CANCELLED;
}

/** Chạy `fn` trên phiên đã khóa dòng + đã chốt theo thời gian thực, rồi ghi lại. */
async function mutateSession(userId, id, now, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const row = await Repo.lockById(client, id, userId);
    if (!row) throw new AppError('SESSION_NOT_FOUND', 404);

    const settled = Timer.settle(row, now);
    const next = (await fn(settled, client)) || settled;

    await Repo.persist(client, next);
    const fresh = await Repo.findById(client, id, userId);

    await client.query('COMMIT');
    return fresh;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function assertTodoLinkable(client, userId, todoId) {
  const todo = await Repo.findLinkableTodo(client, todoId, userId);
  if (!todo) throw new AppError('TODO_NOT_FOUND', 404);
  if (todo.status === 'COMPLETED') throw new AppError('TODO_ALREADY_COMPLETED', 409);
}

function rowToPreferences(row) {
  if (!row) return { ...DEFAULT_PREFERENCES, sounds: DEFAULT_PREFERENCES.sounds.map((s) => ({ ...s })) };

  const stored = Array.isArray(row.sounds) ? row.sounds : [];
  // Luôn trả đủ mọi âm thanh trong danh mục để FE vẽ mixer ổn định
  const sounds = SOUND_IDS.map((id) => {
    const found = stored.find((s) => s.id === id);
    return found
      ? { id, enabled: Boolean(found.enabled), volume: Number(found.volume) }
      : { id, enabled: false, volume: 0.5 };
  });

  return {
    backgroundId: row.background_id,
    masterVolume: Number(row.master_volume),
    sounds,
    focusMinutes: row.focus_minutes,
    shortBreakMinutes: row.short_break_minutes,
    longBreakMinutes: row.long_break_minutes,
    longBreakEvery: row.long_break_every,
    autoStartNext: row.auto_start_next,
  };
}

// ── service ──────────────────────────────────────────────

const FocusService = {
  // Nhóm A — Focus Session
  async start(userId, input, now = new Date()) {
    const prefs = rowToPreferences(await Repo.getPreferences(userId));
    const config = {
      focusMinutes: input.focusMinutes ?? prefs.focusMinutes,
      shortBreakMinutes: input.shortBreakMinutes ?? prefs.shortBreakMinutes,
      longBreakMinutes: input.longBreakMinutes ?? prefs.longBreakMinutes,
      longBreakEvery: input.longBreakEvery ?? prefs.longBreakEvery,
    };

    const client = await pool.connect();
    let sessionId;
    try {
      await client.query('BEGIN');

      if (input.todoId) await assertTodoLinkable(client, userId, input.todoId);

      sessionId = await Repo.insert(client, {
        userId,
        todoId: input.todoId || null,
        note: input.note,
        now,
        ...config,
      });

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});

      // Chỉ cho phép 1 phiên hoạt động / người dùng (unique index ở mức DB).
      // Trả lại phiên hiện có để client (kể cả khi retry do mạng) đồng bộ lại.
      if (error.code === '23505' && error.constraint === 'uq_focus_sessions_one_active') {
        const current = await FocusService.getCurrent(userId, now);
        throw new AppError('ACTIVE_SESSION_EXISTS', 409, current);
      }
      throw error;
    } finally {
      client.release();
    }

    const row = await Repo.findById(null, sessionId, userId);
    return viewOf(row, now);
  },

  /** Phiên đang hoạt động (đã chốt các pha hết giờ). `null` nếu không có. */
  async getCurrent(userId, now = new Date()) {
    const active = await Repo.findActive(userId);
    if (!active) return null;

    try {
      const row = await mutateSession(userId, active.id, now, async () => null);
      return viewOf(row, now);
    } catch (error) {
      // Phiên vừa được đóng bởi request khác giữa hai truy vấn
      if (error instanceof AppError && error.message === 'SESSION_NOT_FOUND') return null;
      throw error;
    }
  },

  async getById(userId, id, now = new Date()) {
    const row = await Repo.findById(null, id, userId);
    if (!row) throw new AppError('SESSION_NOT_FOUND', 404);

    if (isEnded(row)) return viewOf(row, now);

    const settled = await mutateSession(userId, id, now, async () => null);
    return viewOf(settled, now);
  },

  async pause(userId, id, now = new Date()) {
    const row = await mutateSession(userId, id, now, async (s) => {
      if (isEnded(s)) throw new AppError('SESSION_ALREADY_ENDED', 409);
      return Timer.pause(s, now); // đã PAUSED → không đổi (idempotent)
    });
    return viewOf(row, now);
  },

  async resume(userId, id, now = new Date()) {
    const row = await mutateSession(userId, id, now, async (s) => {
      if (isEnded(s)) throw new AppError('SESSION_ALREADY_ENDED', 409);
      return Timer.resume(s, now); // đang chạy → không đổi (idempotent)
    });
    return viewOf(row, now);
  },

  async finish(userId, id, { note } = {}, now = new Date()) {
    const row = await mutateSession(userId, id, now, async (s) => {
      if (s.status === Timer.STATUS.COMPLETED) return s; // gọi lặp lại: giữ nguyên kết quả
      if (s.status === Timer.STATUS.CANCELLED) throw new AppError('SESSION_ALREADY_ENDED', 409);

      const ended = Timer.end(s, now, Timer.STATUS.COMPLETED);
      if (note !== undefined) ended.note = note;
      return ended;
    });
    return viewOf(row, now);
  },

  async patch(userId, id, body, now = new Date()) {
    const row = await mutateSession(userId, id, now, async (s, client) => {
      let next = { ...s };

      if (body.note !== undefined) next.note = body.note;

      if (isEnded(s)) {
        // Phiên đã kết thúc chỉ cho sửa ghi chú; huỷ lặp lại là idempotent.
        const wantsOnlyNote =
          body.todoId === undefined && body.resetPhase === undefined &&
          (body.status === undefined || (body.status === 'CANCELLED' && s.status === 'CANCELLED'));
        if (!wantsOnlyNote) throw new AppError('SESSION_ALREADY_ENDED', 409);
        return next;
      }

      if (body.todoId !== undefined) {
        if (body.todoId) await assertTodoLinkable(client, userId, body.todoId);
        next.todo_id = body.todoId;
      }

      if (body.resetPhase) next = { ...Timer.resetPhase(next, now), note: next.note, todo_id: next.todo_id };
      if (body.status === 'CANCELLED') next = Timer.end(next, now, Timer.STATUS.CANCELLED);

      return next;
    });
    return viewOf(row, now);
  },

  async list(userId, query, now = new Date()) {
    const { rows, pagination } = await Repo.list(userId, {
      statuses: query.status ? [query.status] : undefined,
      todoId: query.todoId,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });
    return { items: rows.map((r) => viewOf(r, now)), pagination };
  },

  async history(userId, query, now = new Date()) {
    const { rows, pagination } = await Repo.list(userId, {
      statuses: [Timer.STATUS.COMPLETED, Timer.STATUS.CANCELLED],
      todoId: query.todoId,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });
    return { items: rows.map((r) => viewOf(r, now)), pagination };
  },

  // Nhóm D — thống kê
  summary: (userId, query) => Repo.summary(userId, query),
  daily: (userId, { days }) => Repo.daily(userId, days),
  weekly: (userId, { weeks }) => Repo.weekly(userId, weeks),

  // Nhóm E — cấu hình phòng học
  async getPreferences(userId) {
    return {
      preferences: rowToPreferences(await Repo.getPreferences(userId)),
      catalog: { backgrounds: BACKGROUNDS, sounds: SOUNDS },
    };
  },

  /** Upsert; trường bị bỏ qua giữ nguyên giá trị hiện tại. */
  async savePreferences(userId, input) {
    const current = rowToPreferences(await Repo.getPreferences(userId));
    const merged = { ...current, ...input };

    if (input.sounds) {
      // Giữ nguyên âm thanh không được gửi lên
      merged.sounds = SOUND_IDS.map(
        (id) => input.sounds.find((s) => s.id === id) || current.sounds.find((s) => s.id === id)
      );
    }

    const saved = await Repo.upsertPreferences(userId, merged);
    return {
      preferences: rowToPreferences(saved),
      catalog: { backgrounds: BACKGROUNDS, sounds: SOUNDS },
    };
  },
};

module.exports = FocusService;
