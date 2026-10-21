
const { pool } = require('../../config/db.config');

function makeError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

const StudyPlannerSubmissionRepository = {
    // Kiểm tra ngày học đã được nộp chưa.
    async findSubmission(planDayId, studentId) {
        const { rows } = await pool.query(
            `SELECT
         id,
         total_questions AS "totalQuestions",
         correct_answers AS "correctAnswers",
         score_percent AS "scorePercent",
         submitted_at AS "submittedAt"
       FROM study_plan_day_submissions
       WHERE plan_day_id = $1
         AND student_id = $2`,
            [planDayId, studentId]
        );

        return rows[0] || null;
    },


    async findSubmissionResult(planDayId, studentId) {
        const { rows } = await pool.query(
            `SELECT
       s.id AS "submissionId",
       s.plan_day_id AS "planDayId",
       s.total_questions AS "totalQuestions",
       s.correct_answers AS "correctAnswers",
       s.score_percent AS "scorePercent",
       s.submitted_at AS "submittedAt",
       q.id AS "questionId",
       q.question_order AS "questionOrder",
       q.question,
       q.options,
       q.answer AS "correctAnswer",
       q.explanation,
       a.selected_answer AS "selectedAnswer",
       a.is_correct AS "isCorrect"

     FROM study_plan_day_submissions s
     JOIN study_plan_days d
       ON d.id = s.plan_day_id
     JOIN study_plans p
       ON p.id = d.plan_id

     JOIN study_plan_day_answers a
       ON a.submission_id = s.id

     JOIN study_plan_questions q
       ON q.id = a.question_id
       AND q.plan_day_id = d.id

     WHERE s.plan_day_id = $1
       AND s.student_id = $2
       AND p.student_id = $2

     ORDER BY q.question_order`,
            [planDayId, studentId]
        );

        if (!rows.length) return null;

        const first = rows[0];

        return {
            submissionId: first.submissionId,
            planDayId: first.planDayId,
            totalQuestions: first.totalQuestions,
            correctAnswers: first.correctAnswers,
            incorrectAnswers:
                first.totalQuestions - first.correctAnswers,
            scorePercent: Number(first.scorePercent),
            submittedAt: first.submittedAt,

            results: rows.map(row => ({
                questionId: row.questionId,
                questionOrder: row.questionOrder,
                question: row.question,
                options: row.options,
                selectedAnswer: row.selectedAnswer,
                correctAnswer: row.correctAnswer,
                isCorrect: row.isCorrect,
                explanation: row.explanation
            }))
        };
    },


    // Chấm và lưu bài trong cùng một transaction.
    async submitDay(planDayId, studentId, answers) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            // Khóa ngày học để ngăn hai request nộp đồng thời.
            const dayResult = await client.query(
                `SELECT
           spd.id,
           spd.content_status,
           spd.target_questions
         FROM study_plan_days spd
         JOIN study_plans sp ON sp.id = spd.plan_id
         WHERE spd.id = $1
           AND sp.student_id = $2
         FOR UPDATE OF spd`,
                [planDayId, studentId]
            );

            const day = dayResult.rows[0];

            if (!day) {
                throw makeError('PLAN_DAY_NOT_FOUND', 404);
            }

            if (day.content_status !== 'ready') {
                throw makeError('STUDY_DAY_NOT_READY', 409);
            }

            // Chỉ được nộp một lần cho mỗi ngày học.
            const existing = await client.query(
                `SELECT id
         FROM study_plan_day_submissions
         WHERE plan_day_id = $1`,
                [planDayId]
            );

            if (existing.rows.length > 0) {
                throw makeError('STUDY_DAY_ALREADY_SUBMITTED', 409);
            }

            // Đáp án chuẩn chỉ lấy từ database.
            const questionResult = await client.query(
                `SELECT
           id,
           question_order,
           question,
           answer,
           explanation
         FROM study_plan_questions
         WHERE plan_day_id = $1
         ORDER BY question_order`,
                [planDayId]
            );

            const questions = questionResult.rows;

            if (
                questions.length === 0 ||
                questions.length !== day.target_questions
            ) {
                throw makeError('INCOMPLETE_STUDY_DAY_CONTENT', 409);
            }

            if (
                !Array.isArray(answers) ||
                answers.length !== questions.length
            ) {
                throw makeError('INVALID_ANSWER_COUNT', 400);
            }

            const answerMap = new Map();

            for (const item of answers) {
                if (
                    !item ||
                    typeof item.questionId !== 'string' ||
                    !['A', 'B', 'C', 'D'].includes(item.selectedAnswer)
                ) {
                    throw makeError('INVALID_ANSWER_FORMAT', 400);
                }

                if (answerMap.has(item.questionId)) {
                    throw makeError('DUPLICATE_ANSWER', 400);
                }

                answerMap.set(item.questionId, item.selectedAnswer);
            }

            // Đảm bảo tất cả câu trả lời thuộc đúng ngày học.
            const results = questions.map(question => {
                const selectedAnswer = answerMap.get(question.id);

                if (!selectedAnswer) {
                    throw makeError('INVALID_QUESTION_ID', 400);
                }

                const correctAnswer =
                    String(question.answer).trim().toUpperCase();

                if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
                    throw makeError('INVALID_STORED_ANSWER', 409);
                }

                return {
                    questionId: question.id,
                    questionOrder: question.question_order,
                    question: question.question,
                    selectedAnswer,
                    correctAnswer,
                    isCorrect: selectedAnswer === correctAnswer,
                    explanation: question.explanation
                };
            });

            const correctAnswers = results.filter(
                item => item.isCorrect
            ).length;

            const totalQuestions = questions.length;

            const scorePercent = Math.round(
                (correctAnswers / totalQuestions) * 10000
            ) / 100;

            // Lưu tổng kết.
            const submissionResult = await client.query(
                `INSERT INTO study_plan_day_submissions (
           plan_day_id,
           student_id,
           total_questions,
           correct_answers,
           score_percent
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, submitted_at`,
                [
                    planDayId,
                    studentId,
                    totalQuestions,
                    correctAnswers,
                    scorePercent
                ]
            );

            const submission = submissionResult.rows[0];

            // Lưu chi tiết từng đáp án.
            for (const result of results) {
                await client.query(
                    `INSERT INTO study_plan_day_answers (
             submission_id,
             question_id,
             selected_answer,
             is_correct
           )
           VALUES ($1, $2, $3, $4)`,
                    [
                        submission.id,
                        result.questionId,
                        result.selectedAnswer,
                        result.isCorrect
                    ]
                );
            }

            await client.query('COMMIT');

            // Chỉ trả đáp án đúng sau khi đã nộp thành công.
            return {
                submissionId: submission.id,
                planDayId,
                totalQuestions,
                correctAnswers,
                incorrectAnswers: totalQuestions - correctAnswers,
                scorePercent,
                submittedAt: submission.submitted_at,
                results
            };

        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
};

module.exports = StudyPlannerSubmissionRepository;
