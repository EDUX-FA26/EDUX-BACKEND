const FlashcardsTestRepository = require('./flashcardsTest.repository');

class FlashcardsTestService {
  /**
   * Tạo 1 test session mới cho Student
   */
  async createTest(deckId, user) {
    const deck = await FlashcardsTestRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    this._checkViewAccess(deck, user);

    const cards = await FlashcardsTestRepository.getDeckCardsForTest(deckId);
    if (!cards || cards.length === 0) {
      throw new Error('DECK_EMPTY');
    }

    const test = await FlashcardsTestRepository.createTest({
      deck_id: deckId,
      user_id: user.id,
      total_questions: cards.length,
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
  async getTest(testId, user) {
    const test = await FlashcardsTestRepository.findTestById(testId);
    if (!test) throw new Error('TEST_NOT_FOUND');

    if (test.user_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const questions = await FlashcardsTestRepository.getDeckCardsForTest(test.deck_id);

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
   */
  async submitTest(testId, body, user) {
    const test = await FlashcardsTestRepository.findTestById(testId);
    if (!test) throw new Error('TEST_NOT_FOUND');

    if (test.user_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    if (test.status === 'submitted') {
      throw new Error('TEST_ALREADY_SUBMITTED');
    }

    const deckCardsWithAnswers = await FlashcardsTestRepository.getDeckCardsWithAnswers(test.deck_id);

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

    await FlashcardsTestRepository.saveTestAnswers(testId, processedAnswers);
    await FlashcardsTestRepository.updateTestResult(testId, {
      score: finalScore,
      status: 'submitted',
    });

    return {
      test_id: testId,
      total_questions: totalQuestions,
      correct: correctCount,
      incorrect: totalQuestions - correctCount,
      score: finalScore,
      status: 'submitted',
    };
  }

  /**
   * Xem kết quả chi tiết bài test đã nộp
   */
  async getTestResult(testId, user) {
    const test = await FlashcardsTestRepository.findTestById(testId);
    if (!test) throw new Error('TEST_NOT_FOUND');

    if (test.user_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    if (test.status !== 'submitted') {
      throw new Error('TEST_NOT_SUBMITTED');
    }

    return FlashcardsTestRepository.getTestResult(testId);
  }

  /**
   * Helper normalize & chấm điểm (Multiple Choice & Essay)
   */
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

  /**
   * Kiểm tra quyền xem deck
   */
  _checkViewAccess(deck, user) {
    if (user.role === 'admin') return;
    if (deck.is_public) return;
    if (deck.created_by === user.id) return;
    throw new Error('FORBIDDEN');
  }
}

module.exports = new FlashcardsTestService();
