/**
 * Lõi tính toán Pomodoro — thuần hàm, không đụng DB, nhận `now` làm tham số.
 *
 * NGUYÊN TẮC: server là nguồn sự thật về thời gian.
 *   Thời gian đã trôi của pha hiện tại =
 *       phase_elapsed_ms (đã chốt)  +  (now - phase_resumed_at)  nếu đang chạy.
 * Client chỉ dùng setInterval để VẼ UI; mọi mốc chuyển pha / cộng dồn thời gian
 * đều do hàm `settle` tính theo mốc thời gian thực nên không bị lệch khi tab bị
 * throttle, refresh trang hay mất mạng.
 *
 * Khi một pha chạy hết giờ, `settle` chốt pha đó đúng tại mốc kết thúc lý thuyết
 * và chuyển sang pha kế tiếp ở trạng thái PAUSED (chờ người học bấm tiếp tục).
 * Nhờ vậy thời gian bị bỏ quên (đóng tab) không bao giờ bị tính là thời gian học.
 */

const PHASES = Object.freeze({
  FOCUS: 'FOCUS',
  SHORT_BREAK: 'SHORT_BREAK',
  LONG_BREAK: 'LONG_BREAK',
});

const STATUS = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

const toMs = (value) => (value == null ? null : new Date(value).getTime());

function phaseDurationMs(session, phase = session.phase) {
  const minutes =
    phase === PHASES.FOCUS
      ? session.focus_minutes
      : phase === PHASES.SHORT_BREAK
        ? session.short_break_minutes
        : session.long_break_minutes;
  return Number(minutes) * 60_000;
}

function nextPhase(phase, completedPomodoros, longBreakEvery) {
  if (phase !== PHASES.FOCUS) return PHASES.FOCUS;
  return completedPomodoros > 0 && completedPomodoros % longBreakEvery === 0
    ? PHASES.LONG_BREAK
    : PHASES.SHORT_BREAK;
}

/** Thời gian đã trôi của pha hiện tại (ms), tính theo `now`. */
function currentPhaseElapsedMs(session, now) {
  const base = Number(session.phase_elapsed_ms);
  if (session.status !== STATUS.IN_PROGRESS) return base;
  const resumed = toMs(session.phase_resumed_at);
  return base + Math.max(0, toMs(now) - resumed);
}

/**
 * Chốt trạng thái theo thời gian thực. Chỉ phiên IN_PROGRESS mới có thể tự
 * hoàn thành pha. Trả về bản sao mới (không mutate đầu vào).
 */
function settle(session, now) {
  const s = { ...session };
  if (s.status !== STATUS.IN_PROGRESS) return s;

  const nowMs = toMs(now);
  const resumedMs = toMs(s.phase_resumed_at);
  const duration = phaseDurationMs(s);
  const alreadyMs = Number(s.phase_elapsed_ms);
  const elapsed = alreadyMs + Math.max(0, nowMs - resumedMs);

  if (elapsed < duration) return s;

  // Pha đã hết giờ: chỉ tính phần còn thiếu cho đủ pha, phần dư bị bỏ.
  const creditMs = duration - alreadyMs;
  if (s.phase === PHASES.FOCUS) {
    s.focus_ms = Number(s.focus_ms) + creditMs;
    s.completed_pomodoros = Number(s.completed_pomodoros) + 1;
  }

  s.phase = nextPhase(s.phase, s.completed_pomodoros, s.long_break_every);
  s.phase_seq = Number(s.phase_seq) + 1;
  s.phase_elapsed_ms = 0;
  s.phase_resumed_at = null;
  s.status = STATUS.PAUSED;
  return s;
}

function pause(session, now) {
  const s = { ...session };
  if (s.status !== STATUS.IN_PROGRESS) return s;
  const delta = Math.max(0, toMs(now) - toMs(s.phase_resumed_at));
  s.phase_elapsed_ms = Number(s.phase_elapsed_ms) + delta;
  if (s.phase === PHASES.FOCUS) s.focus_ms = Number(s.focus_ms) + delta;
  s.phase_resumed_at = null;
  s.status = STATUS.PAUSED;
  return s;
}

function resume(session, now) {
  const s = { ...session };
  if (s.status !== STATUS.PAUSED) return s;
  s.phase_resumed_at = new Date(toMs(now));
  s.status = STATUS.IN_PROGRESS;
  return s;
}

/** Bắt đầu lại pha hiện tại từ 0. Thời gian tập trung đã trôi vẫn được giữ (là thời gian thật). */
function resetPhase(session, now) {
  const s = pause(session, now);
  s.phase_elapsed_ms = 0;
  return s;
}

function end(session, now, finalStatus) {
  const s = pause(session, now);
  s.status = finalStatus;
  s.phase_resumed_at = null;
  s.ended_at = new Date(toMs(now));
  return s;
}

/** Chuyển row DB → JSON trả về client (camelCase + các trường đã tính sẵn). */
function toView(session, now) {
  const nowMs = toMs(now);
  const duration = phaseDurationMs(session);
  const ended = session.status === STATUS.COMPLETED || session.status === STATUS.CANCELLED;
  const elapsed = Math.min(currentPhaseElapsedMs(session, nowMs), duration);

  const longEvery = Number(session.long_break_every);
  const completed = Number(session.completed_pomodoros);
  const cycleDone = session.phase === PHASES.LONG_BREAK ? longEvery : completed % longEvery;

  return {
    id: session.id,
    status: session.status,
    phase: session.phase,
    phaseSeq: Number(session.phase_seq),
    todoId: session.todo_id || null,
    todoTitle: session.todo_title ?? undefined,
    config: {
      focusMinutes: session.focus_minutes,
      shortBreakMinutes: session.short_break_minutes,
      longBreakMinutes: session.long_break_minutes,
      longBreakEvery: longEvery,
    },
    phaseDurationMs: duration,
    phaseElapsedMs: elapsed,
    phaseRemainingMs: ended ? 0 : Math.max(0, duration - elapsed),
    resumedAt: session.phase_resumed_at ? new Date(session.phase_resumed_at).toISOString() : null,
    completedPomodoros: completed,
    pomodoroProgress: { current: cycleDone, cycleLength: longEvery },
    focusSeconds: Math.floor(Number(session.focus_ms) / 1000),
    note: session.note || '',
    startedAt: new Date(session.started_at).toISOString(),
    endedAt: session.ended_at ? new Date(session.ended_at).toISOString() : null,
    serverNow: new Date(nowMs).toISOString(),
  };
}

/**
 * Tính focus_ms "ảo" tới thời điểm `now` (bao gồm pha FOCUS đang chạy) — dùng
 * cho view của phiên đang hoạt động để số liệu hiển thị luôn chính xác.
 */
function withLiveFocus(session, now) {
  if (session.status !== STATUS.IN_PROGRESS || session.phase !== PHASES.FOCUS) return session;
  const live = Math.max(0, toMs(now) - toMs(session.phase_resumed_at));
  return { ...session, focus_ms: Number(session.focus_ms) + live };
}

module.exports = {
  PHASES,
  STATUS,
  phaseDurationMs,
  nextPhase,
  currentPhaseElapsedMs,
  settle,
  pause,
  resume,
  resetPhase,
  end,
  toView,
  withLiveFocus,
};

