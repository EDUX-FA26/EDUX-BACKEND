const FlashcardsTestRepository = require('./flashcardsTest.repository');
const FlashcardsRepository = require('../flashcards/flashcards.repository');
const LearningStreakService = require('../learning/learningStreak.service');

class FlashcardsTestService {
  /**
   * Tạo 1 test session mới cho Student
   */
  async createTest(deckId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsTestRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    await this._checkViewAccess(deck, user, tenant);

    const cards = await FlashcardsTestRepository.getDeckCardsForTest(deckId, schoolId);
    if (!cards || cards.length === 0) {
      throw new Error('DECK_NO_MULTIPLE_CHOICE');
    }

    const test = await FlashcardsTestRepository.createTest({
      deck_id: deckId,
      user_id: user.id,
      total_questions: cards.length,
      school_id: schoolId,
    });

    return {
      test_id: test.id,
      deck_id: deckId,
      deck_title: deck.title,
      total_questions: cards.length,
      status: test.status,
      started_at: test.started_at,
      questions: cards,
    };
  }

  /**
   * Lấy chi tiết bài test để reload/tiếp tục làm bài
   */
  async getTest(testId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const test = await FlashcardsTestRepository.findTestById(testId, schoolId);
    if (!test) throw new Error('TEST_NOT_FOUND');

    if (test.user_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const questions = await FlashcardsTestRepository.getDeckCardsForTest(test.deck_id, schoolId);

    return {
      test_id: test.id,
      deck_id: test.deck_id,
      deck_title: test.deck_title,
      total_questions: test.total_questions,
      score: Number(test.score),
      status: test.status,
      started_at: test.started_at,
      submitted_at: test.submitted_at,
      questions,
    };
  }

  /**
   * Nộp bài kiểm tra & chấm điểm tự động
   * YÊU CẦU: Đúng từ 50% câu trở lên mới được tính và tăng chuỗi học tập (Streak)
   */
  async submitTest(testId, body, user, tenant) {
    const schoolId = tenant?.schoolId;
    const test = await FlashcardsTestRepository.findTestById(testId, schoolId);
    if (!test) throw new Error('TEST_NOT_FOUND');

    if (test.user_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    if (test.status === 'submitted') {
      throw new Error('TEST_ALREADY_SUBMITTED');
    }

    const deckCardsWithAnswers = await FlashcardsTestRepository.getDeckCardsWithAnswers(test.deck_id, schoolId);

    const studentAnswerMap = new Map();
    const rawAnswers = body?.answers || [];
    rawAnswers.forEach((item) => {
      if (item && item.flashcard_id) {
        studentAnswerMap.set(item.flashcard_id, item.answer || '');
      }
    });

    let correctCount = 0;
    const processedAnswers = [];

    for (const card of deckCardsWithAnswers) {
      const studentAns = studentAnswerMap.get(card.id) || '';
      const isCorrect = this._gradeAnswer(card.question_type, studentAns, card.answer);
      const questionScore = isCorrect ? 1.0 : 0.0;
      if (isCorrect) correctCount++;

      processedAnswers.push({
        flashcard_id: card.id,
        student_answer: studentAns,
        is_correct: isCorrect,
        score: questionScore,
      });
    }

    const totalQuestions = deckCardsWithAnswers.length || 1;
    const finalScore = Math.round((correctCount / totalQuestions) * 10 * 10) / 10;
    const percentage = Math.round((correctCount / totalQuestions) * 100);
    const isPassedStreak = percentage >= 50;

    await FlashcardsTestRepository.submitTestTransaction({
      testId,
      answers: processedAnswers,
      score: finalScore,
      schoolId,
    });

    // ─── TÍNH TOÁN STREAK: Đúng từ 50% trở lên mới tăng chuỗi ─────────
    let streakResult = null;
    if (isPassedStreak) {
      try {
        streakResult = await LearningStreakService.recordFlashcardTestCompletion({
          schoolId,
          userId: user.id,
          deckId: test.deck_id,
          testId,
          score: finalScore,
          percentage,
        });
      } catch (streakErr) {
        console.error('❌ Lỗi cập nhật streak khi hoàn thành test:', streakErr);
      }
    }

    return {
      test_id: testId,
      deck_id: test.deck_id,
      total_questions: totalQuestions,
      correct: correctCount,
      incorrect: totalQuestions - correctCount,
      score: finalScore,
      percentage,
      passed_streak: isPassedStreak,
      streak: streakResult,
      status: 'submitted',
    };
  }

  /**
   * Xem kết quả chi tiết bài test đã nộp
   */
  async getTestResult(testId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const test = await FlashcardsTestRepository.findTestById(testId, schoolId);
    if (!test) throw new Error('TEST_NOT_FOUND');

    if (test.user_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    if (test.status !== 'submitted') {
      throw new Error('TEST_NOT_SUBMITTED');
    }

    return FlashcardsTestRepository.getTestResult(testId, schoolId);
  }

  _normalizeString(str) {
    if (typeof str !== 'string') return '';
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  _gradeAnswer(type, studentAns, realAns) {
    const normStudent = this._normalizeString(studentAns);
    const normReal = this._normalizeString(realAns);
    if (!normStudent || !normReal) return false;
    return normStudent === normReal;
  }

  async _checkViewAccess(deck, user, tenant) {
    const role = tenant?.role || user?.role;
    if (role === 'school_admin' || role === 'admin') return;

    if (role === 'lecturer') {
      if (deck.created_by === user.id || deck.is_public) return;
      throw new Error('FORBIDDEN');
    }

    // Student
    if (deck.created_by === user.id) return;
    if (deck.is_public) return;

    const schoolId = tenant?.schoolId;
    if (schoolId) {
      const hasClassAccess = await FlashcardsRepository.checkStudentDeckAccess(deck.id, user.id, schoolId);
      if (hasClassAccess) return;
    }

    throw new Error('FORBIDDEN');
  }
}

module.exports = new FlashcardsTestService();
