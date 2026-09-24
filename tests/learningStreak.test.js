const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

require('dotenv').config();
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-12345';

const LearningStreakService = require('../src/modules/learning/learningStreak.service');
const LearningRepository = require('../src/modules/learning/learning.repository');
const learningRoutes = require('../src/modules/learning/learning.routes');
const flashcardsRoutes = require('../src/modules/flashcards/flashcards.routes');
const { pool, withTransaction } = require('../src/config/db.config');
const socketConfig = require('../src/config/socket.config');

const app = express();
app.use(express.json());
app.use('/api/learning', learningRoutes);
app.use('/api/flashcards', flashcardsRoutes);
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ success: false, message: err.message });
});

const generateToken = (userId, role = 'student') =>
  `Bearer ${jwt.sign({ userId, role }, process.env.JWT_SECRET)}`;

test('--- LEARNING ACTIVITY & STREAK TEST SUITE ---', async (t) => {
  // Test fixture IDs
  const userId1 = randomUUID();
  const userId2 = randomUUID();
  const subjectId1 = randomUUID();
  const subjectId2 = randomUUID();
  const deckId1 = randomUUID();
  const deckId2 = randomUUID();
  const deckIdOtherSubject = randomUUID();

  // Setup test data in DB
  await t.test('Setup test fixtures in database', async () => {
    // 1. Users
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, 'hash', 'student'), ($3, $4, 'hash', 'student')
       ON CONFLICT (id) DO NOTHING`,
      [userId1, `user1_${userId1.slice(0, 8)}@test.com`, userId2, `user2_${userId2.slice(0, 8)}@test.com`]
    );

    await pool.query(
      `INSERT INTO user_profiles (user_id, full_name)
       VALUES ($1, 'Student One'), ($2, 'Student Two')
       ON CONFLICT (user_id) DO NOTHING`,
      [userId1, userId2]
    );

    // 2. Subjects
    await pool.query(
      `INSERT INTO subjects (id, code, name)
       VALUES ($1, $2, 'Database'), ($3, $4, 'Web Programming')
       ON CONFLICT (id) DO NOTHING`,
      [subjectId1, `SUB1_${subjectId1.slice(0, 6)}`, subjectId2, `SUB2_${subjectId2.slice(0, 6)}`]
    );

    // 3. Flashcard Decks
    await pool.query(
      `INSERT INTO flashcard_decks (id, title, subject_id, created_by, is_public, is_active)
       VALUES ($1, 'Deck 1 DB', $2, $3, true, true),
              ($4, 'Deck 2 DB', $2, $3, true, true),
              ($5, 'Deck Web', $6, $3, true, true)
       ON CONFLICT (id) DO NOTHING`,
      [deckId1, subjectId1, userId1, deckId2, deckIdOtherSubject, subjectId2]
    );
  });

  // 1. User hoàn thành deck lần đầu: current streak = 1
  await t.test('Case 1: User hoàn thành deck lần đầu: current streak = 1', async () => {
    const res = await LearningStreakService.recordFlashcardDeckCompletion({
      userId: userId1,
      deckId: deckId1,
    });

    assert.equal(res.currentStreak, 1);
    assert.equal(res.longestStreak, 1);
    assert.equal(res.subjectId, subjectId1);
  });

  // 2. User hoàn thành 2 deck cùng subject cùng ngày: current streak chỉ +1
  await t.test('Case 2: User hoàn thành 2 deck cùng subject cùng ngày: current streak chỉ +1', async () => {
    const res = await LearningStreakService.recordFlashcardDeckCompletion({
      userId: userId1,
      deckId: deckId2,
    });

    assert.equal(res.currentStreak, 1, 'Current streak vẫn phải là 1 (không tăng thêm lần 2 trong cùng ngày)');
    assert.equal(res.longestStreak, 1);
  });

  // 3. User hoàn thành 30 flashcards cùng deck: chỉ +1
  await t.test('Case 3: User hoàn thành nhiều lần cùng deck trong ngày: chỉ +1', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await LearningStreakService.recordFlashcardDeckCompletion({
        userId: userId1,
        deckId: deckId1,
      });
      assert.equal(res.currentStreak, 1);
    }
  });

  // 4. User học liên tiếp 5 ngày: current streak = 5
  await t.test('Case 4: User học liên tiếp 5 ngày: current streak = 5', () => {
    let streak = { current_streak: 1, longest_streak: 1, last_activity_date: '2026-09-20' };
    const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];

    for (const today of days) {
      const lastDate = streak.last_activity_date;
      const diff = LearningStreakService.diffInCalendarDays(today, lastDate);
      assert.equal(diff, 1, 'Khoảng cách giữa các ngày liên tiếp phải là 1');
      streak.current_streak += 1;
      streak.longest_streak = Math.max(streak.longest_streak, streak.current_streak);
      streak.last_activity_date = today;
    }

    assert.equal(streak.current_streak, 5);
    assert.equal(streak.longest_streak, 5);
  });

  // 5. User bỏ lỡ 1 ngày nhưng recovery: streak được giữ lại
  await t.test('Case 5: User bỏ lỡ 1 ngày nhưng recovery: streak được giữ lại', async () => {
    const testSubId = randomUUID();
    await pool.query(
      `INSERT INTO subjects (id, code, name) VALUES ($1, $2, 'Algorithm')`,
      [testSubId, `ALGO_${testSubId.slice(0, 6)}`]
    );

    const today = LearningStreakService.getVietnamToday();
    const twoDaysAgo = LearningStreakService.addDays(today, -2);
    const yesterday = LearningStreakService.addDays(today, -1);

    // Giả lập streak đang là 5, hoạt động cuối 2 ngày trước (hôm qua bỏ lỡ)
    await pool.query(
      `INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, last_activity_date, recovery_used)
       VALUES ($1, $2, 5, 5, $3, 0)
       ON CONFLICT (user_id, subject_id) DO UPDATE SET current_streak = 5, last_activity_date = $3, recovery_used = 0`,
      [userId1, testSubId, twoDaysAgo]
    );

    // Trước khi recovery: hôm qua bỏ lỡ -> streak bị mất tạm thời (0)
    const beforeStreak = await LearningStreakService.getSubjectStreak(userId1, testSubId);
    assert.equal(beforeStreak.currentStreak, 0);

    // Thực hiện recovery
    const recoveryRes = await LearningStreakService.recoverSubjectStreak(userId1, testSubId);
    assert.equal(recoveryRes.data.currentStreak, 5, 'Streak phải được khôi phục về 5');
    assert.equal(recoveryRes.data.recoveryUsed, 1);

    // Sau khi recovery: last_activity_date trở thành hôm qua -> streak có hiệu lực lại là 5
    const afterStreak = await LearningStreakService.getSubjectStreak(userId1, testSubId);
    assert.equal(afterStreak.currentStreak, 5);
    assert.equal(afterStreak.lastActivityDate, yesterday);
  });

  // 6. Recovery tăng đúng quota (1/3 -> 2/3 -> 3/3)
  await t.test('Case 6: Recovery tăng đúng quota', async () => {
    const testSubId = randomUUID();
    await pool.query(
      `INSERT INTO subjects (id, code, name) VALUES ($1, $2, 'Networks')`,
      [testSubId, `NET_${testSubId.slice(0, 6)}`]
    );

    const today = LearningStreakService.getVietnamToday();
    const twoDaysAgo = LearningStreakService.addDays(today, -2);

    await pool.query(
      `INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, last_activity_date, recovery_used)
       VALUES ($1, $2, 3, 3, $3, 0)`,
      [userId1, testSubId, twoDaysAgo]
    );

    // Khôi phục lần 1
    const rec1 = await LearningStreakService.recoverSubjectStreak(userId1, testSubId);
    assert.equal(rec1.data.recoveryUsed, 1);
    assert.equal(rec1.data.recoveryRemaining, 2);

    // Giả lập lại tình trạng bỏ lỡ 1 ngày để test lần 2
    await pool.query(
      `UPDATE subject_streaks SET last_activity_date = $1 WHERE user_id = $2 AND subject_id = $3`,
      [twoDaysAgo, userId1, testSubId]
    );
    await pool.query(
      `DELETE FROM subject_streak_activities WHERE user_id = $1 AND subject_id = $2 AND activity_date = $3`,
      [userId1, testSubId, LearningStreakService.addDays(today, -1)]
    );

    // Khôi phục lần 2
    const rec2 = await LearningStreakService.recoverSubjectStreak(userId1, testSubId);
    assert.equal(rec2.data.recoveryUsed, 2);
    assert.equal(rec2.data.recoveryRemaining, 1);
  });

  // 7. Recovery lần thứ 4 trong tháng: reject
  await t.test('Case 7: Recovery lần thứ 4 trong tháng: reject', async () => {
    const testSubId = randomUUID();
    await pool.query(
      `INSERT INTO subjects (id, code, name) VALUES ($1, $2, 'Architecture')`,
      [testSubId, `ARC_${testSubId.slice(0, 6)}`]
    );

    const today = LearningStreakService.getVietnamToday();
    const twoDaysAgo = LearningStreakService.addDays(today, -2);
    const monthStart = LearningStreakService.getVietnamCurrentMonthStart();

    // Giả lập đã dùng 3 lần trong tháng
    await pool.query(
      `INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, last_activity_date, recovery_used, recovery_month)
       VALUES ($1, $2, 4, 4, $3, 3, $4)`,
      [userId1, testSubId, twoDaysAgo, monthStart]
    );

    await assert.rejects(
      async () => {
        await LearningStreakService.recoverSubjectStreak(userId1, testSubId);
      },
      { message: 'RECOVERY_LIMIT_EXCEEDED' }
    );
  });

  // 8. Sang tháng mới: recovery quota = 3
  await t.test('Case 8: Sang tháng mới: recovery quota = 3', () => {
    const prevMonth = '2026-08-01';
    const streakRow = {
      current_streak: 5,
      longest_streak: 10,
      last_activity_date: '2026-09-23',
      recovery_used: 3,
      recovery_month: prevMonth,
    };

    const calculated = LearningStreakService.calculateCurrentStreak(streakRow, '2026-09-24');
    assert.equal(calculated.recoveryUsed, 0, 'Tháng mới phải tự động reset recoveryUsed về 0');
    assert.equal(calculated.recoveryRemaining, 3, 'Quota tháng mới là 3');
  });

  // 9. Bỏ lỡ 2 ngày liên tiếp: streak cũ mất vĩnh viễn
  await t.test('Case 9: Bỏ lỡ 2 ngày liên tiếp: streak cũ mất vĩnh viễn', async () => {
    const testSubId = randomUUID();
    await pool.query(
      `INSERT INTO subjects (id, code, name) VALUES ($1, $2, 'Security')`,
      [testSubId, `SEC_${testSubId.slice(0, 6)}`]
    );

    const today = LearningStreakService.getVietnamToday();
    const threeDaysAgo = LearningStreakService.addDays(today, -3);

    await pool.query(
      `INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, last_activity_date, recovery_used)
       VALUES ($1, $2, 10, 15, $3, 0)`,
      [userId1, testSubId, threeDaysAgo]
    );

    // Xem streak: diff = 3 -> mất vĩnh viễn
    const streakData = await LearningStreakService.getSubjectStreak(userId1, testSubId);
    assert.equal(streakData.currentStreak, 0);
    assert.equal(streakData.longestStreak, 15);

    // Cố gắng recovery: reject
    await assert.rejects(
      async () => {
        await LearningStreakService.recoverSubjectStreak(userId1, testSubId);
      },
      { message: 'STREAK_PERMANENTLY_LOST' }
    );
  });

  // 10. Sau khi streak mất: longest_streak vẫn giữ nguyên
  await t.test('Case 10: Sau khi streak mất: longest_streak vẫn giữ nguyên', () => {
    const streakRow = {
      current_streak: 10,
      longest_streak: 15,
      last_activity_date: '2026-09-20',
    };
    const calculated = LearningStreakService.calculateCurrentStreak(streakRow, '2026-09-24');
    assert.equal(calculated.currentStreak, 0);
    assert.equal(calculated.longestStreak, 15, 'longest_streak KHÔNG được reset');
  });

  // 11. Hai subject khác nhau: streak độc lập
  await t.test('Case 11: Hai subject khác nhau: streak độc lập', async () => {
    const streakSub1 = await LearningStreakService.getSubjectStreak(userId1, subjectId1);
    const streakSub2 = await LearningStreakService.getSubjectStreak(userId1, subjectId2);

    assert.equal(streakSub1.subjectId, subjectId1);
    assert.equal(streakSub2.subjectId, subjectId2);
    assert.notEqual(streakSub1.subjectId, streakSub2.subjectId);
    assert.equal(streakSub1.currentStreak, 1);
    assert.equal(streakSub2.currentStreak, 0);
  });

  // 12. Hai user khác nhau: streak độc lập
  await t.test('Case 12: Hai user khác nhau: streak độc lập', async () => {
    const user1Streak = await LearningStreakService.getSubjectStreak(userId1, subjectId1);
    const user2Streak = await LearningStreakService.getSubjectStreak(userId2, subjectId1);

    assert.equal(user1Streak.currentStreak, 1);
    assert.equal(user2Streak.currentStreak, 0);
  });

  // 13. Hai request completion đồng thời: không double increment
  await t.test('Case 13: Hai request completion đồng thời: không double increment', async () => {
    const concurrentUserId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'student')`,
      [concurrentUserId, `conc_${concurrentUserId.slice(0, 6)}@test.com`]
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, full_name) VALUES ($1, 'Concurrent User')`,
      [concurrentUserId]
    );

    // Chạy song song 2 hoàn thành deck
    const [resA, resB] = await Promise.all([
      LearningStreakService.recordFlashcardDeckCompletion({ userId: concurrentUserId, deckId: deckId1 }),
      LearningStreakService.recordFlashcardDeckCompletion({ userId: concurrentUserId, deckId: deckId2 }),
    ]);

    assert.equal(resA.currentStreak, 1);
    assert.equal(resB.currentStreak, 1);

    // Kiểm tra kết quả trong DB: chỉ có đúng 1 activity cho ngày hôm nay và streak = 1
    const streakInDB = await LearningStreakService.getSubjectStreak(concurrentUserId, subjectId1);
    assert.equal(streakInDB.currentStreak, 1, 'Streak chỉ được tăng 1 lần duy nhất dù gửi request đồng thời');
  });

  // 14. Socket event được emit sau khi transaction thành công
  await t.test('Case 14: Socket event được emit sau khi transaction thành công', async () => {
    let emitted = false;
    let eventName = '';
    let emittedPayload = null;

    // Mock Socket.IO server
    const mockIO = {
      to: (room) => {
        assert.equal(room, `user:${userId2}`);
        return {
          emit: (event, payload) => {
            emitted = true;
            eventName = event;
            emittedPayload = payload;
          },
        };
      },
    };

    const originalGetIO = socketConfig.getIO;
    socketConfig.getIO = () => mockIO;

    try {
      await LearningStreakService.recordFlashcardDeckCompletion({
        userId: userId2,
        deckId: deckId1,
      });

      assert.equal(emitted, true);
      assert.equal(eventName, 'learning:streak-updated');
      assert.equal(emittedPayload.currentStreak, 1);
      assert.equal(emittedPayload.subjectId, subjectId1);
    } finally {
      socketConfig.getIO = originalGetIO;
    }
  });

  // 15. Transaction fail: không emit Socket event
  await t.test('Case 15: Transaction fail: không emit Socket event', async () => {
    let emitted = false;
    const mockIO = {
      to: () => ({
        emit: () => {
          emitted = true;
        },
      }),
    };

    const originalGetIO = socketConfig.getIO;
    socketConfig.getIO = () => mockIO;

    try {
      // Truyền deckId không tồn tại -> throw lỗi
      await assert.rejects(
        async () => {
          await LearningStreakService.recordFlashcardDeckCompletion({
            userId: userId2,
            deckId: randomUUID(),
          });
        },
        { message: 'DECK_NOT_FOUND' }
      );

      assert.equal(emitted, false, 'Không được emit socket khi transaction fail');
    } finally {
      socketConfig.getIO = originalGetIO;
    }
  });

  // 16. User không thể xem streak của user khác
  await t.test('Case 16: User không thể xem streak của user khác (API lấy từ JWT)', async () => {
    // Request bằng token của user2
    const res = await request(app)
      .get('/api/learning/streak')
      .set('Authorization', generateToken(userId2));

    assert.equal(res.status, 200);
    // user2 chỉ có streak của mình (vừa tạo ở case 14)
    assert.equal(Array.isArray(res.body.data), true);
    for (const item of res.body.data) {
      assert.equal(item.subjectId, subjectId1);
      assert.equal(item.currentStreak, 1);
    }
  });

  // 17. User không thể tự gửi subjectId giả để tăng streak
  await t.test('Case 17: User không thể tự gửi subjectId giả để tăng streak', async () => {
    // API POST /api/learning/activity chỉ nhận deckId, không nhận subjectId
    const res = await request(app)
      .post('/api/learning/activity')
      .set('Authorization', generateToken(userId1))
      .send({ subjectId: subjectId2 }); // gửi subjectId nhưng không có deckId

    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
  });

  // Cleanup test data
  await t.test('Teardown test data', async () => {
    await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [userId1, userId2]);
    await pool.query(`DELETE FROM subjects WHERE id IN ($1, $2)`, [subjectId1, subjectId2]);
  });
});

