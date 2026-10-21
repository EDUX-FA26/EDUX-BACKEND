
const { pool } = require('../../config/db.config');

const TopicSimilarRepository = {
  async findSourceFlashcard(flashcardId) {
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

  async findApprovedTopics(flashcardId, subjectId) {
    const { rows } = await pool.query(
      `SELECT
         t.id,
         t.name,
         t.description
       FROM flashcard_topics ft
       JOIN topics t ON t.id = ft.topic_id
       WHERE ft.flashcard_id = $1
         AND t.subject_id = $2
         AND t.is_active = true
         AND ft.review_status = 'approved'
       ORDER BY t.name`,
      [flashcardId, subjectId]
    );

    return rows;
  }
};

module.exports = TopicSimilarRepository;
