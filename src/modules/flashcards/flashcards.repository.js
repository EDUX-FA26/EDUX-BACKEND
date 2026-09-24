const { pool } = require('../../config/db.config');

const FlashcardsRepository = {

  // ─────────────────────────────────────────────
  // DECK
  // ─────────────────────────────────────────────

  /**
   * Lấy danh sách deck (có filter + phân trang)
   */
  async findDecks({ page, limit, subject_id, class_id, is_public, created_by, role, userId }) {
    page  = Number(page)  || 1;
    limit = Number(limit) || 10;
    const offset = (page - 1) * limit;
    const params = [];
    const where  = [];

    // Chỉ lấy deck đang active
    where.push(`fd.is_active = true`);

    // Filter theo subject
    if (subject_id) {
      params.push(subject_id);
      where.push(`fd.subject_id = $${params.length}`);
    }

    // Filter theo class
    if (class_id) {
      params.push(class_id);
      where.push(`fd.class_id = $${params.length}`);
    }

    // Student: chỉ thấy deck public hoặc deck trong lớp mình tham gia
    if (role === 'student') {
      params.push(userId);
      where.push(`(fd.is_public = true OR fd.class_id IN (
        SELECT class_id FROM class_members
        WHERE student_id = $${params.length} AND status = 'active'
      ))`);
    }

    // Lecturer: thấy deck của mình + deck public
    if (role === 'lecturer') {
      params.push(userId);
      where.push(`(fd.is_public = true OR fd.created_by = $${params.length})`);
    }

    // Filter is_public (admin có thể dùng)
    if (typeof is_public === 'boolean') {
      params.push(is_public);
      where.push(`fd.is_public = $${params.length}`);
    }

    // Filter theo người tạo
    if (created_by) {
      params.push(created_by);
      where.push(`fd.created_by = $${params.length}`);
    }

    const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const baseQuery = `
      SELECT fd.id, fd.title, fd.description, fd.is_public, fd.is_active,
             fd.class_id, fd.subject_id, fd.created_by, fd.created_at, fd.updated_at,
             s.name AS subject_name, s.code AS subject_code,
             up.full_name AS creator_name,
             COUNT(fc.id)::int AS card_count
      FROM flashcard_decks fd
      JOIN subjects s ON fd.subject_id = s.id
      JOIN user_profiles up ON fd.created_by = up.user_id
      LEFT JOIN flashcards fc ON fc.deck_id = fd.id AND fc.is_active = true
      ${whereStr}
      GROUP BY fd.id, s.name, s.code, up.full_name
    `;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM (${baseQuery}) AS t`, params
    );
    const total = parseInt(countResult.rows[0].count, 10);

    params.push(limit, offset);
    const dataResult = await pool.query(
      `${baseQuery} ORDER BY fd.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return { data: dataResult.rows, total };
  },

  /**
   * Lấy chi tiết 1 deck + toàn bộ cards
   */
  async findDeckById(id) {
    const deckResult = await pool.query(
      `SELECT fd.id, fd.title, fd.description, fd.is_public, fd.is_active,
              fd.class_id, fd.subject_id, fd.created_by, fd.created_at, fd.updated_at,
              s.name AS subject_name, s.code AS subject_code,
              up.full_name AS creator_name
       FROM flashcard_decks fd
       JOIN subjects s ON fd.subject_id = s.id
       JOIN user_profiles up ON fd.created_by = up.user_id
       WHERE fd.id = $1`,
      [id]
    );
    if (!deckResult.rows[0]) return null;

    const cardsResult = await pool.query(
      `SELECT id, type, question, options, answer, explanation, difficulty, position, is_active, created_at, updated_at
       FROM flashcards
       WHERE deck_id = $1 AND is_active = true
       ORDER BY position ASC, created_at ASC`,
      [id]
    );

    return { ...deckResult.rows[0], cards: cardsResult.rows };
  },

  /**
   * Tạo deck mới
   */
  async createDeck({ title, description, subject_id, class_id, is_public, created_by }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_decks (title, description, subject_id, class_id, is_public, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, description || '', subject_id, class_id || null, is_public ?? false, created_by]
    );
    return rows[0];
  },

  /**
   * Cập nhật deck
   */
  async updateDeck(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = ['title', 'description', 'subject_id', 'class_id', 'is_public', 'is_active'];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(data[key]);
      }
    }
    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE flashcard_decks SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  },

  /**
   * Xóa mềm deck (is_active = false)
   */
  async deleteDeck(id) {
    const { rows } = await pool.query(
      `UPDATE flashcard_decks SET is_active = false, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0];
  },

  /**
   * Publish deck: đặt is_public = true
   */
  async publishDeck(id) {
    const { rows } = await pool.query(
      `UPDATE flashcard_decks
       SET is_public = true, updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, description, is_public, is_active,
                 class_id, subject_id, created_by, created_at, updated_at`,
      [id]
    );
    return rows[0];
  },

  // ─────────────────────────────────────────────
  // CARD
  // ─────────────────────────────────────────────

  /**
   * Lấy chi tiết 1 card
   */
  async findCardById(id) {
    const { rows } = await pool.query(
      `SELECT fc.*, fd.title AS deck_title, fd.created_by AS deck_owner_id
       FROM flashcards fc
       JOIN flashcard_decks fd ON fc.deck_id = fd.id
       WHERE fc.id = $1`,
      [id]
    );
    return rows[0];
  },

  /**
   * Lấy số thứ tự tiếp theo cho card trong deck
   */
  async getNextPosition(deckId) {
    const { rows } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos
       FROM flashcards WHERE deck_id = $1`,
      [deckId]
    );
    return rows[0].next_pos;
  },

  /**
   * Tạo card mới
   */
  async createCard({ deck_id, type, question, options, answer, explanation, difficulty, position }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcards (deck_id, type, question, options, answer, explanation, difficulty, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        deck_id,
        type || 'essay',
        question,
        JSON.stringify(options || []),
        answer,
        explanation || '',
        difficulty || 'medium',
        position,
      ]
    );
    return rows[0];
  },

  /**
   * Cập nhật card
   */
  async updateCard(id, data) {
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = ['type', 'question', 'options', 'answer', 'explanation', 'difficulty', 'position', 'is_active'];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(key === 'options' ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE flashcards SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return rows[0];
  },

  /**
   * Xóa mềm card (is_active = false)
   */
  async deleteCard(id) {
    const { rows } = await pool.query(
      `UPDATE flashcards SET is_active = false, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    return rows[0];
  },

  // ─────────────────────────────────────────────
  // REVIEW
  // ─────────────────────────────────────────────

  /**
   * Ghi một lần review vào bảng flashcard_reviews
   */
  async createReview({ user_id, flashcard_id, result }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_reviews (user_id, flashcard_id, result)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, flashcard_id, result, reviewed_at`,
      [user_id, flashcard_id, result]
    );
    return rows[0];
  },

  /**
   * Thống kê tiến độ học của user trên toàn bộ cards trong 1 deck:
   * - Tổng số card active trong deck
   * - Số card đã được review ít nhất 1 lần
   * - Tổng lượt review, số correct, số incorrect
   * - Kết quả gần nhất (last_result) của từng card
   */
  async getDeckReviewStats(deckId, userId) {
    // Tổng card active
    const { rows: [{ total_cards }] } = await pool.query(
      `SELECT COUNT(*)::int AS total_cards
       FROM flashcards
       WHERE deck_id = $1 AND is_active = true`,
      [deckId]
    );

    // Tổng hợp review của user trong deck
    const { rows: [agg] } = await pool.query(
      `SELECT
         COUNT(*)::int                                              AS total_reviews,
         COUNT(*) FILTER (WHERE fr.result = 'correct')::int        AS correct,
         COUNT(*) FILTER (WHERE fr.result = 'incorrect')::int      AS incorrect,
         COUNT(DISTINCT fr.flashcard_id)::int                      AS reviewed_cards
       FROM flashcard_reviews fr
       JOIN flashcards fc ON fr.flashcard_id = fc.id
       WHERE fc.deck_id = $1
         AND fr.user_id = $2`,
      [deckId, userId]
    );

    // Kết quả gần nhất của từng card (dùng cho UI hiển thị đúng/sai trên từng thẻ)
    const { rows: cardResults } = await pool.query(
      `SELECT DISTINCT ON (fr.flashcard_id)
              fr.flashcard_id AS card_id,
              fr.result       AS last_result,
              fr.reviewed_at  AS last_reviewed_at
       FROM flashcard_reviews fr
       JOIN flashcards fc ON fr.flashcard_id = fc.id
       WHERE fc.deck_id = $1
         AND fr.user_id = $2
       ORDER BY fr.flashcard_id, fr.reviewed_at DESC`,
      [deckId, userId]
    );

    const accuracy = agg.total_reviews > 0
      ? Math.round((agg.correct / agg.total_reviews) * 100)
      : 0;

    return {
      total_cards,
      reviewed_cards:   agg.reviewed_cards,
      unreviewed_cards: total_cards - agg.reviewed_cards,
      total_reviews:    agg.total_reviews,
      correct:          agg.correct,
      incorrect:        agg.incorrect,
      accuracy,            // % chính xác (correct / total_reviews)
      card_results:     cardResults,
    };
  },
};

module.exports = FlashcardsRepository;
