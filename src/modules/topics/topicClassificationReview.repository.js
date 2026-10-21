
const { pool } = require('../../config/db.config');

const Repository = {
    async transaction(callback) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },

    async getCard(client, flashcardId) {
        const { rows } = await client.query(
            `SELECT fc.id, fc.question, fc.answer,
              fc.explanation, fc.options, fc.type,
              fc.difficulty, fc.is_active,
              fd.subject_id, fd.created_by,
              fd.is_active AS deck_is_active
       FROM flashcards fc
       JOIN flashcard_decks fd ON fd.id = fc.deck_id
       WHERE fc.id = $1
       FOR UPDATE OF fc`,
            [flashcardId]
        );
        return rows[0] || null;
    },

    async getClassification(client, flashcardId) {
        const { rows } = await client.query(
            `SELECT *
       FROM flashcard_topic_classifications
       WHERE flashcard_id = $1
       FOR UPDATE`,
            [flashcardId]
        );
        return rows[0] || null;
    },

    async getTopics(client, subjectId) {
        const { rows } = await client.query(
            `SELECT id, name, description, parent_id
       FROM topics
       WHERE subject_id = $1 AND is_active = true
       ORDER BY name`,
            [subjectId]
        );
        return rows;
    },


    async findProtectedMapping(client, flashcardId) {
        const { rows } = await client.query(
            `SELECT flashcard_id, topic_id, mapping_source, review_status
     FROM flashcard_topics
     WHERE flashcard_id = $1
       AND mapping_source IN ('manual', 'lecturer')
       AND review_status = 'approved'
     LIMIT 1
     FOR UPDATE`,
            [flashcardId]
        );

        return rows[0] || null;
    },

    async saveMapping(client, {
        flashcardId,
        topicId,
        source,
        userId,
        confidence,
        explanation
    }) {
        const { rows } = await client.query(
            `INSERT INTO flashcard_topics (
       flashcard_id,
       topic_id,
       mapping_source,
       review_status,
       mapped_by,
       ai_confidence,
       ai_explanation
     )
     VALUES ($1, $2, $3, 'approved', $4, $5, $6)
     ON CONFLICT (flashcard_id, topic_id)
     DO UPDATE SET
       mapping_source = EXCLUDED.mapping_source,
       review_status = 'approved',
       mapped_by = EXCLUDED.mapped_by,
       ai_confidence = EXCLUDED.ai_confidence,
       ai_explanation = EXCLUDED.ai_explanation,
       updated_at = NOW()
     WHERE NOT (
       flashcard_topics.mapping_source IN ('manual', 'lecturer')
       AND flashcard_topics.review_status = 'approved'
     )
     RETURNING *`,
            [
                flashcardId,
                topicId,
                source,
                userId,
                confidence ?? null,
                explanation ?? null
            ]
        );

        return rows[0] || null;
    },

    async saveReview(client, {
        flashcardId, status, failureCode, result
    }) {
        const { rows } = await client.query(
            `UPDATE flashcard_topic_classifications
       SET status = $2,
           failure_code = $3,
           result = $4::jsonb,
           updated_at = NOW()
       WHERE flashcard_id = $1
       RETURNING *`,
            [
                flashcardId,
                status,
                failureCode,
                JSON.stringify(result)
            ]
        );
        return rows[0];
    }
};

module.exports = Repository;
