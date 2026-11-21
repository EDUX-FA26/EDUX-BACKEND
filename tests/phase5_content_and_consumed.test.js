const test = require('node:test');
const assert = require('node:assert/strict');
const StudyPlannerContentService = require('../src/modules/learning/studyPlannerContent.service');
const StudyPlannerSubmissionService = require('../src/modules/learning/studyPlannerSubmission.service');
const ContentRepository = require('../src/modules/learning/studyPlannerContent.repository');
const SubmissionRepository = require('../src/modules/learning/studyPlannerSubmission.repository');
const LearningRepository = require('../src/modules/learning/learning.repository');
const geminiConfig = require('../src/config/gemini.config');
const { pool } = require('../src/config/db.config');

const dummyStudentId = '11111111-1111-4111-8111-111111111111';
const dummySubjectId = '22222222-2222-4222-8222-222222222222';
const dummySchoolId = '33333333-3333-4333-8333-333333333333';
const dummyTopicId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const dummyPlanDayId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('Phase 5: Pure Topic AI Generation - Generates 5 MCQs when topic has 0 flashcards', async () => {
  const origFindDay = ContentRepository.findDayForStudent;
  const origIsActive = LearningRepository.isStudentActiveInSubject;
  const origFindSources = ContentRepository.findDiagnosticSources;
  const origFindIncorrect = LearningRepository.findLatestIncorrectFlashcardsByTopic;
  const origAskGemini = geminiConfig.askGemini;
  const origSaveQuestions = ContentRepository.saveGeneratedQuestions;
  const origFindPublic = ContentRepository.findPublicDayQuestions;

  let savedWithPayload = null;

  try {
    ContentRepository.findDayForStudent = async () => ({
      id: dummyPlanDayId,
      planId: 'plan-uuid',
      day: 1,
      topicId: dummyTopicId,
      topicName: 'Lịch sử Đảng và Cách mạng Tháng Tám',
      topicDescription: 'Ý nghĩa lịch sử và bài học kinh nghiệm',
      reason: 'Giảng viên phát hiện sinh viên chưa nắm vững mốc thời gian',
      activity: 'practice',
      targetQuestions: 5,
      contentStatus: 'pending',
      subjectId: dummySubjectId,
    });

    LearningRepository.isStudentActiveInSubject = async () => true;

    // 0 flashcards available for this topic!
    ContentRepository.findDiagnosticSources = async () => [];
    LearningRepository.findLatestIncorrectFlashcardsByTopic = async () => [];

    // Mock Gemini response
    geminiConfig.askGemini = async (prompt) => {
      assert.ok(prompt.includes('Lịch sử Đảng và Cách mạng Tháng Tám'));
      return JSON.stringify({
        questions: Array.from({ length: 5 }, (_, i) => ({
          question: `Nội dung câu hỏi số ${i + 1} về Cách mạng Tháng Tám`,
          options: [
            { key: 'A', text: 'Đáp án chính xác A' },
            { key: 'B', text: 'Đáp án nhiễu B' },
            { key: 'C', text: 'Đáp án nhiễu C' },
            { key: 'D', text: 'Đáp án nhiễu D' },
          ],
          answer: 'A',
          explanation: `Giải thích chi tiết cho câu ${i + 1}`,
        })),
      });
    };

    ContentRepository.saveGeneratedQuestions = async (payload) => {
      savedWithPayload = payload;
      return { created: true };
    };

    ContentRepository.findPublicDayQuestions = async () => [
      { id: 'q1', questionOrder: 1, question: 'Câu 1' },
      { id: 'q2', questionOrder: 2, question: 'Câu 2' },
      { id: 'q3', questionOrder: 3, question: 'Câu 3' },
      { id: 'q4', questionOrder: 4, question: 'Câu 4' },
      { id: 'q5', questionOrder: 5, question: 'Câu 5' },
    ];

    const result = await StudyPlannerContentService.generateDay(
      dummyPlanDayId,
      dummyStudentId,
      dummySchoolId
    );

    assert.strictEqual(result.contentStatus, 'ready');
    assert.strictEqual(result.created, true);
    assert.strictEqual(result.questionCount, 5);

    // Verify sourceFlashcardId was null for Pure Topic AI
    assert.ok(savedWithPayload);
    assert.strictEqual(savedWithPayload.sourceFlashcardId, null);
    assert.strictEqual(savedWithPayload.questions.length, 5);
  } finally {
    ContentRepository.findDayForStudent = origFindDay;
    LearningRepository.isStudentActiveInSubject = origIsActive;
    ContentRepository.findDiagnosticSources = origFindSources;
    LearningRepository.findLatestIncorrectFlashcardsByTopic = origFindIncorrect;
    geminiConfig.askGemini = origAskGemini;
    ContentRepository.saveGeneratedQuestions = origSaveQuestions;
    ContentRepository.findPublicDayQuestions = origFindPublic;
  }
});

test('Phase 5: Pure Topic AI Generation - Pedagogical fallback activates when Gemini fails', async () => {
  const origFindDay = ContentRepository.findDayForStudent;
  const origIsActive = LearningRepository.isStudentActiveInSubject;
  const origFindSources = ContentRepository.findDiagnosticSources;
  const origAskGemini = geminiConfig.askGemini;
  const origSaveQuestions = ContentRepository.saveGeneratedQuestions;
  const origFindPublic = ContentRepository.findPublicDayQuestions;

  let savedWithPayload = null;

  try {
    ContentRepository.findDayForStudent = async () => ({
      id: dummyPlanDayId,
      planId: 'plan-uuid',
      day: 1,
      topicId: dummyTopicId,
      topicName: 'Kháng chiến chống Mỹ 1965-1968',
      activity: 'practice',
      targetQuestions: 5,
      contentStatus: 'pending',
      subjectId: dummySubjectId,
    });

    LearningRepository.isStudentActiveInSubject = async () => true;
    ContentRepository.findDiagnosticSources = async () => [];

    // Simulate Gemini API error (503 / network failure)
    geminiConfig.askGemini = async () => {
      throw new Error('Gemini model unavailable');
    };

    ContentRepository.saveGeneratedQuestions = async (payload) => {
      savedWithPayload = payload;
      return { created: true };
    };

    ContentRepository.findPublicDayQuestions = async () => [
      { id: 'q1', questionOrder: 1, question: 'Câu 1' },
    ];

    const result = await StudyPlannerContentService.generateDay(
      dummyPlanDayId,
      dummyStudentId,
      dummySchoolId
    );

    assert.strictEqual(result.contentStatus, 'ready');
    assert.ok(savedWithPayload);
    assert.strictEqual(savedWithPayload.sourceFlashcardId, null);
    assert.strictEqual(savedWithPayload.questions.length, 5);
    assert.ok(savedWithPayload.questions[0].question.includes('Kháng chiến chống Mỹ 1965-1968'));
  } finally {
    ContentRepository.findDayForStudent = origFindDay;
    LearningRepository.isStudentActiveInSubject = origIsActive;
    ContentRepository.findDiagnosticSources = origFindSources;
    geminiConfig.askGemini = origAskGemini;
    ContentRepository.saveGeneratedQuestions = origSaveQuestions;
    ContentRepository.findPublicDayQuestions = origFindPublic;
  }
});

test('Phase 5: Consumed Status - Marking submission review topic consumed after student submits day', async () => {
  const origFindDay = ContentRepository.findDayForStudent;
  const origIsActive = LearningRepository.isStudentActiveInSubject;
  const origSubmitDay = SubmissionRepository.submitDay;
  const origMarkConsumed = LearningRepository.markReviewTopicsConsumed;

  let markConsumedCalled = null;

  try {
    ContentRepository.findDayForStudent = async () => ({
      id: dummyPlanDayId,
      planId: 'plan-uuid',
      day: 2,
      topicId: dummyTopicId,
      subjectId: dummySubjectId,
      activity: 'practice',
    });

    LearningRepository.isStudentActiveInSubject = async () => true;

    SubmissionRepository.submitDay = async () => ({
      submissionId: 'sub-day-uuid',
      planDayId: dummyPlanDayId,
      studentId: dummyStudentId,
      scorePercent: 100,
      correctAnswers: 5,
      totalQuestions: 5,
    });

    LearningRepository.markReviewTopicsConsumed = async (studentId, topicId, schoolId) => {
      markConsumedCalled = { studentId, topicId, schoolId };
      return [{ id: 'review-topic-uuid', status: 'consumed' }];
    };

    const answers = [
      { questionId: '00000000-0000-4000-8000-000000000001', selectedAnswer: 'A' },
    ];

    const result = await StudyPlannerSubmissionService.submitDay(
      dummyPlanDayId,
      dummyStudentId,
      answers,
      dummySchoolId
    );

    assert.strictEqual(result.submissionId, 'sub-day-uuid');
    assert.strictEqual(result.scorePercent, 100);

    // Verify markReviewTopicsConsumed was called with correct student, topic, and school
    assert.ok(markConsumedCalled);
    assert.strictEqual(markConsumedCalled.studentId, dummyStudentId);
    assert.strictEqual(markConsumedCalled.topicId, dummyTopicId);
    assert.strictEqual(markConsumedCalled.schoolId, dummySchoolId);
  } finally {
    ContentRepository.findDayForStudent = origFindDay;
    LearningRepository.isStudentActiveInSubject = origIsActive;
    SubmissionRepository.submitDay = origSubmitDay;
    LearningRepository.markReviewTopicsConsumed = origMarkConsumed;
  }
});

test('Phase 5: markReviewTopicsConsumed database query updates status to consumed', async () => {
  let executedQuery = null;
  const mockPool = {
    query: async (sql, params) => {
      executedQuery = { sql: sql.trim(), params };
      return { rows: [{ id: 'review-1', status: 'consumed' }] };
    },
  };

  const origQuery = pool.query;
  pool.query = mockPool.query;

  try {
    const rows = await LearningRepository.markReviewTopicsConsumed(
      dummyStudentId,
      dummyTopicId,
      dummySchoolId
    );

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].status, 'consumed');
    assert.ok(executedQuery.sql.includes("status = 'consumed'"));
    assert.ok(executedQuery.sql.includes("status = 'approved'"));
    assert.deepStrictEqual(executedQuery.params, [dummyStudentId, dummyTopicId, dummySchoolId]);
  } finally {
    pool.query = origQuery;
  }
});
