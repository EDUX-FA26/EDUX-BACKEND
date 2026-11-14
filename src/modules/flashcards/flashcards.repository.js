const { pool, withTransaction } = require('../../config/db.config');

const FlashcardsRepository = {

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────

  async findSubjectById(subjectId, schoolId) {
    if (!subjectId) return null;
    const query = schoolId
      ? `SELECT id, name, code FROM subjects WHERE id = $1 AND school_id = $2`
      : `SELECT id, name, code FROM subjects WHERE id = $1`;
    const params = schoolId ? [subjectId, schoolId] : [subjectId];
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  async findClassById(classId, schoolId) {
    if (!classId) return null;
    const query = schoolId
      ? `SELECT id, class_code FROM classes WHERE id = $1 AND school_id = $2`
      : `SELECT id, class_code FROM classes WHERE id = $1`;
    const params = schoolId ? [classId, schoolId] : [classId];
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  async verifyClassesInSchool(classIds, schoolId) {
    if (!classIds || classIds.length === 0) return [];
    const query = schoolId
      ? `SELECT id FROM classes WHERE school_id = $1 AND id = ANY($2::uuid[])`
      : `SELECT id FROM classes WHERE id = ANY($1::uuid[])`;
    const params = schoolId ? [schoolId, classIds] : [classIds];
    const { rows } = await pool.query(query, params);
    return rows;
  },

  async checkStudentDeckAccess(deckId, studentId, schoolId) {
    const query = schoolId
      ? `SELECT 1 FROM flashcard_decks fd
         WHERE fd.id = $1 AND fd.school_id = $3
           AND (
             fd.class_id IN (
               SELECT cm.class_id FROM class_members cm
               JOIN classes c ON c.id = cm.class_id
               WHERE cm.student_id = $2 AND (cm.status IS NULL OR cm.status = 'active') AND c.school_id = $3
             )
             OR fd.id IN (
               SELECT fdca.deck_id FROM flashcard_deck_class_access fdca
               JOIN class_members cm ON cm.class_id = fdca.class_id
               JOIN classes c ON c.id = cm.class_id
               WHERE fdca.deck_id = $1 AND fdca.school_id = $3
                 AND cm.student_id = $2 AND (cm.status IS NULL OR cm.status = 'active') AND c.school_id = $3
             )
           )
         LIMIT 1`
      : `SELECT 1 FROM flashcard_decks fd
         WHERE fd.id = $1
           AND (
             fd.class_id IN (
               SELECT cm.class_id FROM class_members cm
               WHERE cm.student_id = $2 AND (cm.status IS NULL OR cm.status = 'active')
             )
             OR fd.id IN (
               SELECT fdca.deck_id FROM flashcard_deck_class_access fdca
               JOIN class_members cm ON cm.class_id = fdca.class_id
               WHERE fdca.deck_id = $1
                 AND cm.student_id = $2 AND (cm.status IS NULL OR cm.status = 'active')
             )
           )
         LIMIT 1`;
    const params = schoolId ? [deckId, studentId, schoolId] : [deckId, studentId];
    const { rows } = await pool.query(query, params);
    return rows.length > 0;
  },

  // ─────────────────────────────────────────────
  // DECK
  // ─────────────────────────────────────────────

  async findDecks({ page, limit, subject_id, class_id, is_public, created_by, role, userId, schoolId }) {
    page = Number(page) || 1;
    limit = Number(limit) || 10;
    const offset = (page - 1) * limit;
    const params = [];
    const where = [];

    where.push(`fd.is_active = true`);

    if (schoolId) {
      params.push(schoolId);
      where.push(`fd.school_id = $${params.length}`);
    }

    if (subject_id) {
      params.push(subject_id);
      where.push(`fd.subject_id = $${params.length}`);
    }

    if (class_id) {
      params.push(class_id);
      where.push(`fd.class_id = $${params.length}`);
    }

    if (role === 'student') {
      params.push(userId);
      const userParamIdx = params.length;

      if (schoolId) {
        where.push(`(
          fd.is_public = true
          OR fd.class_id IN (
            SELECT cm.class_id FROM class_members cm
            JOIN classes c ON c.id = cm.class_id
            WHERE cm.student_id = $${userParamIdx} AND (cm.status IS NULL OR cm.status = 'active') AND c.school_id = $1
          )
          OR fd.id IN (
            SELECT fdca.deck_id FROM flashcard_deck_class_access fdca
            JOIN class_members cm ON fdca.class_id = cm.class_id
            JOIN classes c ON c.id = cm.class_id
            WHERE cm.student_id = $${userParamIdx} AND (cm.status IS NULL OR cm.status = 'active') AND fdca.school_id = $1 AND c.school_id = $1
          )
        )`);
      } else {
        where.push(`(
          fd.is_public = true
          OR fd.class_id IN (
            SELECT class_id FROM class_members
            WHERE student_id = $${userParamIdx} AND status = 'active'
          )
          OR fd.id IN (
            SELECT deck_id FROM flashcard_deck_class_access fdca
            JOIN class_members cm ON fdca.class_id = cm.class_id
            WHERE cm.student_id = $${userParamIdx} AND cm.status = 'active'
          )
        )`);
      }
    }

    if (role === 'lecturer') {
      params.push(userId);
      where.push(`(fd.created_by = $${params.length} OR fd.is_public = true)`);
    }

    if (typeof is_public === 'boolean') {
      params.push(is_public);
      where.push(`fd.is_public = $${params.length}`);
    }

    if (created_by) {
      params.push(created_by);
      where.push(`fd.created_by = $${params.length}`);
    }

    const whereStr = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const baseQuery = `
      SELECT fd.id, fd.title, fd.description, fd.is_public, fd.is_active,
             fd.class_id, fd.subject_id, fd.created_by, fd.created_at, fd.updated_at,
             fd.school_id,
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

  async findDeckById(id, schoolId) {
    const where = ['fd.id = $1'];
    const params = [id];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fd.school_id = $2`);
    }

    const deckResult = await pool.query(
      `SELECT fd.id, fd.title, fd.description, fd.is_public, fd.is_active,
              fd.class_id, fd.subject_id, fd.created_by, fd.created_at, fd.updated_at,
              fd.school_id,
              s.name AS subject_name, s.code AS subject_code,
              up.full_name AS creator_name
       FROM flashcard_decks fd
       JOIN subjects s ON fd.subject_id = s.id
       JOIN user_profiles up ON fd.created_by = up.user_id
       WHERE ${where.join(' AND ')}`,
      params
    );
    if (!deckResult.rows[0]) return null;

    const cardsResult = await pool.query(
      `SELECT fc.id, fc.type, fc.question, fc.options, fc.answer, fc.explanation, fc.difficulty, fc.position, fc.is_active, fc.created_at, fc.updated_at, fc.school_id,
              (
                SELECT t.id FROM flashcard_topics ft
                JOIN topics t ON t.id = ft.topic_id AND t.is_active = true
                WHERE ft.flashcard_id = fc.id
                ORDER BY ft.created_at DESC LIMIT 1
              ) AS topic_id,
              (
                SELECT t.name FROM flashcard_topics ft
                JOIN topics t ON t.id = ft.topic_id AND t.is_active = true
                WHERE ft.flashcard_id = fc.id
                ORDER BY ft.created_at DESC LIMIT 1
              ) AS topic_name
       FROM flashcards fc
       WHERE fc.deck_id = $1 AND fc.is_active = true
       ORDER BY fc.position ASC, fc.created_at ASC`,
      [id]
    );

    return { ...deckResult.rows[0], cards: cardsResult.rows };
  },

  async createDeck({ title, description, subject_id, class_id, is_public, created_by, school_id }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_decks (title, description, subject_id, class_id, is_public, created_by, school_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, description || '', subject_id, class_id || null, is_public ?? false, created_by, school_id]
    );
    return rows[0];
  },

  async updateDeck(id, data, schoolId) {
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
    const idIdx = idx++;

    let whereClause = `WHERE id = $${idIdx}`;
    if (schoolId) {
      values.push(schoolId);
      whereClause += ` AND school_id = $${idx++}`;
    }

    const { rows } = await pool.query(
      `UPDATE flashcard_decks SET ${fields.join(', ')} ${whereClause} RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteDeck(id, schoolId) {
    const query = schoolId
      ? `UPDATE flashcard_decks SET is_active = false, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *`
      : `UPDATE flashcard_decks SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const params = schoolId ? [id, schoolId] : [id];
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  async publishDeck(id, schoolId) {
    const query = schoolId
      ? `UPDATE flashcard_decks
         SET is_public = true, updated_at = NOW()
         WHERE id = $1 AND school_id = $2
         RETURNING id, title, description, is_public, is_active,
                   class_id, subject_id, created_by, created_at, updated_at, school_id`
      : `UPDATE flashcard_decks
         SET is_public = true, updated_at = NOW()
         WHERE id = $1
         RETURNING id, title, description, is_public, is_active,
                   class_id, subject_id, created_by, created_at, updated_at, school_id`;
    const params = schoolId ? [id, schoolId] : [id];
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  // ─────────────────────────────────────────────
  // CARD
  // ─────────────────────────────────────────────

  async findCardById(id, schoolId) {
    const query = schoolId
      ? `SELECT fc.*, fd.title AS deck_title, fd.created_by AS deck_owner_id, fd.subject_id,
                (
                  SELECT t.id FROM flashcard_topics ft
                  JOIN topics t ON t.id = ft.topic_id AND t.is_active = true
                  WHERE ft.flashcard_id = fc.id
                  ORDER BY ft.created_at DESC LIMIT 1
                ) AS topic_id,
                (
                  SELECT t.name FROM flashcard_topics ft
                  JOIN topics t ON t.id = ft.topic_id AND t.is_active = true
                  WHERE ft.flashcard_id = fc.id
                  ORDER BY ft.created_at DESC LIMIT 1
                ) AS topic_name
         FROM flashcards fc
         JOIN flashcard_decks fd ON fc.deck_id = fd.id
         WHERE fc.id = $1 AND fc.school_id = $2`
      : `SELECT fc.*, fd.title AS deck_title, fd.created_by AS deck_owner_id, fd.subject_id,
                (
                  SELECT t.id FROM flashcard_topics ft
                  JOIN topics t ON t.id = ft.topic_id AND t.is_active = true
                  WHERE ft.flashcard_id = fc.id
                  ORDER BY ft.created_at DESC LIMIT 1
                ) AS topic_id,
                (
                  SELECT t.name FROM flashcard_topics ft
                  JOIN topics t ON t.id = ft.topic_id AND t.is_active = true
                  WHERE ft.flashcard_id = fc.id
                  ORDER BY ft.created_at DESC LIMIT 1
                ) AS topic_name
         FROM flashcards fc
         JOIN flashcard_decks fd ON fc.deck_id = fd.id
         WHERE fc.id = $1`;
    const params = schoolId ? [id, schoolId] : [id];
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  async findOrCreateTopic({ subjectId, name, userId, schoolId }, client = pool) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;

    if (schoolId) {
      const existing = await client.query(
        `SELECT id, name FROM topics WHERE subject_id = $1 AND school_id = $2 AND lower(name) = lower($3) LIMIT 1`,
        [subjectId, schoolId, trimmed]
      );
      if (existing.rows[0]) {
        return existing.rows[0];
      }

      const created = await client.query(
        `INSERT INTO topics (subject_id, name, created_by, is_active, school_id)
         VALUES ($1, $2, $3, true, $4)
         RETURNING id, name`,
        [subjectId, trimmed, userId || null, schoolId]
      );
      return created.rows[0];
    }

    const existing = await client.query(
      `SELECT id, name FROM topics WHERE subject_id = $1 AND lower(name) = lower($2) LIMIT 1`,
      [subjectId, trimmed]
    );
    if (existing.rows[0]) {
      return existing.rows[0];
    }

    const created = await client.query(
      `INSERT INTO topics (subject_id, name, created_by, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name`,
      [subjectId, trimmed, userId || null]
    );
    return created.rows[0];
  },

  async setCardTopic({ flashcardId, topicId, userId, schoolId }, client = pool) {
    if (!topicId) {
      if (schoolId) {
        await client.query(`DELETE FROM flashcard_topics WHERE flashcard_id = $1 AND school_id = $2`, [flashcardId, schoolId]);
      } else {
        await client.query(`DELETE FROM flashcard_topics WHERE flashcard_id = $1`, [flashcardId]);
      }
      return;
    }

    if (schoolId) {
      await client.query(`DELETE FROM flashcard_topics WHERE flashcard_id = $1 AND topic_id <> $2 AND school_id = $3`, [flashcardId, topicId, schoolId]);
      await client.query(
        `INSERT INTO flashcard_topics (flashcard_id, topic_id, mapping_source, review_status, mapped_by, school_id)
         VALUES ($1, $2, 'lecturer', 'approved', $3, $4)
         ON CONFLICT (flashcard_id, topic_id)
         DO UPDATE SET
           mapping_source = 'lecturer',
           review_status = 'approved',
           mapped_by = EXCLUDED.mapped_by,
           updated_at = NOW()`,
        [flashcardId, topicId, userId || null, schoolId]
      );
    } else {
      await client.query(`DELETE FROM flashcard_topics WHERE flashcard_id = $1 AND topic_id <> $2`, [flashcardId, topicId]);
      await client.query(
        `INSERT INTO flashcard_topics (flashcard_id, topic_id, mapping_source, review_status, mapped_by)
         VALUES ($1, $2, 'lecturer', 'approved', $3)
         ON CONFLICT (flashcard_id, topic_id)
         DO UPDATE SET
           mapping_source = 'lecturer',
           review_status = 'approved',
           mapped_by = EXCLUDED.mapped_by,
           updated_at = NOW()`,
        [flashcardId, topicId, userId || null]
      );
    }
  },

  async getNextPosition(deckId, schoolId) {
    const query = schoolId
      ? `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM flashcards WHERE deck_id = $1 AND school_id = $2`
      : `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM flashcards WHERE deck_id = $1`;
    const params = schoolId ? [deckId, schoolId] : [deckId];
    const { rows } = await pool.query(query, params);
    return rows[0].next_pos;
  },

  async createCard({ deck_id, type, question, options, answer, explanation, difficulty, position, topic_name, topic_id, userId, subject_id, school_id }) {
    return withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO flashcards (deck_id, type, question, options, answer, explanation, difficulty, position, school_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          deck_id,
          type || 'multiple_choice',
          question,
          JSON.stringify(options || []),
          answer,
          explanation || '',
          difficulty || 'medium',
          position,
          school_id,
        ]
      );
      const card = rows[0];

      let resolvedTopicId = topic_id;
      let resolvedTopicName = topic_name;

      if (!resolvedTopicId && topic_name && subject_id) {
        const topic = await FlashcardsRepository.findOrCreateTopic({ subjectId: subject_id, name: topic_name, userId, schoolId: school_id }, client);
        if (topic) {
          resolvedTopicId = topic.id;
          resolvedTopicName = topic.name;
        }
      }

      if (resolvedTopicId) {
        await FlashcardsRepository.setCardTopic({ flashcardId: card.id, topicId: resolvedTopicId, userId, schoolId: school_id }, client);
      }

      return {
        ...card,
        topic_id: resolvedTopicId || null,
        topic_name: resolvedTopicName || null,
      };
    });
  },

  async updateCard(id, data, { userId, subject_id, topic_name, topic_id, school_id } = {}) {
    return withTransaction(async (client) => {
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

      let card = null;
      if (fields.length > 0) {
        fields.push('updated_at = NOW()');
        values.push(id);
        const idIdx = idx++;
        let whereClause = `WHERE id = $${idIdx}`;
        if (schoolId) {
          values.push(schoolId);
          whereClause += ` AND school_id = $${idx++}`;
        }
        const { rows } = await client.query(
          `UPDATE flashcards SET ${fields.join(', ')} ${whereClause} RETURNING *`,
          values
        );
        card = rows[0];
      } else {
        const query = schoolId
          ? 'SELECT * FROM flashcards WHERE id = $1 AND school_id = $2'
          : 'SELECT * FROM flashcards WHERE id = $1';
        const params = schoolId ? [id, schoolId] : [id];
        const { rows } = await client.query(query, params);
        card = rows[0];
      }

      if (!card) return null;

      let resolvedTopicId = topic_id;
      let resolvedTopicName = topic_name;

      if (topic_name !== undefined || topic_id !== undefined) {
        if (!resolvedTopicId && topic_name && subject_id) {
          const topic = await FlashcardsRepository.findOrCreateTopic({ subjectId: subject_id, name: topic_name, userId, schoolId }, client);
          if (topic) {
            resolvedTopicId = topic.id;
            resolvedTopicName = topic.name;
          }
        }

        await FlashcardsRepository.setCardTopic({ flashcardId: id, topicId: resolvedTopicId || null, userId, schoolId }, client);
      }

      return {
        ...card,
        topic_id: resolvedTopicId ?? card.topic_id,
        topic_name: resolvedTopicName ?? card.topic_name,
      };
    });
  },

  async deleteCard(id, schoolId) {
    const query = schoolId
      ? `UPDATE flashcards SET is_active = false, updated_at = NOW() WHERE id = $1 AND school_id = $2 RETURNING *`
      : `UPDATE flashcards SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`;
    const params = schoolId ? [id, schoolId] : [id];
    const { rows } = await pool.query(query, params);
    return rows[0];
  },

  // ─────────────────────────────────────────────
  // REVIEW
  // ─────────────────────────────────────────────

  async createReview({ user_id, flashcard_id, result, school_id }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_reviews (user_id, flashcard_id, result, school_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, flashcard_id, result, reviewed_at, school_id`,
      [user_id, flashcard_id, result, school_id]
    );
    return rows[0];
  },

  async getDeckReviewStats(deckId, userId, schoolId) {
    const countQuery = schoolId
      ? `SELECT COUNT(*)::int AS total_cards FROM flashcards WHERE deck_id = $1 AND school_id = $2 AND is_active = true`
      : `SELECT COUNT(*)::int AS total_cards FROM flashcards WHERE deck_id = $1 AND is_active = true`;
    const countParams = schoolId ? [deckId, schoolId] : [deckId];
    const { rows: [{ total_cards }] } = await pool.query(countQuery, countParams);

    const aggQuery = schoolId
      ? `SELECT
           COUNT(*)::int                                                            AS total_reviews,
           COUNT(*) FILTER (WHERE fr.result IN ('good', 'easy'))::int              AS correct,
           COUNT(*) FILTER (WHERE fr.result IN ('again', 'hard'))::int             AS incorrect,
           COUNT(*) FILTER (WHERE fr.result = 'again')::int                        AS again,
           COUNT(*) FILTER (WHERE fr.result = 'hard')::int                         AS hard,
           COUNT(*) FILTER (WHERE fr.result = 'good')::int                         AS good,
           COUNT(*) FILTER (WHERE fr.result = 'easy')::int                         AS easy,
           COUNT(DISTINCT fr.flashcard_id)::int                                    AS reviewed_cards
         FROM flashcard_reviews fr
         JOIN flashcards fc ON fr.flashcard_id = fc.id
         WHERE fc.deck_id = $1 AND fr.user_id = $2 AND fr.school_id = $3 AND fc.school_id = $3`
      : `SELECT
           COUNT(*)::int                                                            AS total_reviews,
           COUNT(*) FILTER (WHERE fr.result IN ('good', 'easy'))::int              AS correct,
           COUNT(*) FILTER (WHERE fr.result IN ('again', 'hard'))::int             AS incorrect,
           COUNT(*) FILTER (WHERE fr.result = 'again')::int                        AS again,
           COUNT(*) FILTER (WHERE fr.result = 'hard')::int                         AS hard,
           COUNT(*) FILTER (WHERE fr.result = 'good')::int                         AS good,
           COUNT(*) FILTER (WHERE fr.result = 'easy')::int                         AS easy,
           COUNT(DISTINCT fr.flashcard_id)::int                                    AS reviewed_cards
         FROM flashcard_reviews fr
         JOIN flashcards fc ON fr.flashcard_id = fc.id
         WHERE fc.deck_id = $1 AND fr.user_id = $2`;
    const aggParams = schoolId ? [deckId, userId, schoolId] : [deckId, userId];
    const { rows: [agg] } = await pool.query(aggQuery, aggParams);

    const cardResultsQuery = schoolId
      ? `SELECT DISTINCT ON (fr.flashcard_id)
                fr.flashcard_id AS card_id,
                fr.result       AS last_result,
                fr.reviewed_at  AS last_reviewed_at
         FROM flashcard_reviews fr
         JOIN flashcards fc ON fr.flashcard_id = fc.id
         WHERE fc.deck_id = $1 AND fr.user_id = $2 AND fr.school_id = $3 AND fc.school_id = $3
         ORDER BY fr.flashcard_id, fr.reviewed_at DESC`
      : `SELECT DISTINCT ON (fr.flashcard_id)
                fr.flashcard_id AS card_id,
                fr.result       AS last_result,
                fr.reviewed_at  AS last_reviewed_at
         FROM flashcard_reviews fr
         JOIN flashcards fc ON fr.flashcard_id = fc.id
         WHERE fc.deck_id = $1 AND fr.user_id = $2
         ORDER BY fr.flashcard_id, fr.reviewed_at DESC`;
    const { rows: cardResults } = await pool.query(cardResultsQuery, aggParams);

    const accuracy = agg.total_reviews > 0
      ? Math.round((agg.correct / agg.total_reviews) * 100)
      : 0;

    return {
      total_cards,
      reviewed_cards: agg.reviewed_cards,
      unreviewed_cards: total_cards - agg.reviewed_cards,
      total_reviews: agg.total_reviews,
      correct: agg.correct,
      incorrect: agg.incorrect,
      again: agg.again,
      hard: agg.hard,
      good: agg.good,
      easy: agg.easy,
      accuracy,
      card_results: cardResults,
    };
  },

  // ─────────────────────────────────────────────
  // SCHEDULE (SRS)
  // ─────────────────────────────────────────────

  async findSchedule(userId, flashcardId, schoolId) {
    const query = schoolId
      ? `SELECT * FROM flashcard_schedules WHERE user_id = $1 AND flashcard_id = $2 AND school_id = $3`
      : `SELECT * FROM flashcard_schedules WHERE user_id = $1 AND flashcard_id = $2`;
    const params = schoolId ? [userId, flashcardId, schoolId] : [userId, flashcardId];
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  async upsertSchedule({ user_id, flashcard_id, ease_factor, interval_days, repetitions, due_date, school_id }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_schedules
         (user_id, flashcard_id, ease_factor, interval_days, repetitions, due_date, last_reviewed_at, school_id)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (user_id, flashcard_id) DO UPDATE SET
         ease_factor      = EXCLUDED.ease_factor,
         interval_days    = EXCLUDED.interval_days,
         repetitions      = EXCLUDED.repetitions,
         due_date         = EXCLUDED.due_date,
         last_reviewed_at = NOW(),
         school_id        = EXCLUDED.school_id
       RETURNING *`,
      [user_id, flashcard_id, ease_factor, interval_days, repetitions, due_date, school_id]
    );
    return rows[0];
  },

  async getStudyQueue(deckId, userId, schoolId) {
    const where = ['fc.deck_id = $1', 'fc.is_active = true'];
    const params = [deckId, userId];

    if (schoolId) {
      params.push(schoolId);
      where.push(`fc.school_id = $3`);
    }

    const { rows } = await pool.query(
      `SELECT
         fc.id,
         fc.type,
         fc.question,
         fc.options,
         fc.answer,
         fc.explanation,
         fc.difficulty,
         fc.position,
         fs.ease_factor,
         fs.interval_days,
         fs.repetitions,
         fs.due_date,
         fs.last_reviewed_at,
         CASE
           WHEN fs.id IS NULL              THEN 'new'
           WHEN fs.due_date <= CURRENT_DATE THEN 'due'
           ELSE                                 'not_due'
         END AS study_status
       FROM flashcards fc
       LEFT JOIN flashcard_schedules fs
         ON fc.id = fs.flashcard_id AND fs.user_id = $2 ${schoolId ? 'AND fs.school_id = $3' : ''}
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE
           WHEN fs.id IS NULL               THEN 2
           WHEN fs.due_date <= CURRENT_DATE  THEN 1
           ELSE                                   3
         END ASC,
         fs.due_date  ASC NULLS LAST,
         fc.position  ASC`,
      params
    );
    return rows;
  },

  // ───────────────────────────────────────────
  // CLASS ACCESS
  // ───────────────────────────────────────────

  async getClassAccess(deckId, schoolId) {
    const where = ['fdca.deck_id = $1'];
    const params = [deckId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fdca.school_id = $2`);
    }

    const { rows } = await pool.query(
      `SELECT
        fdca.class_id,
        c.class_code,
        sem.name AS semester_name
      FROM flashcard_deck_class_access fdca
      JOIN classes c
        ON fdca.class_id = c.id
      LEFT JOIN semesters sem
        ON c.semester_id = sem.id
      WHERE ${where.join(' AND ')}
      ORDER BY c.class_code ASC`,
      params
    );

    return rows;
  },

  async setClassAccess(deckId, classIds, schoolId) {
    return withTransaction(async (client) => {
      if (schoolId) {
        await client.query(
          `DELETE FROM flashcard_deck_class_access WHERE deck_id = $1 AND school_id = $2`,
          [deckId, schoolId]
        );
      } else {
        await client.query(
          `DELETE FROM flashcard_deck_class_access WHERE deck_id = $1`,
          [deckId]
        );
      }

      if (!classIds || classIds.length === 0) {
        return [];
      }

      const values = classIds
        .map((_, i) => `($1, $${i + 3}, $2)`)
        .join(', ');

      const { rows } = await client.query(
        `INSERT INTO flashcard_deck_class_access (deck_id, class_id, school_id)
         VALUES ${values}
         ON CONFLICT (deck_id, class_id) DO NOTHING
         RETURNING class_id`,
        [deckId, schoolId, ...classIds]
      );

      return rows.map((r) => r.class_id);
    });
  },

  async createCardsBatch(cards, { subject_id, userId, school_id } = {}) {
    if (!cards || cards.length === 0) return [];
    return withTransaction(async (client) => {
      const inserted = [];
      for (const card of cards) {
        const { rows } = await client.query(
          `INSERT INTO flashcards (deck_id, type, question, options, answer, explanation, difficulty, position, school_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            card.deck_id,
            card.type || 'multiple_choice',
            card.question,
            JSON.stringify(card.options || []),
            card.answer,
            card.explanation || '',
            card.difficulty || 'medium',
            card.position,
            school_id || card.school_id,
          ]
        );
        const newCard = rows[0];

        if (card.topic_name && subject_id) {
          const topic = await FlashcardsRepository.findOrCreateTopic({
            subjectId: subject_id,
            name: card.topic_name,
            userId,
            schoolId: school_id || card.school_id
          }, client);
          if (topic) {
            await FlashcardsRepository.setCardTopic({
              flashcardId: newCard.id,
              topicId: topic.id,
              userId,
              schoolId: school_id || card.school_id
            }, client);
            newCard.topic_id = topic.id;
            newCard.topic_name = topic.name;
          }
        }

        inserted.push(newCard);
      }
      return inserted;
    });
  },
};

module.exports = FlashcardsRepository;
