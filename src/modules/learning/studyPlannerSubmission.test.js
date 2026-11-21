const SubmissionRepository = require('./studyPlannerSubmission.repository');
const { pool } = require('../../config/db.config');

describe('StudyPlannerSubmissionRepository & Fallback Unit Tests', () => {
    const dummyStudentId = '11111111-1111-4111-8111-111111111111';
    const dummyPlanDayId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const dummySchoolId = '33333333-3333-4333-8333-333333333333';

    const mockQuestions = [
        { id: 'q1', question_order: 1, question: 'Question 1', answer: 'A', explanation: 'Exp 1' },
        { id: 'q2', question_order: 2, question: 'Question 2', answer: 'B', explanation: 'Exp 2' },
        { id: 'q3', question_order: 3, question: 'Question 3', answer: 'C', explanation: 'Exp 3' },
        { id: 'q4', question_order: 4, question: 'Question 4', answer: 'D', explanation: 'Exp 4' },
        { id: 'q5', question_order: 5, question: 'Question 5', answer: 'A', explanation: 'Exp 5' },
    ];

    let originalConnect;

    beforeEach(() => {
        originalConnect = pool.connect;
    });

    afterEach(() => {
        pool.connect = originalConnect;
    });

    test('Student answers only 1 question and submits 4 unanswered (NONE) -> Scores 1/5 (20%), NOT 4/5', async () => {
        const mockClient = {
            query: jest.fn().mockImplementation((sql, params) => {
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                    return Promise.resolve({});
                }
                if (sql.includes('FOR UPDATE OF spd')) {
                    return Promise.resolve({
                        rows: [{ id: dummyPlanDayId, content_status: 'ready', target_questions: 5 }]
                    });
                }
                if (sql.includes('FROM study_plan_day_submissions')) {
                    return Promise.resolve({ rows: [] }); // Not submitted yet
                }
                if (sql.includes('FROM study_plan_questions')) {
                    return Promise.resolve({ rows: mockQuestions });
                }
                if (sql.includes('INSERT INTO study_plan_day_submissions')) {
                    return Promise.resolve({
                        rows: [{ id: 'sub-1', submitted_at: new Date().toISOString() }]
                    });
                }
                if (sql.includes('INSERT INTO study_plan_day_answers')) {
                    return Promise.resolve({});
                }
                return Promise.resolve({ rows: [] });
            }),
            release: jest.fn()
        };

        pool.connect = jest.fn().mockResolvedValue(mockClient);

        // Student answered Q1 with 'A' (correct), and left Q2-Q5 unanswered ('NONE')
        const answers = [
            { questionId: 'q1', selectedAnswer: 'A' },
            { questionId: 'q2', selectedAnswer: 'NONE' },
            { questionId: 'q3', selectedAnswer: 'NONE' },
            { questionId: 'q4', selectedAnswer: 'NONE' },
            { questionId: 'q5', selectedAnswer: 'NONE' },
        ];

        const result = await SubmissionRepository.submitDay(
            dummyPlanDayId,
            dummyStudentId,
            answers,
            dummySchoolId
        );

        expect(result.totalQuestions).toBe(5);
        expect(result.correctAnswers).toBe(1);
        expect(result.incorrectAnswers).toBe(4);
        expect(result.scorePercent).toBe(20);

        // Verify individual question statuses
        expect(result.results[0]).toMatchObject({ questionId: 'q1', selectedAnswer: 'A', isCorrect: true });
        expect(result.results[1]).toMatchObject({ questionId: 'q2', selectedAnswer: 'NONE', isCorrect: false });
        expect(result.results[2]).toMatchObject({ questionId: 'q3', selectedAnswer: 'NONE', isCorrect: false });
        expect(result.results[3]).toMatchObject({ questionId: 'q4', selectedAnswer: 'NONE', isCorrect: false });
        expect(result.results[4]).toMatchObject({ questionId: 'q5', selectedAnswer: 'NONE', isCorrect: false });
    });

    test('Student answers all questions correctly -> Scores 5/5 (100%)', async () => {
        const mockClient = {
            query: jest.fn().mockImplementation((sql, params) => {
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
                    return Promise.resolve({});
                }
                if (sql.includes('FOR UPDATE OF spd')) {
                    return Promise.resolve({
                        rows: [{ id: dummyPlanDayId, content_status: 'ready', target_questions: 5 }]
                    });
                }
                if (sql.includes('FROM study_plan_day_submissions')) {
                    return Promise.resolve({ rows: [] });
                }
                if (sql.includes('FROM study_plan_questions')) {
                    return Promise.resolve({ rows: mockQuestions });
                }
                if (sql.includes('INSERT INTO study_plan_day_submissions')) {
                    return Promise.resolve({
                        rows: [{ id: 'sub-2', submitted_at: new Date().toISOString() }]
                    });
                }
                if (sql.includes('INSERT INTO study_plan_day_answers')) {
                    return Promise.resolve({});
                }
                return Promise.resolve({ rows: [] });
            }),
            release: jest.fn()
        };

        pool.connect = jest.fn().mockResolvedValue(mockClient);

        const answers = [
            { questionId: 'q1', selectedAnswer: 'A' },
            { questionId: 'q2', selectedAnswer: 'B' },
            { questionId: 'q3', selectedAnswer: 'C' },
            { questionId: 'q4', selectedAnswer: 'D' },
            { questionId: 'q5', selectedAnswer: 'A' },
        ];

        const result = await SubmissionRepository.submitDay(
            dummyPlanDayId,
            dummyStudentId,
            answers,
            dummySchoolId
        );

        expect(result.correctAnswers).toBe(5);
        expect(result.scorePercent).toBe(100);
    });

    test('Invalid answer format throws INVALID_ANSWER_FORMAT (400)', async () => {
        const mockClient = {
            query: jest.fn().mockImplementation((sql) => {
                if (sql === 'BEGIN' || sql === 'ROLLBACK') return Promise.resolve({});
                if (sql.includes('FOR UPDATE OF spd')) {
                    return Promise.resolve({
                        rows: [{ id: dummyPlanDayId, content_status: 'ready', target_questions: 5 }]
                    });
                }
                if (sql.includes('FROM study_plan_day_submissions')) return Promise.resolve({ rows: [] });
                if (sql.includes('FROM study_plan_questions')) return Promise.resolve({ rows: mockQuestions });
                return Promise.resolve({ rows: [] });
            }),
            release: jest.fn()
        };

        pool.connect = jest.fn().mockResolvedValue(mockClient);

        const answers = [
            { questionId: 'q1', selectedAnswer: 'INVALID_XYZ' },
            { questionId: 'q2', selectedAnswer: 'B' },
            { questionId: 'q3', selectedAnswer: 'C' },
            { questionId: 'q4', selectedAnswer: 'D' },
            { questionId: 'q5', selectedAnswer: 'A' },
        ];

        await expect(
            SubmissionRepository.submitDay(dummyPlanDayId, dummyStudentId, answers, dummySchoolId)
        ).rejects.toMatchObject({ message: 'INVALID_ANSWER_FORMAT' });
    });
});
