const { pool } = require('../../config/db.config');

const LearningRepository = {
  /** Verify that a student is actively enrolled in at least one class of a subject within school. */
  async isStudentActiveInSubject(studentId, subjectId, schoolId) {
    const where = [
      'cm.student_id = $1',
      'c.subject_id = $2',
      `cm.status = 'active'`,
      'c.is_active = true',
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`c.school_id = $3`);
    }

    const { rows } = await pool.query(
      `SELECT 1
       FROM class_members cm
       JOIN classes c ON c.id = cm.class_id
       WHERE ${where.join(' AND ')}
       LIMIT 1`,
      params
    );
    return rows.length > 0;
  },

  async findAssignmentGradesBySubject(studentId, subjectId, schoolId) {
    const where = [
      'g.student_id = $1',
      'c.subject_id = $2',
      'sub.student_id = $1',
      `sub.status = 'graded'`,
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`g.school_id = $3`);
      where.push(`c.school_id = $3`);
    }

    const { rows } = await pool.query(
      `SELECT g.id AS grade_id, g.assignment_id, a.title AS assignment_title,
              g.score, g.max_score, g.feedback, g.graded_at
       FROM grades g
       JOIN submissions sub ON sub.id = g.submission_id
       JOIN assignments a ON a.id = g.assignment_id
       JOIN classes c ON c.id = a.class_id
       WHERE ${where.join(' AND ')}
       ORDER BY g.graded_at DESC NULLS LAST, g.created_at DESC`,
      params
    );
    return rows;
  },

  async findSubmittedFlashcardTestsBySubject(studentId, subjectId, limit, schoolId) {
    const where = [
      'ft.user_id = $1',
      'fd.subject_id = $2',
      `ft.status = 'submitted'`,
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ft.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
    }

    if (schoolId) {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }

    params.push(limit);
    const limitIdx = params.length;

    const { rows } = await pool.query(
      `SELECT ft.id AS test_id, ft.deck_id, fd.title AS deck_title, ft.total_questions,
              ft.score, ft.started_at, ft.submitted_at,
              COUNT(fta.id)::int AS answered_count,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = true)::int AS correct_count,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = false)::int AS incorrect_count
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON fd.id = ft.deck_id
       LEFT JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       WHERE ${where.join(' AND ')}
       GROUP BY ft.id, fd.id
       ORDER BY ft.submitted_at DESC NULLS LAST, ft.started_at DESC
       LIMIT $${limitIdx}`,
      params
    );
    return rows;
  },

  async getFlashcardTestAnswerSummaryBySubject(studentId, subjectId, schoolId) {
    const where = [
      'ft.user_id = $1',
      'fd.subject_id = $2',
      `ft.status = 'submitted'`,
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ft.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
    }

    if (schoolId) {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }

    const { rows } = await pool.query(
      `SELECT COUNT(fta.id)::int AS total_answers,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = true)::int AS correct_answers,
              COUNT(fta.id) FILTER (WHERE fta.is_correct = false)::int AS incorrect_answers,
              COUNT(DISTINCT fta.flashcard_id)::int AS distinct_flashcards
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON fd.id = ft.deck_id
       JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       WHERE ${where.join(' AND ')}`,
      params
    );
    return rows[0];
  },

  async findWrongFlashcardTestAnswersBySubject(studentId, subjectId, limit, schoolId) {
    const where = [
      'ft.user_id = $1',
      'fd.subject_id = $2',
      `ft.status = 'submitted'`,
      'fta.is_correct = false',
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ft.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
    }

    if (schoolId) {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }

    params.push(limit);
    const limitIdx = params.length;

    const { rows } = await pool.query(
      `SELECT ft.id AS test_id, ft.deck_id, fd.title AS deck_title, ft.submitted_at,
              fta.flashcard_id, fta.student_answer, fta.score,
              fc.question, fc.type AS question_type, fc.options,
              fc.answer AS correct_answer, fc.explanation
       FROM flashcard_tests ft
       JOIN flashcard_decks fd ON fd.id = ft.deck_id
       JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       JOIN flashcards fc ON fc.id = fta.flashcard_id
       WHERE ${where.join(' AND ')}
       ORDER BY ft.submitted_at DESC NULLS LAST, ft.started_at DESC
       LIMIT $${limitIdx}`,
      params
    );
    return rows;
  },

  async getFlashcardReviewSummaryBySubject(studentId, subjectId, schoolId) {
    const where = ['fr.user_id = $1', 'fd.subject_id = $2'];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fr.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }

    const { rows } = await pool.query(
      `SELECT COUNT(fr.id)::int AS total_reviews,
              COUNT(fr.id) FILTER (WHERE fr.result = 'again')::int AS again,
              COUNT(fr.id) FILTER (WHERE fr.result = 'hard')::int AS hard,
              COUNT(fr.id) FILTER (WHERE fr.result = 'good')::int AS good,
              COUNT(fr.id) FILTER (WHERE fr.result = 'easy')::int AS easy
       FROM flashcard_reviews fr
       JOIN flashcards fc ON fc.id = fr.flashcard_id
       JOIN flashcard_decks fd ON fd.id = fc.deck_id
       WHERE ${where.join(' AND ')}`,
      params
    );
    return rows[0];
  },

  async findFlashcardReviewHistoryBySubject(studentId, subjectId, limit, schoolId) {
    const where = ['fr.user_id = $1', 'fd.subject_id = $2'];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fr.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }
    params.push(limit);
    const limitIdx = params.length;

    const { rows } = await pool.query(
      `SELECT fr.id AS review_id, fr.flashcard_id, fr.result, fr.reviewed_at,
              fc.question, fd.id AS deck_id, fd.title AS deck_title
       FROM flashcard_reviews fr
       JOIN flashcards fc ON fc.id = fr.flashcard_id
       JOIN flashcard_decks fd ON fd.id = fc.deck_id
       WHERE ${where.join(' AND ')}
       ORDER BY fr.reviewed_at DESC
       LIMIT $${limitIdx}`,
      params
    );
    return rows;
  },

  async findDueFlashcardsBySubject(studentId, subjectId, schoolId) {
    const where = [
      'fs.user_id = $1',
      'fd.subject_id = $2',
      `fs.due_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fs.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }

    const { rows } = await pool.query(
      `SELECT fc.id AS flashcard_id, fc.type AS question_type, fc.question, fc.options,
              fc.difficulty, fc.position, fd.id AS deck_id, fd.title AS deck_title,
              fs.due_date, fs.interval_days, fs.repetitions, fs.ease_factor, fs.last_reviewed_at
       FROM flashcard_schedules fs
       JOIN flashcards fc ON fc.id = fs.flashcard_id AND fc.is_active = true
       JOIN flashcard_decks fd ON fd.id = fc.deck_id AND fd.is_active = true
       WHERE ${where.join(' AND ')}
       ORDER BY fs.due_date ASC, fc.position ASC`,
      params
    );
    return rows;
  },

  async findActiveTopicsBySubject(subjectId, schoolId) {
    const where = ['subject_id = $1', 'is_active = true'];
    const params = [subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`school_id = $2`);
    }
    const { rows } = await pool.query(
      `SELECT id, name, parent_id
       FROM topics WHERE ${where.join(' AND ')}
       ORDER BY name ASC`,
      params
    );
    return rows;
  },

  async findSubmittedMultipleChoiceTopicAnswers(studentId, subjectId, schoolId) {
    const where = [
      'ft.user_id = $1',
      `ft.status = 'submitted'`,
      'fd.subject_id = $2',
      `fc.type = 'multiple_choice'`,
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ft.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
      where.push(`t.school_id = $${params.length}`);
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (
          SELECT fdca.deck_id FROM flashcard_deck_class_access fdca
          JOIN class_members cm ON cm.class_id = fdca.class_id
          JOIN classes c ON c.id = cm.class_id
          WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length}
        )
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (
          SELECT fdca.deck_id FROM flashcard_deck_class_access fdca
          JOIN class_members cm ON cm.class_id = fdca.class_id
          WHERE cm.student_id = $1 AND cm.status = 'active'
        )
      )`);
    }

    const { rows } = await pool.query(
      `SELECT fct.topic_id, fta.id AS answer_id, fta.flashcard_id, fta.is_correct, ft.submitted_at
       FROM flashcard_tests ft
       JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       JOIN flashcards fc ON fc.id = fta.flashcard_id AND fc.is_active = true
       JOIN flashcard_decks fd ON fd.id = fc.deck_id AND fd.is_active = true
       JOIN flashcard_topics fct ON fct.flashcard_id = fc.id AND fct.review_status = 'approved'
       JOIN topics t ON t.id = fct.topic_id AND t.subject_id = fd.subject_id AND t.is_active = true
       WHERE ${where.join(' AND ')}`,
      params
    );
    return rows;
  },

  async findTopicAttemptBreakdownBySubject(studentId, subjectId, schoolId) {
    const where = [
      'ft.user_id = $1',
      `ft.status = 'submitted'`,
      'fd.subject_id = $2',
      `fc.type = 'multiple_choice'`,
    ];
    const params = [studentId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ft.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
      where.push(`t.school_id = $${params.length}`);
    }

    if (schoolId) {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }

    const { rows } = await pool.query(
      `SELECT t.id AS topic_id, t.name AS topic_name, fta.flashcard_id, fta.is_correct
       FROM flashcard_tests ft
       JOIN flashcard_test_answers fta ON fta.test_id = ft.id
       JOIN flashcards fc ON fc.id = fta.flashcard_id
       JOIN flashcard_decks fd ON fd.id = fc.deck_id
       JOIN flashcard_topics fct ON fct.flashcard_id = fc.id AND fct.review_status = 'approved'
       JOIN topics t ON t.id = fct.topic_id AND t.subject_id = fd.subject_id AND t.is_active = true
       WHERE ${where.join(' AND ')}`,
      params
    );
    return rows;
  },

  async findLatestIncorrectFlashcardsByTopic(studentId, subjectId, topicIds, schoolId) {
    if (!topicIds.length) return [];

    const where = [
      'ft.user_id = $1',
      `ft.status = 'submitted'`,
      'fd.subject_id = $2',
      `fc.type = 'multiple_choice'`,
      'fct.topic_id = ANY($3::uuid[])',
    ];
    const params = [studentId, subjectId, topicIds];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ft.school_id = $${params.length}`);
      where.push(`fd.school_id = $${params.length}`);
      where.push(`t.school_id = $${params.length}`);
    }

    if (schoolId) {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND c.school_id = $${params.length})
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id JOIN classes c ON c.id = cm.class_id WHERE cm.student_id = $1 AND cm.status = 'active' AND fdca.school_id = $${params.length} AND c.school_id = $${params.length})
      )`);
    } else {
      where.push(`(
        fd.is_public = true
        OR fd.class_id IN (SELECT class_id FROM class_members WHERE student_id = $1 AND status = 'active')
        OR fd.id IN (SELECT fdca.deck_id FROM flashcard_deck_class_access fdca JOIN class_members cm ON cm.class_id = fdca.class_id WHERE cm.student_id = $1 AND cm.status = 'active')
      )`);
    }

    const { rows } = await pool.query(
      `WITH ranked_answers AS (
         SELECT
           fct.topic_id,
           fta.flashcard_id,
           fta.is_correct,
           ft.submitted_at,
           ROW_NUMBER() OVER (
             PARTITION BY fct.topic_id, fta.flashcard_id
             ORDER BY ft.submitted_at DESC NULLS LAST, fta.id DESC
           ) AS attempt_rank
         FROM flashcard_tests ft
         JOIN flashcard_test_answers fta ON fta.test_id = ft.id
         JOIN flashcards fc ON fc.id = fta.flashcard_id AND fc.is_active = true
         JOIN flashcard_decks fd ON fd.id = fc.deck_id AND fd.is_active = true
         JOIN flashcard_topics fct ON fct.flashcard_id = fc.id AND fct.review_status = 'approved'
         JOIN topics t ON t.id = fct.topic_id AND t.subject_id = fd.subject_id AND t.is_active = true
         WHERE ${where.join(' AND ')}
       ),
       incorrect AS (
         SELECT
           topic_id,
           flashcard_id,
           submitted_at,
           ROW_NUMBER() OVER (
             PARTITION BY topic_id
             ORDER BY submitted_at DESC NULLS LAST, flashcard_id
           ) AS question_rank
         FROM ranked_answers
         WHERE attempt_rank = 1 AND is_correct = false
       )
       SELECT
         i.topic_id AS "topicId",
         i.flashcard_id AS "flashcardId",
         fc.question,
         fc.difficulty,
         i.submitted_at AS "lastSubmittedAt"
       FROM incorrect i
       JOIN flashcards fc ON fc.id = i.flashcard_id
       WHERE i.question_rank <= 5
       ORDER BY i.topic_id, i.question_rank`,
      params
    );
    return rows;
  },

  /**
   * Lấy 1 streak của user theo subject (kèm thông tin subject)
   */
  async findStreakByUserAndSubject(userId, subjectId, schoolId, client = null) {
    const q = client || pool;
    const where = ['ss.user_id = $1', 'ss.subject_id = $2'];
    const params = [userId, subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ss.school_id = $3`);
    }

    const query = `
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ${where.join(' AND ')}
    `;
    const { rows } = await q.query(query, params);
    return rows[0] || null;
  },

  /**
   * Lấy tất cả streak của user trong trường hiện tại
   */
  async findAllStreaksByUser(userId, schoolId) {
    const where = ['ss.user_id = $1', 'ss.is_active = true'];
    const params = [userId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`ss.school_id = $2`);
    }

    const query = `
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ${where.join(' AND ')}
      ORDER BY s.name ASC
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  /**
   * Tạo bản ghi streak khởi tạo nếu chưa tồn tại
   */
  async getOrCreateStreakRow(userId, subjectId, schoolId, client = null) {
    const q = client || pool;
    if (schoolId) {
      const insertQuery = `
        INSERT INTO subject_streaks (user_id, subject_id, school_id, current_streak, longest_streak, recovery_used)
        VALUES ($1, $2, $3, 0, 0, 0)
        ON CONFLICT (school_id, user_id, subject_id) DO NOTHING
        RETURNING *
      `;
      await q.query(insertQuery, [userId, subjectId, schoolId]);

      const selectQuery = `
        SELECT ss.*, s.name AS subject_name, s.code AS subject_code
        FROM subject_streaks ss
        JOIN subjects s ON ss.subject_id = s.id
        WHERE ss.user_id = $1 AND ss.subject_id = $2 AND ss.school_id = $3
      `;
      const { rows } = await q.query(selectQuery, [userId, subjectId, schoolId]);
      return rows[0];
    }

    const insertQuery = `
      INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, recovery_used)
      VALUES ($1, $2, 0, 0, 0)
      ON CONFLICT (user_id, subject_id) DO NOTHING
      RETURNING *
    `;
    await q.query(insertQuery, [userId, subjectId]);

    const selectQuery = `
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ss.user_id = $1 AND ss.subject_id = $2
    `;
    const { rows } = await q.query(selectQuery, [userId, subjectId]);
    return rows[0];
  },

  /**
   * Khóa row streak phục vụ transaction (chống concurrency race conditions)
   */
  async lockStreakForUpdate(userId, subjectId, schoolId, client) {
    if (schoolId) {
      await client.query(`
        INSERT INTO subject_streaks (user_id, subject_id, school_id, current_streak, longest_streak, recovery_used)
        VALUES ($1, $2, $3, 0, 0, 0)
        ON CONFLICT (school_id, user_id, subject_id) DO NOTHING
      `, [userId, subjectId, schoolId]);

      const query = `
        SELECT ss.*, s.name AS subject_name, s.code AS subject_code
        FROM subject_streaks ss
        JOIN subjects s ON ss.subject_id = s.id
        WHERE ss.user_id = $1 AND ss.subject_id = $2 AND ss.school_id = $3
        FOR UPDATE
      `;
      const { rows } = await client.query(query, [userId, subjectId, schoolId]);
      return rows[0];
    }

    await client.query(`
      INSERT INTO subject_streaks (user_id, subject_id, current_streak, longest_streak, recovery_used)
      VALUES ($1, $2, 0, 0, 0)
      ON CONFLICT (user_id, subject_id) DO NOTHING
    `, [userId, subjectId]);

    const query = `
      SELECT ss.*, s.name AS subject_name, s.code AS subject_code
      FROM subject_streaks ss
      JOIN subjects s ON ss.subject_id = s.id
      WHERE ss.user_id = $1 AND ss.subject_id = $2
      FOR UPDATE
    `;
    const { rows } = await client.query(query, [userId, subjectId]);
    return rows[0];
  },

  async hasActivityToday(userId, subjectId, activityDate, schoolId, client = null) {
    const q = client || pool;
    const where = [
      'user_id = $1',
      'subject_id = $2',
      'activity_date = $3',
    ];
    const params = [userId, subjectId, activityDate];
    if (schoolId) {
      params.push(schoolId);
      where.push(`school_id = $4`);
    }

    const query = `
      SELECT 1
      FROM subject_streak_activities
      WHERE ${where.join(' AND ')}
      LIMIT 1
    `;
    const { rows } = await q.query(query, params);
    return rows.length > 0;
  },

  async insertActivity(userId, subjectId, deckId, activityDate, activityType, schoolId, client) {
    const q = client || pool;
    if (schoolId) {
      const query = `
        INSERT INTO subject_streak_activities
          (user_id, subject_id, flashcard_deck_id, activity_date, activity_type, school_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (school_id, user_id, subject_id, activity_date) DO NOTHING
        RETURNING *
      `;
      const { rows } = await q.query(query, [
        userId,
        subjectId,
        deckId || null,
        activityDate,
        activityType || 'flashcard_deck_completed',
        schoolId,
      ]);
      return rows[0] || null;
    }

    const query = `
      INSERT INTO subject_streak_activities
        (user_id, subject_id, flashcard_deck_id, activity_date, activity_type)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, subject_id, flashcard_deck_id, activity_date) DO NOTHING
      RETURNING *
    `;
    const { rows } = await q.query(query, [
      userId,
      subjectId,
      deckId || null,
      activityDate,
      activityType || 'flashcard_deck_completed',
    ]);
    return rows[0] || null;
  },

  async updateStreak(userId, subjectId, data, schoolId, client = null) {
    const q = client || pool;
    const fields = [];
    const values = [];
    let idx = 1;

    const allowed = [
      'current_streak',
      'longest_streak',
      'last_activity_date',
      'recovery_used',
      'recovery_month',
      'is_active',
      'streak_lost_at',
    ];

    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(data[key]);
      }
    }

    if (fields.length === 0) return null;

    fields.push(`updated_at = NOW()`);
    values.push(userId, subjectId);
    const uIdx = idx++;
    const sIdx = idx++;

    let whereClause = `WHERE user_id = $${uIdx} AND subject_id = $${sIdx}`;
    if (schoolId) {
      values.push(schoolId);
      whereClause += ` AND school_id = $${idx++}`;
    }

    const query = `
      UPDATE subject_streaks
      SET ${fields.join(', ')}
      ${whereClause}
      RETURNING *
    `;
    const { rows } = await q.query(query, values);
    return rows[0];
  },

  async findActivities(userId, { page = 1, limit = 20, subjectId = null, schoolId = null } = {}) {
    page = Number(page) || 1;
    limit = Number(limit) || 20;
    const offset = (page - 1) * limit;

    const params = [userId];
    const where = [`ssa.user_id = $1`];

    if (schoolId) {
      params.push(schoolId);
      where.push(`ssa.school_id = $${params.length}`);
    }

    if (subjectId) {
      params.push(subjectId);
      where.push(`ssa.subject_id = $${params.length}`);
    }

    const whereStr = `WHERE ${where.join(' AND ')}`;

    const countQuery = `
      SELECT COUNT(*) FROM subject_streak_activities ssa
      ${whereStr}
    `;
    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count, 10);

    params.push(limit, offset);
    const dataQuery = `
      SELECT
        ssa.id,
        ssa.user_id,
        ssa.subject_id,
        ssa.flashcard_deck_id,
        TO_CHAR(ssa.activity_date, 'YYYY-MM-DD') AS activity_date,
        ssa.activity_type,
        ssa.created_at,
        ssa.school_id,
        s.name AS subject_name,
        s.code AS subject_code,
        fd.title AS deck_title,
        ROUND((latest_test.score * 10)::numeric, 1) AS flashcard_score,
        latest_test.total_questions AS flashcard_total_questions,
        latest_test.submitted_at AS flashcard_submitted_at
      FROM subject_streak_activities ssa
      JOIN subjects s ON ssa.subject_id = s.id
      LEFT JOIN flashcard_decks fd ON ssa.flashcard_deck_id = fd.id
      LEFT JOIN LATERAL (
        SELECT ft.score, ft.total_questions, ft.submitted_at
        FROM flashcard_tests ft
        WHERE ft.user_id = ssa.user_id
          AND ft.deck_id = ssa.flashcard_deck_id
          AND ft.status = 'submitted'
          ${schoolId ? `AND ft.school_id = '${schoolId}'` : ''}
        ORDER BY ft.submitted_at DESC NULLS LAST
        LIMIT 1
      ) latest_test ON true
      ${whereStr}
      ORDER BY ssa.activity_date DESC, ssa.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await pool.query(dataQuery, params);
    return { data: rows, total, page, limit };
  },

  async findHeatmap(userId, { subjectId = null, startDate = null, endDate = null, year = null, schoolId = null } = {}) {
    const params = [userId];
    const where = [
      `ssa.user_id = $1`,
      `ssa.activity_type IN ('flashcard_deck_completed', 'flashcard_test_passed')`,
    ];

    if (schoolId) {
      params.push(schoolId);
      where.push(`ssa.school_id = $${params.length}`);
    }

    if (subjectId) {
      params.push(subjectId);
      where.push(`ssa.subject_id = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      where.push(`ssa.activity_date >= $${params.length}::date`);
    }

    if (endDate) {
      params.push(endDate);
      where.push(`ssa.activity_date <= $${params.length}::date`);
    }

    if (year) {
      params.push(year);
      where.push(`EXTRACT(YEAR FROM ssa.activity_date) = $${params.length}`);
    }

    const whereStr = `WHERE ${where.join(' AND ')}`;

    const query = `
      SELECT
        TO_CHAR(ssa.activity_date, 'YYYY-MM-DD') AS date,
        ssa.subject_id AS "subjectId",
        s.name AS "subjectName",
        COUNT(DISTINCT ssa.flashcard_deck_id)::int AS count,
        true AS completed
      FROM subject_streak_activities ssa
      JOIN subjects s ON ssa.subject_id = s.id
      ${whereStr}
      GROUP BY ssa.activity_date, ssa.subject_id, s.name
      ORDER BY ssa.activity_date ASC
    `;
    const { rows } = await pool.query(query, params);
    return rows;
  },

  async findDeckById(deckId, schoolId) {
    const where = ['fd.id = $1'];
    const params = [deckId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`fd.school_id = $2`);
    }

    const query = `
      SELECT fd.*, s.name AS subject_name, s.code AS subject_code
      FROM flashcard_decks fd
      JOIN subjects s ON fd.subject_id = s.id
      WHERE ${where.join(' AND ')}
    `;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  async findSubjectById(subjectId, schoolId) {
    const where = ['id = $1', 'is_active = true'];
    const params = [subjectId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`school_id = $2`);
    }
    const query = `SELECT id, name, code FROM subjects WHERE ${where.join(' AND ')}`;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  async isUserInClass(classId, userId, schoolId) {
    const where = [
      'cm.class_id = $1',
      'cm.student_id = $2',
      `cm.status = 'active'`,
    ];
    const params = [classId, userId];
    if (schoolId) {
      params.push(schoolId);
      where.push(`c.school_id = $3`);
    }

    const query = schoolId
      ? `SELECT 1 FROM class_members cm JOIN classes c ON c.id = cm.class_id WHERE ${where.join(' AND ')}`
      : `SELECT 1 FROM class_members cm WHERE ${where.join(' AND ')}`;
    const { rows } = await pool.query(query, params);
    return rows.length > 0;
  },
};

module.exports = LearningRepository;
