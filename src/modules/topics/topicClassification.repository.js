
const { pool } = require('../../config/db.config');

const TopicClassificationRepository = {
  async findFlashcard(flashcardId) {
    const { rows } = await pool.query(
      `SELECT
          fc.id,
          fc.question,
          fc.answer,
          fc.explanation,
          fc.options,
          fc.type,
          fc.difficulty,
          fc.is_active,
          fd.subject_id,
          fd.created_by,
          fd.is_active AS deck_is_active
       FROM flashcards fc
       JOIN flashcard_decks fd ON fd.id = fc.deck_id
       WHERE fc.id = $1`,
      [flashcardId]
    );

    return rows[0] || null;
  },

  async findTopicsBySubject(subjectId) {
    const { rows } = await pool.query(
      `SELECT id, name, description, parent_id
       FROM topics
       WHERE subject_id = $1 AND is_active = true
       ORDER BY name`,
      [subjectId]
    );

    return rows;
  },

  async findClassification(flashcardId) {
    const { rows } = await pool.query(
      `SELECT *
       FROM flashcard_topic_classifications
       WHERE flashcard_id = $1`,
      [flashcardId]
    );

    return rows[0] || null;
  },

  async saveClassification({
    flashcardId,
    contentHash,
    status,
    model,
    confidence,
    result,
    failureCode = null
  }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_topic_classifications (
          flashcard_id,
          content_hash,
          status,
          model,
          confidence,
          result,
          failure_code,
          attempted_at
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW())
       ON CONFLICT (flashcard_id)
       DO UPDATE SET
          content_hash = EXCLUDED.content_hash,
          status = EXCLUDED.status,
          model = EXCLUDED.model,
          confidence = EXCLUDED.confidence,
          result = EXCLUDED.result,
          failure_code = EXCLUDED.failure_code,
          attempted_at = NOW(),
          updated_at = NOW()
       RETURNING *`,
      [
        flashcardId,
        contentHash,
        status,
        model,
        confidence,
        result == null ? null : JSON.stringify(result),
        failureCode
      ]
    );

    return rows[0];
  }
};

module.exports = TopicClassificationRepository;
