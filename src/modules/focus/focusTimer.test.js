const T = require('./focusTimer');

const T0 = new Date('2026-10-24T05:00:00.000Z').getTime();
const at = (minutes) => new Date(T0 + minutes * 60_000);

function base(overrides = {}) {
  return {
    id: 's1',
    status: 'IN_PROGRESS',
    phase: 'FOCUS',
    phase_seq: 1,
    phase_elapsed_ms: 0,
    phase_resumed_at: at(0),
    focus_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 15,
    long_break_every: 4,
    completed_pomodoros: 0,
    focus_ms: 0,
    started_at: at(0),
    ended_at: null,
    note: '',
    ...overrides,
  };
}

describe('focusTimer', () => {
  test('không chuyển pha khi chưa đủ thời gian', () => {
    const s = T.settle(base(), at(24));
    expect(s.phase).toBe('FOCUS');
    expect(s.status).toBe('IN_PROGRESS');
    expect(T.toView(s, at(24)).phaseRemainingMs).toBe(60_000);
  });

  test('hết 25 phút → +1 pomodoro, sang SHORT_BREAK ở trạng thái PAUSED', () => {
    const s = T.settle(base(), at(25));
    expect(s.completed_pomodoros).toBe(1);
    expect(s.phase).toBe('SHORT_BREAK');
    expect(s.status).toBe('PAUSED');
    expect(s.phase_seq).toBe(2);
    expect(s.focus_ms).toBe(25 * 60_000);
  });

  test('bỏ quên tab 3 giờ: chỉ tính đúng 25 phút, không tính thời gian dư', () => {
    const s = T.settle(base(), at(180));
    expect(s.focus_ms).toBe(25 * 60_000);
    expect(s.completed_pomodoros).toBe(1);
  });

  test('pause / resume cộng dồn đúng và không tính thời gian khi đang pause', () => {
    let s = T.pause(base(), at(10)); // học 10'
    expect(s.focus_ms).toBe(10 * 60_000);
    expect(s.status).toBe('PAUSED');
    s = T.resume(s, at(60)); // nghỉ 50' thực tế
    s = T.settle(s, at(74)); // học thêm 14'
    expect(T.toView(s, at(74)).phaseRemainingMs).toBe(60_000);
    s = T.settle(s, at(75));
    expect(s.completed_pomodoros).toBe(1);
    expect(s.focus_ms).toBe(25 * 60_000);
  });

  test('pause lặp lại là idempotent', () => {
    const once = T.pause(base(), at(5));
    const twice = T.pause(once, at(50));
    expect(twice.focus_ms).toBe(5 * 60_000);
    expect(twice.phase_elapsed_ms).toBe(5 * 60_000);
  });

  test('sau 4 pomodoro → LONG_BREAK, sau đó quay lại FOCUS', () => {
    const s = T.settle(base({ completed_pomodoros: 3 }), at(25));
    expect(s.completed_pomodoros).toBe(4);
    expect(s.phase).toBe('LONG_BREAK');
    expect(T.toView(s, at(25)).pomodoroProgress.current).toBe(4);

    const back = T.settle(T.resume(s, at(26)), at(41));
    expect(back.phase).toBe('FOCUS');
    expect(back.completed_pomodoros).toBe(4);
    expect(back.focus_ms).toBe(25 * 60_000); // nghỉ không tính là tập trung
  });

  test('pha nghỉ không cộng focus_ms', () => {
    let s = T.settle(base(), at(25));
    s = T.settle(T.resume(s, at(25)), at(30));
    expect(s.phase).toBe('FOCUS');
    expect(s.focus_ms).toBe(25 * 60_000);
  });

  test('kết thúc giữa chừng giữ thời gian thực, không tính pomodoro dở dang', () => {
    const s = T.end(base(), at(12), 'COMPLETED');
    expect(s.status).toBe('COMPLETED');
    expect(s.focus_ms).toBe(12 * 60_000);
    expect(s.completed_pomodoros).toBe(0);
    expect(s.ended_at).toBeInstanceOf(Date);
    expect(T.toView(s, at(99)).phaseRemainingMs).toBe(0);
  });

  test('reset pha giữ thời gian tập trung đã trôi, đưa elapsed về 0 và tạm dừng', () => {
    const s = T.resetPhase(base(), at(7));
    expect(s.phase_elapsed_ms).toBe(0);
    expect(s.status).toBe('PAUSED');
    expect(s.focus_ms).toBe(7 * 60_000);
  });

  test('phase_resumed_at nằm ở tương lai (lệch đồng hồ) không tạo thời gian âm', () => {
    const s = T.pause(base({ phase_resumed_at: at(10) }), at(5));
    expect(s.focus_ms).toBe(0);
  });
});

