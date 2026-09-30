const { pool, withTransaction } = require('../../config/db.config');

const FlashcardsTestRepository = {
  /**
   * Tạo bảng flashcard_tests & flashcard_test_answers nếu chưa có
   */
  async ensureTestTablesExist() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flashcard_tests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deck_id UUID NOT NULL REFERENCES flashcard_decks(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total_questions INT NOT NULL DEFAULT 0,
        score NUMERIC(5,2) DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
        started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS flashcard_test_answers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        test_id UUID NOT NULL REFERENCES flashcard_tests(id) ON DELETE CASCADE,
        flashcard_id UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
        student_answer TEXT DEFAULT '',
        is_correct BOOLEAN DEFAULT FALSE,
        score NUMERIC(5,2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_test_flashcard UNIQUE (test_id, flashcard_id)
      );

      CREATE INDEX IF NOT EXISTS idx_flashcard_tests_user ON flashcard_tests(user_id);
      CREATE INDEX IF NOT EXISTS idx_flashcard_tests_deck ON flashcard_tests(deck_id);
      CREATE INDEX IF NOT EXISTS idx_flashcard_test_answers_test ON flashcard_test_answers(test_id);
    `);
  },

  /**
   * Lấy chi tiết deck để kiểm tra xem deck có tồn tại và active hay không
   */
  async findDeckById(deckId) {
    const deckResult = await pool.query(
      `SELECT fd.id, fd.title, fd.description, fd.is_public, fd.is_active,
              fd.class_id, fd.subject_id, fd.created_by, fd.created_at, fd.updated_at
       FROM flashcard_decks fd
       WHERE fd.id = $1`,
      [deckId]
    );
    return deckResult.rows[0] || null;
  },

  /**
   * Lấy danh sách câu hỏi trong deck phục vụ cho test (KHÔNG BAO GỒM answer và explanation)
   */
  async getDeckCardsForTest(deckId) {
    const { rows } = await pool.query(
      `SELECT id, type AS question_type, question, options, difficulty, position
       FROM flashcards
       WHERE deck_id = $1 AND is_active = true
       ORDER BY position ASC, created_at ASC`,
      [deckId]
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
  async getDeckCardsWithAnswers(deckId) {
    const { rows } = await pool.query(
      `SELECT id, type AS question_type, question, options, answer, explanation
       FROM flashcards
       WHERE deck_id = $1 AND is_active = true`,
      [deckId]
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
  async createTest({ deck_id, user_id, total_questions }) {
    await this.ensureTestTablesExist();
    const { rows } = await pool.query(
      `INSERT INTO flashcard_tests (deck_id, user_id, total_questions, status, score, started_at)
       VALUES ($1, $2, $3, 'in_progress', 0, NOW())
       RETURNING id, deck_id, user_id, total_questions, score, status, started_at, submitted_at`,
      [deck_id, user_id, total_questions]
    );
    return rows[0];
  },

  /**
   * Lấy chi tiết lượt làm bài kiểm tra
   */
  async findTestById(testId) {
    await this.ensureTestTablesExist();
    const { rows } = await pool.query(
      `SELECT ft.*, fd.title AS deck_title, fd.subject_id
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON ft.deck_id = fd.id
       WHERE ft.id = $1`,
      [testId]
    );
    return rows[0] || null;
  },

  /**
   * Lưu câu trả lời bài kiểm tra
   */
  async saveTestAnswers(testId, answers) {
    if (!answers || answers.length === 0) return [];
    return withTransaction(async (client) => {
      const saved = [];
      for (const item of answers) {
        const { rows } = await client.query(
          `INSERT INTO flashcard_test_answers (test_id, flashcard_id, student_answer, is_correct, score)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (test_id, flashcard_id) DO UPDATE SET
             student_answer = EXCLUDED.student_answer,
             is_correct     = EXCLUDED.is_correct,
             score          = EXCLUDED.score
           RETURNING *`,
          [testId, item.flashcard_id, item.student_answer || '', item.is_correct || false, item.score || 0]
        );
        saved.push(rows[0]);
      }
      return saved;
    });
  },

  /**
   * Cập nhật kết quả bài kiểm tra sau khi submit
   */
  async updateTestResult(testId, { score, status }) {
    const { rows } = await pool.query(
      `UPDATE flashcard_tests
       SET score = $1, status = $2, submitted_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [score, status, testId]
    );
    return rows[0];
  },

  /**
   * Lấy kết quả bài kiểm tra chi tiết để Student xem lại
   */
  async getTestResult(testId) {
    await this.ensureTestTablesExist();
    const test = await this.findTestById(testId);
    if (!test) return null;

    const { rows: answersRows } = await pool.query(
      `SELECT fta.flashcard_id, fta.student_answer, fta.is_correct, fta.score,
              fc.question, fc.type AS question_type, fc.options, fc.answer AS correct_answer, fc.explanation
       FROM flashcard_test_answers fta
       JOIN flashcards fc ON fta.flashcard_id = fc.id
       WHERE fta.test_id = $1
       ORDER BY fc.position ASC, fc.created_at ASC`,
      [testId]
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

    return {
      test_id: test.id,
      deck_id: test.deck_id,
      deck_title: test.deck_title,
      total_questions: test.total_questions,
      correct: correctCount,
      incorrect: incorrectCount,
      score: Number(test.score),
      status: test.status,
      started_at: test.started_at,
      submitted_at: test.submitted_at,
      questions,
    };
  }
};

module.exports = FlashcardsTestRepository;
