const { pool, withTransaction } = require('../../config/db.config');

const FlashcardsTestRepository = {
  /**
   * Lấy chi tiết deck để kiểm tra xem deck có tồn tại và active hay không
   */
  async findDeckById(deckId, schoolId) {
    const where = ['fd.id = $1'];
    const params = [deckId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fd.school_id = $2`);
    }

    const deckResult = await pool.query(
      `SELECT fd.id, fd.title, fd.description, fd.is_public, fd.is_active,
              fd.class_id, fd.subject_id, fd.created_by, fd.created_at, fd.updated_at, fd.school_id
       FROM flashcard_decks fd
       WHERE ${where.join(' AND ')}`,
      params
    );
    return deckResult.rows[0] || null;
  },

  /**
   * Lấy danh sách câu hỏi trong deck phục vụ cho test (KHÔNG BAO GỒM answer và explanation)
   */
  async getDeckCardsForTest(deckId, schoolId) {
    const where = [`deck_id = $1`, `is_active = true`, `type = 'multiple_choice'`];
    const params = [deckId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`school_id = $2`);
    }

    const { rows } = await pool.query(
      `SELECT id, type AS question_type, question, options, difficulty, position
       FROM flashcards
       WHERE ${where.join(' AND ')}
       ORDER BY position ASC, created_at ASC`,
      params
    );

    return rows.map((c) => ({
      id: c.id,
      question: c.question,
      question_type: c.question_type,
      options: typeof c.options === 'string' ? JSON.parse(c.options || '[]') : (c.options || []),
      difficulty: c.difficulty,
      position: c.position,
    }));
  },

  /**
   * Lấy danh sách câu hỏi bao gồm đáp án đúng phục vụ cho việc chấm điểm backend
   */
  async getDeckCardsWithAnswers(deckId, schoolId) {
    const where = [`deck_id = $1`, `is_active = true`, `type = 'multiple_choice'`];
    const params = [deckId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`school_id = $2`);
    }

    const { rows } = await pool.query(
      `SELECT id, type AS question_type, question, options, answer, explanation
       FROM flashcards
       WHERE ${where.join(' AND ')}`,
      params
    );

    return rows.map((c) => ({
      id: c.id,
      question: c.question,
      question_type: c.question_type,
      options: typeof c.options === 'string' ? JSON.parse(c.options || '[]') : (c.options || []),
      answer: c.answer,
      explanation: c.explanation,
    }));
  },

  /**
   * Tạo 1 lượt làm bài kiểm tra mới (test session)
   */
  async createTest({ deck_id, user_id, total_questions, school_id }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_tests (deck_id, user_id, total_questions, status, score, started_at, school_id)
       VALUES ($1, $2, $3, 'in_progress', 0, NOW(), $4)
       RETURNING id, deck_id, user_id, total_questions, score, status, started_at, submitted_at, school_id`,
      [deck_id, user_id, total_questions, school_id]
    );
    return rows[0];
  },

  /**
   * Lấy chi tiết lượt làm bài kiểm tra
   */
  async findTestById(testId, schoolId) {
    const where = ['ft.id = $1'];
    const params = [testId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ft.school_id = $2`);
    }

    const { rows } = await pool.query(
      `SELECT ft.*, fd.title AS deck_title, fd.subject_id
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON ft.deck_id = fd.id
       WHERE ${where.join(' AND ')}`,
      params
    );
    return rows[0] || null;
  },

  /**
   * Submit transaction: lưu câu trả lời và cập nhật điểm/trạng thái bài test
   */
  async submitTestTransaction({ testId, answers, score, schoolId }) {
    return withTransaction(async (client) => {
      // 1. Lưu answers
      for (const item of answers) {
        if (schoolId) {
          await client.query(
            `INSERT INTO flashcard_test_answers (test_id, flashcard_id, student_answer, is_correct, score, school_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (test_id, flashcard_id) DO UPDATE SET
               student_answer = EXCLUDED.student_answer,
               is_correct     = EXCLUDED.is_correct,
               score          = EXCLUDED.score,
               school_id      = EXCLUDED.school_id`,
            [testId, item.flashcard_id, item.student_answer || '', item.is_correct || false, item.score || 0, schoolId]
          );
        } else {
          await client.query(
            `INSERT INTO flashcard_test_answers (test_id, flashcard_id, student_answer, is_correct, score)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (test_id, flashcard_id) DO UPDATE SET
               student_answer = EXCLUDED.student_answer,
               is_correct     = EXCLUDED.is_correct,
               score          = EXCLUDED.score`,
            [testId, item.flashcard_id, item.student_answer || '', item.is_correct || false, item.score || 0]
          );
        }
      }

      // 2. Cập nhật test
      const where = ['id = $1'];
      const params = [testId, score];
      if (schoolId) {
        params.push(schoolId);
        where.push(`school_id = $3`);
      }

      const { rows } = await client.query(
        `UPDATE flashcard_tests
         SET score = $2, status = 'submitted', submitted_at = NOW(), updated_at = NOW()
         WHERE ${where.join(' AND ')}
         RETURNING *`,
        params
      );
      return rows[0];
    });
  },

  /**
   * Lấy kết quả bài kiểm tra chi tiết để Student xem lại
   */
  async getTestResult(testId, schoolId) {
    const test = await this.findTestById(testId, schoolId);
    if (!test) return null;

    const where = ['fta.test_id = $1'];
    const params = [testId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fta.school_id = $2`);
    }

    const { rows: answersRows } = await pool.query(
      `SELECT fta.flashcard_id, fta.student_answer, fta.is_correct, fta.score,
              fc.question, fc.type AS question_type, fc.options, fc.answer AS correct_answer, fc.explanation
       FROM flashcard_test_answers fta
       JOIN flashcards fc ON fta.flashcard_id = fc.id
       WHERE ${where.join(' AND ')}
       ORDER BY fc.position ASC, fc.created_at ASC`,
      params
    );

    const questions = answersRows.map((row) => ({
      flashcard_id: row.flashcard_id,
      question: row.question,
      question_type: row.question_type,
      options: typeof row.options === 'string' ? JSON.parse(row.options || '[]') : (row.options || []),
      student_answer: row.student_answer,
      correct_answer: row.correct_answer,
      explanation: row.explanation,
      is_correct: row.is_correct,
      score: Number(row.score),
    }));

    const correctCount = questions.filter((q) => q.is_correct).length;
    const incorrectCount = questions.length - correctCount;
    const percentage = test.total_questions > 0
      ? Math.round((correctCount / test.total_questions) * 100)
      : 0;

    return {
      test_id: test.id,
      deck_id: test.deck_id,
      deck_title: test.deck_title,
      subject_id: test.subject_id,
      total_questions: test.total_questions,
      correct: correctCount,
      incorrect: incorrectCount,
      score: Number(test.score),
      percentage,
      passed_streak: percentage >= 50,
      status: test.status,
      started_at: test.started_at,
      submitted_at: test.submitted_at,
      questions,
    };
  }
};

module.exports = FlashcardsTestRepository;
