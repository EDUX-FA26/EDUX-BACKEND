const { pool } = require('../../config/db.config');

const StudyPlannerContentRepository = {
    // Lấy ngày học, chỉ khi kế hoạch thuộc sinh viên đăng nhập
    async findDayForStudent(planDayId, studentId) {
        const { rows } = await pool.query(
            `SELECT
         spd.id,
         spd.plan_id AS "planId",
         spd.day_number AS "day",
         spd.topic_id AS "topicId",
         t.name AS "topicName",
         t.description AS "topicDescription",
         spd.activity,
         spd.target_questions AS "targetQuestions",
         spd.content_status AS "contentStatus",
         spd.reason,
         sp.subject_id AS "subjectId"
       FROM study_plan_days spd
       JOIN study_plans sp ON sp.id = spd.plan_id
       JOIN topics t ON t.id = spd.topic_id
       WHERE spd.id = $1
         AND sp.student_id = $2`,
            [planDayId, studentId]
        );

        return rows[0] || null;
    },

    // Tìm câu hỏi làm nguồn cho ngày đánh giá ban đầu
    async findDiagnosticSources(
        studentId,
        subjectId,
        topicId,
        schoolId = null
    ) {
        const schoolFilter = schoolId ? `AND fd.school_id = $4 AND t.school_id = $4 AND fct.school_id = $4 AND fc.school_id = $4` : '';
        const classSchoolFilter = schoolId ? `AND c.school_id = $4` : '';
        const params = schoolId
            ? [studentId, subjectId, topicId, schoolId]
            : [studentId, subjectId, topicId];
        const { rows } = await pool.query(
            `SELECT DISTINCT
          fc.id AS "flashcardId",
          fc.question
        FROM flashcards fc
        JOIN flashcard_decks fd
          ON fd.id = fc.deck_id
        JOIN flashcard_topics fct
          ON fct.flashcard_id = fc.id
        JOIN topics t
          ON t.id = fct.topic_id
        WHERE fd.subject_id = $2
          AND fct.topic_id = $3
          AND t.subject_id = $2
          AND t.status = 'approved'
          AND (t.review_required = false OR t.review_required IS NULL)
          AND t.parent_id IS NULL
          AND t.is_active = true
          AND fct.review_status = 'approved'
          AND fc.is_active = true
          AND fd.is_active = true
          AND fc.type = 'multiple_choice'
          ${schoolFilter}
          AND (
            fd.is_public = true
            OR fd.class_id IN (
              SELECT cm.class_id
              FROM class_members cm
              JOIN classes c ON c.id = cm.class_id
              WHERE cm.student_id = $1
                AND cm.status = 'active'
                ${classSchoolFilter}
            )
            OR fd.id IN (
              SELECT fdca.deck_id
              FROM flashcard_deck_class_access fdca
              JOIN class_members cm
                ON cm.class_id = fdca.class_id
              JOIN classes c ON c.id = cm.class_id
              WHERE cm.student_id = $1
                AND cm.status = 'active'
                ${classSchoolFilter}
            )
          )
        ORDER BY fc.question, fc.id
        LIMIT 10`,
            params
        );

        return rows;
    },

    // Tìm thêm câu hỏi trắc nghiệm hợp lệ trong cùng Subject để bù đủ 5 câu
    async findBackupSubjectSources(
        studentId,
        subjectId,
        schoolId = null,
        excludeCardIds = [],
        limit = 10
    ) {
        const schoolFilter = schoolId ? `AND fd.school_id = $3 AND fc.school_id = $3` : '';
        const classSchoolFilter = schoolId ? `AND c.school_id = $3` : '';
        const params = schoolId
            ? [studentId, subjectId, schoolId]
            : [studentId, subjectId];

        let excludeFilter = '';
        if (Array.isArray(excludeCardIds) && excludeCardIds.length > 0) {
            params.push(excludeCardIds);
            excludeFilter = `AND fc.id != ALL($${params.length})`;
        }

        params.push(limit);
        const limitParam = `$${params.length}`;

        const { rows } = await pool.query(
            `SELECT DISTINCT
          fc.id AS "flashcardId",
          fc.question
        FROM flashcards fc
        JOIN flashcard_decks fd
          ON fd.id = fc.deck_id
        WHERE fd.subject_id = $2
          AND fc.is_active = true
          AND fd.is_active = true
          AND fc.type = 'multiple_choice'
          ${excludeFilter}
          ${schoolFilter}
          AND (
            fd.is_public = true
            OR fd.class_id IN (
              SELECT cm.class_id
              FROM class_members cm
              JOIN classes c ON c.id = cm.class_id
              WHERE cm.student_id = $1
                AND cm.status = 'active'
                ${classSchoolFilter}
            )
            OR fd.id IN (
              SELECT fdca.deck_id
              FROM flashcard_deck_class_access fdca
              JOIN class_members cm
                ON cm.class_id = fdca.class_id
              JOIN classes c ON c.id = cm.class_id
              WHERE cm.student_id = $1
                AND cm.status = 'active'
                ${classSchoolFilter}
            )
          )
        ORDER BY fc.question, fc.id
        LIMIT ${limitParam}`,
            params
        );

        return rows;
    },

    // Trả câu hỏi cho sinh viên, không lộ đáp án
    async findPublicDayQuestions(planDayId) {
        const { rows } = await pool.query(
            `SELECT
         id,
         question_order AS "questionOrder",
         question,
         options,
         type,
         difficulty
       FROM study_plan_questions
       WHERE plan_day_id = $1
       ORDER BY question_order`,
            [planDayId]
        );

        return rows;
    },

    async markDayUnavailable(planDayId, studentId) {
        const { rows } = await pool.query(
            `UPDATE study_plan_days spd
      SET content_status = 'unavailable'
      FROM study_plans sp
      WHERE spd.plan_id = sp.id
        AND spd.id = $1
        AND sp.student_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM study_plan_day_submissions sub
          WHERE sub.plan_day_id = spd.id
        )
      RETURNING spd.id`,
            [planDayId, studentId]
        );

        return rows.length > 0;
    },

    // Lưu cả bộ câu hỏi trong một transaction
    async saveGeneratedQuestions({
        planDayId,
        studentId,
        sourceFlashcardId,
        questions,
        schoolId = null,
    }) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const locked = await client.query(
                `SELECT spd.id, spd.content_status
          FROM study_plan_days spd
          JOIN study_plans sp ON sp.id = spd.plan_id
          WHERE spd.id = $1
            AND sp.student_id = $2
          FOR UPDATE OF spd`,
                [planDayId, studentId]
            );

            const day = locked.rows[0];

            if (!day) {
                const error = new Error('PLAN_DAY_NOT_FOUND');
                error.status = 404;
                throw error;
            }

            // Request khác đã tạo xong trước: không lưu trùng nếu đã có câu hỏi
            if (day.content_status === 'ready') {
                const existing = await client.query(
                    `SELECT id FROM study_plan_questions WHERE plan_day_id = $1 LIMIT 1`,
                    [planDayId]
                );
                if (existing.rows.length > 0) {
                    await client.query('COMMIT');
                    return { created: false };
                }
            }

            for (let i = 0; i < questions.length; i++) {
                const question = questions[i];

                if (schoolId) {
                    await client.query(
                        `INSERT INTO study_plan_questions (
              plan_day_id,
              source_flashcard_id,
              question_order,
              question,
              answer,
              explanation,
              options,
              type,
              difficulty,
              generation_source,
              school_id
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7::jsonb, $8, $9, 'ai', $10
            )`,
                        [
                            planDayId,
                            sourceFlashcardId,
                            i + 1,
                            question.question,
                            question.answer,
                            question.explanation,
                            JSON.stringify(question.options),
                            question.type,
                            question.difficulty,
                            schoolId,
                        ]
                    );
                } else {
                    await client.query(
                        `INSERT INTO study_plan_questions (
              plan_day_id,
              source_flashcard_id,
              question_order,
              question,
              answer,
              explanation,
              options,
              type,
              difficulty,
              generation_source
            )
            VALUES (
              $1, $2, $3, $4, $5, $6,
              $7::jsonb, $8, $9, 'ai'
            )`,
                        [
                            planDayId,
                            sourceFlashcardId,
                            i + 1,
                            question.question,
                            question.answer,
                            question.explanation,
                            JSON.stringify(question.options),
                            question.type,
                            question.difficulty,
                        ]
                    );
                }
            }

            await client.query(
                `UPDATE study_plan_days
          SET content_status = 'ready',
              target_questions = $2
          WHERE id = $1`,
                [planDayId, questions.length]
            );

            await client.query('COMMIT');

            return { created: true };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
};

module.exports = StudyPlannerContentRepository;
