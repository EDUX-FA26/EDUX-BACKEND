
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
         spd.activity,
         spd.target_questions AS "targetQuestions",
         spd.content_status AS "contentStatus",
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
        topicId
    ) {
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
         AND t.is_active = true
         AND fct.review_status = 'approved'
         AND fc.is_active = true
         AND fd.is_active = true
         AND fc.type = 'multiple_choice'
         AND (
           fd.is_public = true
           OR fd.class_id IN (
             SELECT class_id
             FROM class_members
             WHERE student_id = $1
               AND status = 'active'
           )
           OR fd.id IN (
             SELECT fdca.deck_id
             FROM flashcard_deck_class_access fdca
             JOIN class_members cm
               ON cm.class_id = fdca.class_id
             WHERE cm.student_id = $1
               AND cm.status = 'active'
           )
         )
       ORDER BY fc.question, fc.id
       LIMIT 10`,
            [studentId, subjectId, topicId]
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
       AND spd.content_status <> 'ready'
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
        questions
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

            // Request khác đã tạo xong trước: không lưu trùng
            if (day.content_status === 'ready') {
                await client.query('COMMIT');
                return { created: false };
            }

            for (let i = 0; i < questions.length; i++) {
                const question = questions[i];

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
                        question.difficulty
                    ]
                );
            }

            await client.query(
                `UPDATE study_plan_days
         SET content_status = 'ready'
         WHERE id = $1`,
                [planDayId]
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
