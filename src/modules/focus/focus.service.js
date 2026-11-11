const { pool } = require('../../config/db.config');
const { AppError } = require('../../utils/appError');
const { askGemini } = require('../../config/gemini.config');
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
      timerMode: input.timerMode || 'pomodoro',
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

  async adjust(userId, id, { deltaMinutes }, now = new Date()) {
    const row = await mutateSession(userId, id, now, async (s) => {
      if (isEnded(s)) throw new AppError('SESSION_ALREADY_ENDED', 409);
      return Timer.adjust(s, deltaMinutes, now);
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

  // Nhóm D — thống kê cơ bản (Backward compatibility)
  summary: (userId, query) => Repo.summary(userId, query),
  daily: (userId, { days }) => Repo.daily(userId, days),
  weekly: (userId, { weeks }) => Repo.weekly(userId, weeks),

  // Nhóm D — thống kê chuyên sâu (P0 Dashboard)
  overview: (userId, query) => Repo.statsOverview(userId, query),
  dailyStats: (userId, query) => Repo.statsDaily(userId, query),
  heatmap: (userId, query) => Repo.statsHeatmap(userId, query.days),
  distribution: (userId, query) => Repo.statsDistribution(userId, query),
  todosStats: (userId, query) => Repo.statsTodos(userId, query),

  async insights(userId, query) {
    const overview = await Repo.statsOverview(userId, query);
    const distribution = await Repo.statsDistribution(userId, query);
    const m = overview.metrics;

    if (m.totalSessions === 0) {
      return {
        headline: 'Bắt đầu hành trình tập trung của bạn!',
        highlights: [
          'Bạn chưa có phiên học tập nào được ghi nhận trong khoảng thời gian này.',
          'Hãy chọn chế độ Pomodoro hoặc Stopwatch để khởi động phiên học đầu tiên.',
        ],
        recommendation: 'Đặt mục tiêu 1 đến 2 phiên Pomodoro 25 phút mỗi ngày để tạo nhịp học tập bền vững.',
        isAiGenerated: false,
      };
    }

    const focusHours = (m.totalFocusSeconds / 3600).toFixed(1);
    const peakText = distribution.peakSlot ? distribution.peakSlot.label : 'chưa xác định';
    const compText = overview.comparison.diffPercent > 0
      ? `Tăng ${overview.comparison.diffPercent}% so với chu kỳ trước`
      : overview.comparison.diffPercent < 0
      ? `Giảm ${Math.abs(overview.comparison.diffPercent)}% so với chu kỳ trước`
      : 'Tương đương chu kỳ trước';

    const fallback = {
      headline: m.currentStreak >= 3
        ? `Phong độ tuyệt vời! Bạn đang duy trì chuỗi ${m.currentStreak} ngày tập trung liên tục.`
        : `Bạn đã tích lũy ${focusHours} giờ học tập trung chất lượng.`,
      highlights: [
        `Tổng thời gian học thực tế đạt ${focusHours} giờ với ${m.completedSessions} phiên hoàn thành (${compText}).`,
        `Thời điểm bạn học tập trung nhất là ${peakText}.`,
        m.todoCompletionRate > 0
          ? `Tỷ lệ hoàn thành nhiệm vụ gắn với phiên học đạt ${m.todoCompletionRate}%.`
          : 'Gắn nhiệm vụ từ To-Do-List vào phiên học sẽ giúp bạn nâng cao hiệu suất rõ rệt.',
      ],
      recommendation: m.cancelledSessions > m.completedSessions
        ? 'Bạn đang có tỷ lệ bỏ dở phiên khá cao. Hãy thử chia nhỏ thời gian học xuống 15-20 phút mỗi phiên để duy trì năng lượng.'
        : `Hãy tiếp tục duy trì việc học vào khung giờ vàng (${peakText}) để đạt hiệu quả cao nhất.`,
      isAiGenerated: false,
    };

    try {
      if (!process.env.GEMINI_API_KEY) return fallback;

      const prompt = `Bạn là cố vấn học tập thông minh Edutrack. Dựa trên số liệu học tập thực tế của sinh viên:
- Tổng thời gian tập trung: ${focusHours} giờ (${m.completedSessions} phiên hoàn thành, ${m.cancelledSessions} phiên bỏ dở).
- Chuỗi học liên tục (streak): ${m.currentStreak} ngày (kỷ lục: ${m.longestStreak} ngày).
- Tăng trưởng so với kỳ trước: ${compText}.
- Khung giờ học hiệu quả nhất: ${peakText}.
- Tỷ lệ hoàn thành Todo gắn phiên: ${m.todoCompletionRate}%.

Hãy đưa ra nhận xét ngắn gọn, thực tế và mang tính động viên bằng tiếng Việt dưới định dạng JSON duy nhất (không bọc markdown):
{
  "headline": "1 câu tóm tắt truyền cảm hứng",
  "highlights": ["điểm nổi bật 1", "điểm nổi bật 2"],
  "recommendation": "1 lời khuyên cụ thể, hành động được ngay"
}`;

      const aiText = await askGemini(prompt);
      const cleanJson = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed.headline && parsed.highlights && parsed.recommendation) {
        return {
          headline: parsed.headline,
          highlights: parsed.highlights,
          recommendation: parsed.recommendation,
          isAiGenerated: true,
        };
      }
      return fallback;
    } catch {
      return fallback;
    }
  },

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
