jest.mock('../../config/db.config', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const { pool } = require('../../config/db.config');
const LearningRepository = require('./learning.repository');
const LearningTopicAnalyticsService = require('./learningTopicAnalytics.service');
const { calculateTopicAnalytics } = require('./topicAnalytics.service');

describe('Phase 5A — Learning Analytics & Topic Performance', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('Topic Analytics State Classification (4 States)', () => {
    const topic = {
      id: 'topic-uuid-1',
      code: 'REV_MOV_1930_1935',
      name: 'Cao trào cách mạng 1930-1931',
      parent_id: null,
    };

    test('P5A-01: not_assessed when topic has 0 quiz answers and 0 reviews', () => {
      const result = calculateTopicAnalytics(topic, [], new Date(), null);

      expect(result.masteryStatus).toBe('not_assessed');
      expect(result.masteryEstimate).toBeNull();
      expect(result.accuracy).toBeNull();
      expect(result.accuracyPercent).toBeNull();
      expect(result.dataQuality).toBe('no_data');
      expect(result.needsReview).toBe(false);
      expect(result.priority).toBe('insufficient_evidence');
      expect(result.lastStudiedAt).toBeNull();
      expect(result.totalAttempts).toBe(0);
      expect(result.totalReviews).toBe(0);
    });

    test('P5A-02: insufficient_data when distinct questions < 3', () => {
      const rows = [
        {
          answer_id: 'ans-1',
          flashcard_id: 'card-1',
          is_correct: true,
          submitted_at: '2026-11-10T10:00:00Z',
        },
        {
          answer_id: 'ans-2',
          flashcard_id: 'card-2',
          is_correct: false,
          submitted_at: '2026-11-10T10:05:00Z',
        },
      ];

      const result = calculateTopicAnalytics(topic, rows, new Date(), null);

      expect(result.masteryStatus).toBe('insufficient_data');
      expect(result.masteryEstimate).toBeNull();
      expect(result.accuracy).toBe(50);
      expect(result.dataQuality).toBe('insufficient');
      expect(result.needsReview).toBe(false);
      expect(result.priority).toBe('insufficient_evidence');
      expect(result.distinctQuestionCount).toBe(2);
      expect(result.lastStudiedAt).toBe('2026-11-10T10:05:00.000Z');
    });

    test('P5A-03: developing when distinct questions >= 3 and masteryEstimate < 70%', () => {
      // 3 questions, 1 correct, 2 incorrect -> latest raw = 33.33%
      // Prior = (33.33 * 3 + 50 * 5) / (3 + 5) = (100 + 250) / 8 = 43.75%
      const rows = [
        {
          answer_id: 'ans-1',
          flashcard_id: 'card-1',
          is_correct: true,
          submitted_at: '2026-11-12T08:00:00Z',
        },
        {
          answer_id: 'ans-2',
          flashcard_id: 'card-2',
          is_correct: false,
          submitted_at: '2026-11-12T08:01:00Z',
        },
        {
          answer_id: 'ans-3',
          flashcard_id: 'card-3',
          is_correct: false,
          submitted_at: '2026-11-12T08:02:00Z',
        },
      ];

      const result = calculateTopicAnalytics(topic, rows, new Date(), null);

      expect(result.masteryStatus).toBe('developing');
      expect(result.masteryEstimate).toBe(43.75);
      expect(result.needsReview).toBe(true);
      expect(result.dataQuality).toBe('sufficient');
      expect(result.priority).toBe('medium');
    });

    test('P5A-04: high priority developing when distinct questions >= 5 and masteryEstimate < 50%', () => {
      const rows = [
        { answer_id: 'a1', flashcard_id: 'c1', is_correct: false, submitted_at: '2026-11-12T08:00:00Z' },
        { answer_id: 'a2', flashcard_id: 'c2', is_correct: false, submitted_at: '2026-11-12T08:01:00Z' },
        { answer_id: 'a3', flashcard_id: 'c3', is_correct: false, submitted_at: '2026-11-12T08:02:00Z' },
        { answer_id: 'a4', flashcard_id: 'c4', is_correct: false, submitted_at: '2026-11-12T08:03:00Z' },
        { answer_id: 'a5', flashcard_id: 'c5', is_correct: true,  submitted_at: '2026-11-12T08:04:00Z' },
      ];

      const result = calculateTopicAnalytics(topic, rows, new Date(), null);

      expect(result.masteryStatus).toBe('developing');
      expect(result.priority).toBe('high');
      expect(result.needsReview).toBe(true);
      expect(result.dataQuality).toBe('sufficient');
    });

    test('P5A-05: mastered when distinct questions >= 3 and masteryEstimate >= 70%', () => {
      // 3 questions, all 3 correct -> latest raw = 100%
      // Prior = (100 * 3 + 50 * 5) / (3 + 5) = (300 + 250) / 8 = 68.75% (< 70)
      // With 5 questions, all 5 correct -> latest raw = 100%
      // Prior = (100 * 5 + 50 * 5) / 10 = 75% (>= 70)
      const rows = [
        { answer_id: 'a1', flashcard_id: 'c1', is_correct: true, submitted_at: '2026-11-12T08:00:00Z' },
        { answer_id: 'a2', flashcard_id: 'c2', is_correct: true, submitted_at: '2026-11-12T08:01:00Z' },
        { answer_id: 'a3', flashcard_id: 'c3', is_correct: true, submitted_at: '2026-11-12T08:02:00Z' },
        { answer_id: 'a4', flashcard_id: 'c4', is_correct: true, submitted_at: '2026-11-12T08:03:00Z' },
        { answer_id: 'a5', flashcard_id: 'c5', is_correct: true, submitted_at: '2026-11-12T08:04:00Z' },
      ];

      const result = calculateTopicAnalytics(topic, rows, new Date(), null);

      expect(result.masteryStatus).toBe('mastered');
      expect(result.masteryEstimate).toBe(75);
      expect(result.needsReview).toBe(false);
      expect(result.priority).toBe('low');
      expect(result.dataQuality).toBe('sufficient');
    });

    test('P5A-06: integrates review count and latest review timestamp', () => {
      const reviewData = {
        total_reviews: 12,
        last_reviewed_at: '2026-11-15T15:30:00Z',
      };
      const rows = [
        {
          answer_id: 'a1',
          flashcard_id: 'c1',
          is_correct: true,
          submitted_at: '2026-11-10T10:00:00Z',
        },
      ];

      const result = calculateTopicAnalytics(topic, rows, new Date(), reviewData);

      expect(result.totalReviews).toBe(12);
      expect(result.totalAttempts).toBe(1);
      expect(result.lastStudiedAt).toBe('2026-11-15T15:30:00.000Z');
      expect(result.masteryStatus).toBe('insufficient_data'); // only 1 distinct question
    });
  });

  describe('Service Orchestration & Contract Compliance', () => {
    test('P5A-07: getStudentTopicPerformance handles mixed topics and returns overview', async () => {
      const studentId = 'student-uuid-1';
      const subjectId = 'subject-uuid-1';
      const schoolId = 'school-uuid-1';

      jest.spyOn(LearningRepository, 'findSubjectById').mockResolvedValue({
        id: subjectId,
        school_id: schoolId,
        name: 'Lịch sử Đảng',
      });
      jest.spyOn(LearningRepository, 'isStudentActiveInSubject').mockResolvedValue(true);

      const canonicalTopics = [
        { id: 'top-1', code: 'TOP_1', name: 'Topic 1', parent_id: null },
        { id: 'top-2', code: 'TOP_2', name: 'Topic 2', parent_id: null },
      ];
      jest.spyOn(LearningRepository, 'findActiveTopicsBySubject').mockResolvedValue(canonicalTopics);

      const answers = [
        // top-1 has 5 correct answers (mastered)
        { topic_id: 'top-1', answer_id: 'a1', flashcard_id: 'c1', is_correct: true, submitted_at: '2026-11-14T08:00:00Z' },
        { topic_id: 'top-1', answer_id: 'a2', flashcard_id: 'c2', is_correct: true, submitted_at: '2026-11-14T08:01:00Z' },
        { topic_id: 'top-1', answer_id: 'a3', flashcard_id: 'c3', is_correct: true, submitted_at: '2026-11-14T08:02:00Z' },
        { topic_id: 'top-1', answer_id: 'a4', flashcard_id: 'c4', is_correct: true, submitted_at: '2026-11-14T08:03:00Z' },
        { topic_id: 'top-1', answer_id: 'a5', flashcard_id: 'c5', is_correct: true, submitted_at: '2026-11-14T08:04:00Z' },
        // top-2 has 0 answers
      ];
      jest.spyOn(LearningRepository, 'findSubmittedMultipleChoiceTopicAnswers').mockResolvedValue(answers);

      const reviews = [
        { topic_id: 'top-1', total_reviews: 7, last_reviewed_at: '2026-11-14T09:00:00Z' },
      ];
      jest.spyOn(LearningRepository, 'findTopicReviewCountsBySubject').mockResolvedValue(reviews);

      const res = await LearningTopicAnalyticsService.getStudentTopicPerformance(studentId, subjectId, schoolId);

      expect(res.subjectId).toBe(subjectId);
      expect(res.overview).toEqual({
        totalReviewEvents: 7,
        totalQuizAnswers: 5,
        accuracyPercent: 100,
        overallMastery: 75,
        evaluatedTopics: 1, // top-1 is sufficient
        unassessedTopics: 1, // top-2 is no_data
        unclassifiedEvents: 0,
      });

      expect(res.topics).toHaveLength(2);
      const [t1, t2] = res.topics;

      expect(t1.topicId).toBe('top-1');
      expect(t1.topicCode).toBe('TOP_1');
      expect(t1.masteryStatus).toBe('mastered');
      expect(t1.dataQuality).toBe('sufficient');

      expect(t2.topicId).toBe('top-2');
      expect(t2.topicCode).toBe('TOP_2');
      expect(t2.masteryStatus).toBe('not_assessed');
      expect(t2.dataQuality).toBe('no_data');
      expect(t2.masteryEstimate).toBeNull();
      expect(t2.accuracy).toBeNull();
    });

    test('P5A-08: throws SUBJECT_ACCESS_FORBIDDEN if student is not enrolled', async () => {
      jest.spyOn(LearningRepository, 'findSubjectById').mockResolvedValue({ id: 'sub-1' });
      jest.spyOn(LearningRepository, 'isStudentActiveInSubject').mockResolvedValue(false);

      await expect(
        LearningTopicAnalyticsService.getStudentTopicPerformance('stu-1', 'sub-1', 'sch-1')
      ).rejects.toThrow('SUBJECT_ACCESS_FORBIDDEN');
    });

    test('P5A-09: student with only SRS reviews has totalReviews > 0, null mastery, and no fabricated accuracy', async () => {
      jest.spyOn(LearningRepository, 'findSubjectById').mockResolvedValue({ id: 'sub-1' });
      jest.spyOn(LearningRepository, 'isStudentActiveInSubject').mockResolvedValue(true);
      jest.spyOn(LearningRepository, 'findActiveTopicsBySubject').mockResolvedValue([
        { id: 'top-1', code: 'T1', name: 'Topic 1', parent_id: null },
      ]);
      jest.spyOn(LearningRepository, 'findSubmittedMultipleChoiceTopicAnswers').mockResolvedValue([]);
      jest.spyOn(LearningRepository, 'findTopicReviewCountsBySubject').mockResolvedValue([
        { topic_id: 'top-1', total_reviews: 8, last_reviewed_at: '2026-11-16T10:00:00Z' },
      ]);
      jest.spyOn(LearningRepository, 'findUnclassifiedEventsCountBySubject').mockResolvedValue({
        unclassifiedQuizAnswers: 0,
        unclassifiedReviews: 2,
        totalUnclassifiedEvents: 2,
      });

      const res = await LearningTopicAnalyticsService.getStudentTopicPerformance('stu-1', 'sub-1', 'sch-1');

      expect(res.overview.totalReviewEvents).toBe(8);
      expect(res.overview.totalQuizAnswers).toBe(0);
      expect(res.overview.accuracyPercent).toBeNull();
      expect(res.overview.overallMastery).toBeNull();
      expect(res.overview.unclassifiedEvents).toBe(2);

      const topic = res.topics[0];
      expect(topic.totalReviews).toBe(8);
      expect(topic.totalAttempts).toBe(0);
      expect(topic.accuracy).toBeNull();
      expect(topic.masteryEstimate).toBeNull();
      expect(topic.masteryStatus).toBe('insufficient_data');
      expect(topic.dataQuality).toBe('insufficient');
      expect(topic.lastStudiedAt).toBe('2026-11-16T10:00:00.000Z');
    });
  });

  describe('Repository SQL Multi-Tenant & Query Scoping', () => {
    test('P5A-10: findActiveTopicsBySubject strictly filters canonical flat approved topics', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await LearningRepository.findActiveTopicsBySubject('subject-123', 'school-456');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];

      expect(params).toEqual(['subject-123', 'school-456']);
      expect(sql).toContain("subject_id = $1");
      expect(sql).toContain("school_id = $2");
      expect(sql).toContain("status = 'approved'");
      expect(sql).toContain("is_active = true");
      expect(sql).toContain("(review_required = false OR review_required IS NULL)");
      expect(sql).toContain("parent_id IS NULL");
    });

    test('P5A-11: findSubmittedMultipleChoiceTopicAnswers uses card_canonical_topic CTE and DISTINCT ON', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await LearningRepository.findSubmittedMultipleChoiceTopicAnswers('stu-1', 'sub-1', 'sch-1');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];

      expect(params).toContain('stu-1');
      expect(params).toContain('sub-1');
      expect(params).toContain('sch-1');
      expect(sql).toContain('WITH card_canonical_topic AS');
      expect(sql).toContain('SELECT DISTINCT ON (fct.flashcard_id)');
      expect(sql).toContain('ORDER BY fct.flashcard_id, fct.created_at DESC, fct.topic_id DESC');
      expect(sql).toContain("t.status = 'approved'");
      expect(sql).toContain("t.parent_id IS NULL");
      expect(sql).toContain("fct.review_status = 'approved'");
      expect(sql).toContain('SELECT DISTINCT ON (fta.id)');
      expect(sql).toContain('JOIN card_canonical_topic cct ON cct.flashcard_id = fc.id');
      expect(sql).toContain('ft.school_id =');
      expect(sql).toContain('fd.school_id =');
      expect(sql).not.toContain('fc.topic_id');
      expect(sql).not.toContain('fct.id');
    });

    test('P5A-12: findTopicReviewCountsBySubject aggregates reviews per canonical topic without fanout', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await LearningRepository.findTopicReviewCountsBySubject('stu-1', 'sub-1', 'sch-1');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];

      expect(params).toContain('stu-1');
      expect(params).toContain('sub-1');
      expect(params).toContain('sch-1');
      expect(sql).toContain('WITH card_canonical_topic AS');
      expect(sql).toContain('SELECT DISTINCT ON (fct.flashcard_id)');
      expect(sql).toContain('COUNT(fr.id)::int AS total_reviews');
      expect(sql).toContain('JOIN card_canonical_topic cct ON cct.flashcard_id = fc.id');
      expect(sql).toContain('fr.school_id =');
      expect(sql).toContain('fd.school_id =');
      expect(sql).not.toContain('fc.topic_id');
      expect(sql).not.toContain('fct.id');
    });

    test('P5A-13: findUnclassifiedEventsCountBySubject counts events on cards not mapped to canonical topics', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ unclassified_quiz_answers: 3, unclassified_reviews: 4 }],
      });

      const res = await LearningRepository.findUnclassifiedEventsCountBySubject('stu-1', 'sub-1', 'sch-1');

      expect(pool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = pool.query.mock.calls[0];

      expect(params).toContain('stu-1');
      expect(params).toContain('sub-1');
      expect(params).toContain('sch-1');
      expect(sql).toContain('WITH card_canonical_topic AS');
      expect(sql).toContain('fc.id NOT IN (SELECT flashcard_id FROM card_canonical_topic)');
      expect(res).toEqual({
        unclassifiedQuizAnswers: 3,
        unclassifiedReviews: 4,
        totalUnclassifiedEvents: 7,
      });
    });
  });
});
