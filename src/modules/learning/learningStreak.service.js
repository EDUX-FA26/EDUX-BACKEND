const { withTransaction } = require('../../config/db.config');
const LearningRepository = require('./learning.repository');

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Lấy chuỗi ngày YYYY-MM-DD theo múi giờ Việt Nam (UTC+7)
 */
function getVietnamToday(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: VIETNAM_TIMEZONE }).format(date);
}

/**
 * Lấy ngày đầu tiên của tháng hiện tại theo múi giờ Việt Nam: YYYY-MM-01
 */
function getVietnamCurrentMonthStart(date = new Date()) {
  const dateStr = getVietnamToday(date);
  return `${dateStr.slice(0, 7)}-01`;
}

/**
 * Tính khoảng cách số ngày giữa 2 chuỗi ngày YYYY-MM-DD
 * (d1Str - d2Str)
 */
function diffInCalendarDays(d1Str, d2Str) {
  if (!d1Str || !d2Str) return 0;
  const t1 = new Date(`${d1Str}T00:00:00Z`).getTime();
  const t2 = new Date(`${d2Str}T00:00:00Z`).getTime();
  return Math.round((t1 - t2) / 86400000);
}

/**
 * Cộng/trừ số ngày vào 1 chuỗi ngày YYYY-MM-DD
 */
function addDays(dStr, n) {
  const d = new Date(`${dStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Helper emit Socket.IO event an toàn (không crash nếu socket chưa init)
 */
function emitStreakUpdated(userId, payload) {
  try {
    const { getIO } = require('../../config/socket.config');
    const io = getIO();
    io.to(`user:${userId}`).emit('learning:streak-updated', payload);
  } catch (err) {
    // Socket chưa init hoặc đang chạy trong test environment
  }
}

/**
 * Chuẩn hóa giá trị Date sang YYYY-MM-DD
 */
function formatDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: VIETNAM_TIMEZONE }).format(val);
  }
  return String(val).slice(0, 10);
}

const LearningStreakService = {
  // Expose helpers for tests
  getVietnamToday,
  getVietnamCurrentMonthStart,
  diffInCalendarDays,
  addDays,

  /**
   * Tính toán current_streak và quota recovery còn lại dựa trên calendar date
   */
  calculateCurrentStreak(streakRow, today = getVietnamToday()) {
    if (!streakRow) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null,
        recoveryUsed: 0,
        recoveryRemaining: 3,
        status: 'not_started',
      };
    }

    // 1. Lazy reset recovery quota nếu sang tháng mới
    const currentMonthStart = getVietnamCurrentMonthStart();
    const storedMonth = formatDate(streakRow.recovery_month);
    let recoveryUsed = streakRow.recovery_used || 0;

    if (!storedMonth || storedMonth.slice(0, 7) !== currentMonthStart.slice(0, 7)) {
      recoveryUsed = 0;
    }
    const recoveryRemaining = Math.max(0, 3 - recoveryUsed);

    // 2. Tính streak hiện tại
    const lastDateStr = formatDate(streakRow.last_activity_date);
    let currentStreak = streakRow.current_streak || 0;
    let status = 'active';

    if (!lastDateStr || currentStreak === 0) {
      currentStreak = 0;
      status = 'not_started';
    } else {
      const diff = diffInCalendarDays(today, lastDateStr);

      if (diff === 0) {
        // Đã học hôm nay
        status = 'completed_today';
      } else if (diff === 1) {
        // Học hôm qua, hôm nay chưa học -> streak vẫn giữ nguyên
        status = 'pending_today';
      } else if (diff === 2) {
        // Bỏ lỡ ngày hôm qua! Chưa recovery
        // Trạng thái: streak bị mất tạm thời, có thể recovery nếu còn quota
        currentStreak = 0;
        status = 'broken_recoverable';
      } else {
        // Bỏ lỡ từ 2 ngày liên tiếp trở lên -> mất vĩnh viễn
        currentStreak = 0;
        status = 'lost_permanently';
      }
    }

    return {
      currentStreak,
      longestStreak: streakRow.longest_streak || 0,
      lastActivityDate: lastDateStr,
      recoveryUsed,
      recoveryRemaining,
      status,
    };
  },

  /**
   * Lấy hoặc tạo mới bản ghi streak cho user + subject
   */
  async getOrCreateSubjectStreak(userId, subjectId, client = null) {
    const row = await LearningRepository.getOrCreateStreakRow(userId, subjectId, client);
    const calculated = this.calculateCurrentStreak(row);

    return {
      id: row.id,
      userId: row.user_id,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      subjectCode: row.subject_code,
      ...calculated,
    };
  },

  /**
   * Ghi nhận hoàn thành 1 Flashcard Deck
   * Đảm bảo IDEMPOTENCY, CONCURRENCY và TRANSACTION
   */
  async recordFlashcardDeckCompletion({ userId, deckId }) {
    if (!deckId) {
      throw new Error('DECK_ID_REQUIRED');
    }

    // 1. Kiểm tra deck tồn tại
    const deck = await LearningRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) {
      throw new Error('DECK_NOT_FOUND');
    }

    const subjectId = deck.subject_id;

    // 2. Kiểm tra quyền truy cập deck của user
    if (!deck.is_public && deck.created_by !== userId) {
      if (deck.class_id) {
        const isMember = await LearningRepository.isUserInClass(deck.class_id, userId);
        if (!isMember) throw new Error('FORBIDDEN');
      } else {
        throw new Error('FORBIDDEN');
      }
    }

    const today = getVietnamToday();
    const currentMonthStart = getVietnamCurrentMonthStart();
    let socketPayload = null;

    // 3. Thực hiện trong pg transaction
    await withTransaction(async (client) => {
      // Row locking trên subject_streaks để ngăn chặn race condition
      const streakRow = await LearningRepository.lockStreakForUpdate(userId, subjectId, client);

      // Thêm activity vào subject_streak_activities (idempotent nhờ UNIQUE constraint)
      const alreadyStudiedToday =
        await LearningRepository.hasActivityToday(
          userId,
          subjectId,
          today,
          client
        );

      const activity = await LearningRepository.insertActivity(
        userId,
        subjectId,
        deckId,
        today,
        'flashcard_deck_completed',
        client
      );

      // Xử lý lazy reset recovery quota
      const storedMonth = formatDate(streakRow.recovery_month);
      let recoveryUsed = streakRow.recovery_used || 0;
      let recoveryMonth = streakRow.recovery_month;

      if (!storedMonth || storedMonth.slice(0, 7) !== currentMonthStart.slice(0, 7)) {
        recoveryUsed = 0;
        recoveryMonth = currentMonthStart;
      }

      let currentStreak = streakRow.current_streak || 0;
      let longestStreak = streakRow.longest_streak || 0;
      const lastDateStr = formatDate(streakRow.last_activity_date);

      if (alreadyStudiedToday || !activity) {
        socketPayload = {
          subjectId,
          currentStreak,
          longestStreak,
          lastActivityDate: lastDateStr || today,
          recoveryUsed,
          recoveryRemaining: Math.max(0, 3 - recoveryUsed),
        };

        return;
      }

      // Lần đầu tiên hoàn thành deck của môn này trong ngày hôm nay!
      let newStreak = 1;
      let streakLost = false;

      if (lastDateStr) {
        const diff = diffInCalendarDays(today, lastDateStr);

        if (diff === 1) {
          // Ngày hôm qua có học -> tăng chuỗi liên tiếp +1
          newStreak = currentStreak + 1;
        } else if (diff === 0) {
          // Cùng ngày (phòng hờ)
          newStreak = currentStreak;
        } else {
          // diff > 1: đã bỏ lỡ ít nhất 1 ngày mà không recovery -> streak cũ mất, bắt đầu lại 1
          newStreak = 1;
          streakLost = true;
        }
      }

      const newLongest = Math.max(longestStreak, newStreak);

      // Cập nhật subject_streaks
      await LearningRepository.updateStreak(
        userId,
        subjectId,
        {
          current_streak: newStreak,
          longest_streak: newLongest,
          last_activity_date: today,
          recovery_used: recoveryUsed,
          recovery_month: recoveryMonth,
          streak_lost_at: streakLost ? new Date() : undefined,
        },
        client
      );

      socketPayload = {
        subjectId,
        currentStreak: newStreak,
        longestStreak: newLongest,
        lastActivityDate: today,
        recoveryUsed,
        recoveryRemaining: Math.max(0, 3 - recoveryUsed),
      };
    });

    // 4. Emit Socket.IO event sau khi transaction COMMIT thành công
    if (socketPayload) {
      emitStreakUpdated(userId, socketPayload);
    }

    return socketPayload;
  },

  /**
   * Khôi phục streak cho một môn học
   */
  async recoverSubjectStreak(userId, subjectId) {
    const subject = await LearningRepository.findSubjectById(subjectId);
    if (!subject) {
      throw new Error('SUBJECT_NOT_FOUND');
    }

    const today = getVietnamToday();
    const currentMonthStart = getVietnamCurrentMonthStart();
    let socketPayload = null;
    let resultData = null;

    await withTransaction(async (client) => {
      const streakRow = await LearningRepository.lockStreakForUpdate(userId, subjectId, client);

      // 1. Kiểm tra quota recovery trong tháng
      const storedMonth = formatDate(streakRow.recovery_month);
      let recoveryUsed = streakRow.recovery_used || 0;

      if (!storedMonth || storedMonth.slice(0, 7) !== currentMonthStart.slice(0, 7)) {
        recoveryUsed = 0;
      }

      if (recoveryUsed >= 3) {
        throw new Error('RECOVERY_LIMIT_EXCEEDED');
      }

      // 2. Kiểm tra streak có tồn tại để recovery không
      const lastDateStr = formatDate(streakRow.last_activity_date);
      const currentStreak = streakRow.current_streak || 0;

      if (!lastDateStr || currentStreak === 0) {
        throw new Error('NO_STREAK_TO_RECOVER');
      }

      // 3. Kiểm tra số ngày bị bỏ lỡ
      const diff = diffInCalendarDays(today, lastDateStr);

      if (diff <= 1) {
        // 0: đã học hôm nay; 1: hôm qua đã học, hôm nay chưa học xong
        throw new Error('NO_MISSED_DAYS');
      }

      if (diff > 2) {
        // Đã bỏ lỡ từ 2 ngày liên tiếp trở lên -> mất vĩnh viễn, không thể khôi phục
        throw new Error('STREAK_PERMANENTLY_LOST');
      }

      // diff === 2: Bỏ lỡ chính xác 1 ngày (hôm qua)
      const missedDate = addDays(today, -1);

      // Tạo activity bổ sung cho ngày bị bỏ lỡ
      await LearningRepository.insertActivity(
        userId,
        subjectId,
        null,
        missedDate,
        'streak_recovered',
        client
      );

      const newRecoveryUsed = recoveryUsed + 1;
      const longestStreak = streakRow.longest_streak || currentStreak;

      // Cập nhật streak: giữ nguyên current_streak, cập nhật last_activity_date thành hôm qua
      await LearningRepository.updateStreak(
        userId,
        subjectId,
        {
          current_streak: currentStreak,
          last_activity_date: missedDate,
          recovery_used: newRecoveryUsed,
          recovery_month: currentMonthStart,
        },
        client
      );

      const remaining = Math.max(0, 3 - newRecoveryUsed);

      socketPayload = {
        subjectId,
        currentStreak,
        longestStreak,
        lastActivityDate: missedDate,
        recoveryUsed: newRecoveryUsed,
        recoveryRemaining: remaining,
      };

      resultData = {
        subjectId,
        currentStreak,
        longestStreak,
        recoveryUsed: newRecoveryUsed,
        recoveryRemaining: remaining,
      };
    });

    // Emit Socket.IO event sau khi transaction commit
    if (socketPayload) {
      emitStreakUpdated(userId, socketPayload);
    }

    return {
      message: 'Streak recovered successfully',
      data: resultData,
    };
  },

  /**
   * Lấy toàn bộ streak của user theo từng subject
   */
  async getAllSubjectStreaks(userId) {
    const rows = await LearningRepository.findAllStreaksByUser(userId);

    const data = rows.map((row) => {
      const calculated = this.calculateCurrentStreak(row);
      return {
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        currentStreak: calculated.currentStreak,
        longestStreak: calculated.longestStreak,
        lastActivityDate: calculated.lastActivityDate,
        recoveryUsed: calculated.recoveryUsed,
        recoveryRemaining: calculated.recoveryRemaining,
      };
    });

    return data;
  },

  /**
   * Lấy streak của 1 subject cụ thể cho user
   */
  async getSubjectStreak(userId, subjectId) {
    const subject = await LearningRepository.findSubjectById(subjectId);
    if (!subject) {
      throw new Error('SUBJECT_NOT_FOUND');
    }

    const row = await LearningRepository.findStreakByUserAndSubject(userId, subjectId);

    if (!row) {
      return {
        subjectId: subject.id,
        subjectName: subject.name,
        currentStreak: 0,
        longestStreak: 0,
        lastActivityDate: null,
        recoveryUsed: 0,
        recoveryRemaining: 3,
      };
    }

    const calculated = this.calculateCurrentStreak(row);

    return {
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      currentStreak: calculated.currentStreak,
      longestStreak: calculated.longestStreak,
      lastActivityDate: calculated.lastActivityDate,
      recoveryUsed: calculated.recoveryUsed,
      recoveryRemaining: calculated.recoveryRemaining,
    };
  },

  /**
   * Lấy lịch sử learning activity
   */
  async getLearningActivityHistory(userId, options = {}) {
    return LearningRepository.findActivities(userId, options);
  },

  /**
   * Lấy dữ liệu Heatmap
   */
  async getHeatmap(userId, options = {}) {
    return LearningRepository.findHeatmap(userId, options);
  },
};

module.exports = LearningStreakService;
