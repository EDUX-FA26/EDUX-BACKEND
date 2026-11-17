const { makeStudyPlan7Days } = require('./studyPlanner.core');
const StudyPlannerService = require('./studyPlanner.service');
const StudyPlannerRepository = require('./studyPlanner.repository');
const StudyPlannerSubmissionService = require('./studyPlannerSubmission.service');
const ContentRepository = require('./studyPlannerContent.repository');
const SubmissionRepository = require('./studyPlannerSubmission.repository');
const LearningRepository = require('./learning.repository');
const { pool } = require('../../config/db.config');

describe('Phase 5B — Deterministic 7-Day Study Plan Matrix (P5B-01 to P5B-22)', () => {
  const dummyStudentId = '11111111-1111-4111-8111-111111111111';
  const dummySubjectId = '22222222-2222-4222-8222-222222222222';
  const dummySchoolId = '33333333-3333-4333-8333-333333333333';
  const otherSchoolId = '44444444-4444-4444-8444-444444444444';
  const otherStudentId = '55555555-5555-4555-8555-555555555555';

  const topicA = {
    topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    topicCode: 'TOPIC_A',
    topicName: 'Giải tích 1 — Đạo hàm',
    masteryStatus: 'developing',
    masteryEstimate: 45,
    needsReview: true,
    priority: 'high',
    evidenceCount: 6,
    accuracy: 45,
    accessibleCardCount: 10,
  };

  const topicB = {
    topicId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    topicCode: 'TOPIC_B',
    topicName: 'Giải tích 1 — Tích phân',
    masteryStatus: 'mastered',
    masteryEstimate: 85,
    needsReview: false,
    priority: 'low',
    evidenceCount: 10,
    accuracy: 85,
    accessibleCardCount: 12,
  };

  const topicC = {
    topicId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    topicCode: 'TOPIC_C',
    topicName: 'Giải tích 1 — Giới hạn dãy số',
    masteryStatus: 'not_assessed',
    masteryEstimate: null,
    needsReview: false,
    priority: 'insufficient_evidence',
    evidenceCount: 0,
    accuracy: null,
    accessibleCardCount: 8,
  };

  const topicD = {
    topicId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    topicCode: 'TOPIC_D',
    topicName: 'Giải tích 1 — Chuỗi số',
    masteryStatus: 'insufficient_data',
    masteryEstimate: null,
    needsReview: false,
    priority: 'insufficient_evidence',
    evidenceCount: 1,
    accuracy: 100,
    accessibleCardCount: 6,
  };

  describe('Core Scheduling Engine (P5B-01 to P5B-09)', () => {
    test('P5B-01: Student has evidence in 2 topics -> Generates exactly 7 days, valid days 1..7', () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicA, topicB],
      };

      const plan = makeStudyPlan7Days(analytics);

      expect(plan.durationDays).toBe(7);
      expect(plan.days).toHaveLength(7);
      expect(plan.days.map(d => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);

      const scheduledTopicIds = new Set(plan.days.map(d => d.topicId));
      expect(scheduledTopicIds.has(topicA.topicId)).toBe(true);
      expect(scheduledTopicIds.has(topicB.topicId)).toBe(true);
    });

    test('P5B-02: Developing topic -> Activity is "practice", reason reflects real mastery < 70%', () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicA],
      };

      const plan = makeStudyPlan7Days(analytics);
      const day1 = plan.days[0];

      expect(day1.activity).toBe('practice');
      expect(day1.reason).toContain('Mastery dưới ngưỡng (45%)');
      expect(day1.durationMinutes).toBe(15);
      expect(day1.targetQuestions).toBe(5);
    });

    test('P5B-03: Mastered topic -> Activity is "review" (maintenance), NOT marked as weak', () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicB],
      };

      const plan = makeStudyPlan7Days(analytics);
      const day1 = plan.days[0];

      expect(day1.activity).toBe('review');
      expect(day1.reason).toContain('Chủ đề đã nắm vững (85%)');
      expect(day1.reason).not.toContain('yếu');
      expect(day1.reason).not.toContain('dưới ngưỡng');
    });

    test('P5B-04: Not assessed topic -> Activity is "diagnostic", reason reflects lack of initial data', () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicC],
      };

      const plan = makeStudyPlan7Days(analytics);
      const day1 = plan.days[0];

      expect(day1.activity).toBe('diagnostic');
      expect(day1.reason).toContain('chưa có dữ liệu đánh giá');
      expect(day1.durationMinutes).toBe(10);
      expect(day1.targetQuestions).toBe(3);
    });

    test('P5B-05: Insufficient data topic -> Activity is "diagnostic", no fabricated accuracy', () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicD],
      };

      const plan = makeStudyPlan7Days(analytics);
      const day1 = plan.days[0];

      expect(day1.activity).toBe('diagnostic');
      expect(day1.reason).toContain('Chưa đủ câu hỏi đánh giá độc lập');
    });

    test('P5B-06: Approved topic with 0 accessible cards is excluded; throws NO_SCHEDULABLE_TOPICS if none accessible', () => {
      const zeroCardsTopic = {
        ...topicA,
        accessibleCardCount: 0,
      };

      const analyticsWithZero = {
        subjectId: dummySubjectId,
        topics: [zeroCardsTopic],
      };

      expect(() => makeStudyPlan7Days(analyticsWithZero)).toThrow('NO_SCHEDULABLE_TOPICS');

      // But if there is another topic with cards, it chooses the accessible one
      const mixedAnalytics = {
        subjectId: dummySubjectId,
        topics: [zeroCardsTopic, topicB],
      };

      const plan = makeStudyPlan7Days(mixedAnalytics);
      expect(plan.days.every(d => d.topicId === topicB.topicId)).toBe(true);
    });

    test('P5B-09: Single accessible topic can repeat across 7 days without duplicate day error', () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicA],
      };

      const plan = makeStudyPlan7Days(analytics);
      expect(plan.days).toHaveLength(7);
      expect(plan.days.map(d => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(plan.days.every(d => d.topicId === topicA.topicId)).toBe(true);
    });

    test('Multiple topics avoid consecutive identical topics', () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicA, topicB, topicC],
      };

      const plan = makeStudyPlan7Days(analytics);
      for (let i = 1; i < plan.days.length; i++) {
        expect(plan.days[i].topicId).not.toBe(plan.days[i - 1].topicId);
      }
    });

    test('Target questions is bounded by accessibleCardCount if less than default target', () => {
      const smallCardTopic = {
        ...topicA,
        accessibleCardCount: 2,
      };

      const analytics = {
        subjectId: dummySubjectId,
        topics: [smallCardTopic],
      };

      const plan = makeStudyPlan7Days(analytics);
      expect(plan.days[0].targetQuestions).toBe(2);
    });
  });

  describe('Timezone & Date Calculation (P5B-14)', () => {
    test('P5B-14: StartsOn and 7 consecutive study dates match local calendar without shifting', async () => {
      const analytics = {
        subjectId: dummySubjectId,
        topics: [topicA, topicB],
      };

      // Mock LearningRepository.findAccessibleCardCountsByTopics
      const originalFindCounts = LearningRepository.findAccessibleCardCountsByTopics;
      LearningRepository.findAccessibleCardCountsByTopics = jest.fn().mockResolvedValue(
        new Map([
          [topicA.topicId, 10],
          [topicB.topicId, 12],
        ])
      );

      const preview = await StudyPlannerService.createPreview(analytics, dummyStudentId, dummySchoolId);

      expect(preview.startsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(preview.days).toHaveLength(7);

      for (let i = 0; i < 7; i++) {
        expect(preview.days[i].day).toBe(i + 1);
        expect(preview.days[i].studyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }

      // Check dates are consecutive
      for (let i = 1; i < 7; i++) {
        const prev = new Date(preview.days[i - 1].studyDate);
        const curr = new Date(preview.days[i].studyDate);
        const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
        expect(diffDays).toBe(1);
      }

      LearningRepository.findAccessibleCardCountsByTopics = originalFindCounts;
    });
  });

  describe('Persistence, Idempotency & Concurrency (P5B-10 to P5B-13)', () => {
    test('P5B-10 & P5B-13: Second generate call for same student, subject and startsOn returns existing plan', async () => {
      const mockPlan = {
        id: '99999999-9999-4999-8999-999999999999',
        student_id: dummyStudentId,
        subject_id: dummySubjectId,
        starts_on: '2026-11-18',
        status: 'draft',
      };

      const mockDays = [1, 2, 3, 4, 5, 6, 7].map(d => ({
        id: `00000000-0000-4000-8000-00000000000${d}`,
        day_number: d,
        topic_id: topicA.topicId,
        activity: 'practice',
        duration_minutes: 15,
        target_questions: 5,
        reason: 'Luyện tập',
        content_status: 'ready',
      }));

      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return Promise.resolve({});
          }
          if (sql.includes('information_schema.columns')) {
            return Promise.resolve({ rows: [] });
          }
          if (sql.includes('FOR UPDATE')) {
            // Simulate existing plan on second call
            return Promise.resolve({ rows: [mockPlan] });
          }
          if (sql.includes('SELECT') && sql.includes('FROM study_plan_days')) {
            return Promise.resolve({ rows: mockDays });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
      };

      const originalConnect = pool.connect;
      pool.connect = jest.fn().mockResolvedValue(mockClient);

      const result = await StudyPlannerRepository.createOrGetPlan({
        studentId: dummyStudentId,
        subjectId: dummySubjectId,
        startsOn: '2026-11-18',
        analytics: { subjectId: dummySubjectId, topics: [topicA] },
        days: mockDays.map(d => ({ day: d.day_number, topicId: d.topic_id, activity: d.activity, durationMinutes: d.duration_minutes, targetQuestions: d.target_questions, reason: d.reason })),
        schoolId: dummySchoolId,
      });

      expect(result.created).toBe(false);
      expect(result.plan.id).toBe(mockPlan.id);
      expect(result.days).toHaveLength(7);

      pool.connect = originalConnect;
    });

    test('P5B-12: Transaction failure on day insert triggers ROLLBACK', async () => {
      let rollbackCalled = false;

      const mockClient = {
        query: jest.fn().mockImplementation((sql, params) => {
          if (sql === 'BEGIN') return Promise.resolve({});
          if (sql === 'ROLLBACK') {
            rollbackCalled = true;
            return Promise.resolve({});
          }
          if (sql.includes('information_schema.columns')) {
            return Promise.resolve({ rows: [] });
          }
          if (sql.includes('FOR UPDATE')) {
            return Promise.resolve({ rows: [] }); // No existing
          }
          if (sql.includes('INSERT INTO study_plans')) {
            return Promise.resolve({ rows: [{ id: 'new-plan-id', status: 'draft' }] });
          }
          if (sql.includes('INSERT INTO study_plan_days')) {
            // Simulate error on day 4
            if (params && params[1] === 4) {
              throw new Error('DATABASE_CONNECTION_LOST_ON_DAY_4');
            }
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        }),
        release: jest.fn(),
      };

      const originalConnect = pool.connect;
      pool.connect = jest.fn().mockResolvedValue(mockClient);

      await expect(
        StudyPlannerRepository.createOrGetPlan({
          studentId: dummyStudentId,
          subjectId: dummySubjectId,
          startsOn: '2026-11-18',
          analytics: { subjectId: dummySubjectId, topics: [topicA] },
          days: [1, 2, 3, 4, 5, 6, 7].map(d => ({ day: d, topicId: topicA.topicId, activity: 'practice', durationMinutes: 15, targetQuestions: 5, reason: 'test' })),
          schoolId: dummySchoolId,
        })
      ).rejects.toThrow('DATABASE_CONNECTION_LOST_ON_DAY_4');

      expect(rollbackCalled).toBe(true);

      pool.connect = originalConnect;
    });
  });

  describe('Day Detail, Completion and Result (P5B-15 to P5B-17)', () => {
    test('P5B-15: Student opening day detail without submission does NOT mark day as completed', async () => {
      const planDayId = 'aaaaaaaa-1111-4111-8111-111111111111';

      const originalFindDay = ContentRepository.findDayForStudent;
      const originalIsActive = LearningRepository.isStudentActiveInSubject;
      const originalIsTopicActive = LearningRepository.isTopicActiveInSubject;
      const originalFindSub = SubmissionRepository.findSubmission;
      const originalFindQuestions = ContentRepository.findPublicDayQuestions;

      ContentRepository.findDayForStudent = jest.fn().mockResolvedValue({
        id: planDayId,
        planId: 'some-plan-id',
        day: 1,
        topicId: topicA.topicId,
        topicName: topicA.topicName,
        activity: 'practice',
        targetQuestions: 5,
        contentStatus: 'ready',
        subjectId: dummySubjectId,
      });

      LearningRepository.isStudentActiveInSubject = jest.fn().mockResolvedValue(true);
      LearningRepository.isTopicActiveInSubject = jest.fn().mockResolvedValue(true);
      SubmissionRepository.findSubmission = jest.fn().mockResolvedValue(null); // No submission!
      ContentRepository.findPublicDayQuestions = jest.fn().mockResolvedValue([
        { id: 'q1', questionOrder: 1, question: 'Question 1', options: [] },
      ]);

      const dayDetail = await StudyPlannerSubmissionService.getDay(planDayId, dummyStudentId, dummySchoolId);

      expect(dayDetail.submitted).toBe(false);
      expect(dayDetail.questionCount).toBe(1);

      ContentRepository.findDayForStudent = originalFindDay;
      LearningRepository.isStudentActiveInSubject = originalIsActive;
      LearningRepository.isTopicActiveInSubject = originalIsTopicActive;
      SubmissionRepository.findSubmission = originalFindSub;
      ContentRepository.findPublicDayQuestions = originalFindQuestions;
    });

    test('P5B-17: Multiple days with same topic require separate submissions', async () => {
      const day1Id = '11111111-0000-0000-0000-000000000001';
      const day3Id = '33333333-0000-0000-0000-000000000003';

      const originalFindDay = ContentRepository.findDayForStudent;
      const originalIsActive = LearningRepository.isStudentActiveInSubject;
      const originalIsTopicActive = LearningRepository.isTopicActiveInSubject;
      const originalFindSub = SubmissionRepository.findSubmission;
      const originalFindQuestions = ContentRepository.findPublicDayQuestions;

      ContentRepository.findDayForStudent = jest.fn().mockImplementation((planDayId) => {
        return Promise.resolve({
          id: planDayId,
          planId: 'plan-id',
          day: planDayId === day1Id ? 1 : 3,
          topicId: topicA.topicId,
          topicName: topicA.topicName,
          activity: 'practice',
          targetQuestions: 5,
          contentStatus: 'ready',
          subjectId: dummySubjectId,
        });
      });

      LearningRepository.isStudentActiveInSubject = jest.fn().mockResolvedValue(true);
      LearningRepository.isTopicActiveInSubject = jest.fn().mockResolvedValue(true);
      ContentRepository.findPublicDayQuestions = jest.fn().mockResolvedValue([]);

      // Day 1 has submission, Day 3 does not
      SubmissionRepository.findSubmission = jest.fn().mockImplementation((planDayId) => {
        if (planDayId === day1Id) {
          return Promise.resolve({ id: 'sub-1', scorePercent: 100, correctAnswers: 5, totalQuestions: 5 });
        }
        return Promise.resolve(null);
      });

      const day1Result = await StudyPlannerSubmissionService.getDay(day1Id, dummyStudentId, dummySchoolId);
      const day3Result = await StudyPlannerSubmissionService.getDay(day3Id, dummyStudentId, dummySchoolId);

      expect(day1Result.submitted).toBe(true);
      expect(day3Result.submitted).toBe(false);

      ContentRepository.findDayForStudent = originalFindDay;
      LearningRepository.isStudentActiveInSubject = originalIsActive;
      LearningRepository.isTopicActiveInSubject = originalIsTopicActive;
      SubmissionRepository.findSubmission = originalFindSub;
      ContentRepository.findPublicDayQuestions = originalFindQuestions;
    });

    test('P5B-20: Admin deactivates topic after plan creation -> uncompleted day is marked unavailable, questions empty, but no data deleted', async () => {
      const planDayId = 'aaaaaaaa-1111-4111-8111-111111111111';

      const originalFindDay = ContentRepository.findDayForStudent;
      const originalIsActive = LearningRepository.isStudentActiveInSubject;
      const originalIsTopicActive = LearningRepository.isTopicActiveInSubject;
      const originalMarkUnavailable = ContentRepository.markDayUnavailable;
      const originalFindSub = SubmissionRepository.findSubmission;

      ContentRepository.findDayForStudent = jest.fn().mockResolvedValue({
        id: planDayId,
        planId: 'some-plan-id',
        day: 1,
        topicId: topicA.topicId,
        topicName: topicA.topicName,
        activity: 'practice',
        targetQuestions: 5,
        contentStatus: 'ready',
        subjectId: dummySubjectId,
      });

      LearningRepository.isStudentActiveInSubject = jest.fn().mockResolvedValue(true);
      // Topic deactivated by Admin!
      LearningRepository.isTopicActiveInSubject = jest.fn().mockResolvedValue(false);
      ContentRepository.markDayUnavailable = jest.fn().mockResolvedValue(true);
      SubmissionRepository.findSubmission = jest.fn().mockResolvedValue(null);

      const dayDetail = await StudyPlannerSubmissionService.getDay(planDayId, dummyStudentId, dummySchoolId);

      expect(ContentRepository.markDayUnavailable).toHaveBeenCalledWith(planDayId, dummyStudentId);
      expect(dayDetail.contentStatus).toBe('unavailable');
      expect(dayDetail.questions).toEqual([]);
      expect(dayDetail.submitted).toBe(false);

      ContentRepository.findDayForStudent = originalFindDay;
      LearningRepository.isStudentActiveInSubject = originalIsActive;
      LearningRepository.isTopicActiveInSubject = originalIsTopicActive;
      ContentRepository.markDayUnavailable = originalMarkUnavailable;
      SubmissionRepository.findSubmission = originalFindSub;
    });

    test('P5B-20-Completed: Completed day retains past submission, score and questions even if topic is later deactivated', async () => {
      const planDayId = 'aaaaaaaa-1111-4111-8111-111111111111';

      const originalFindDay = ContentRepository.findDayForStudent;
      const originalIsActive = LearningRepository.isStudentActiveInSubject;
      const originalIsTopicActive = LearningRepository.isTopicActiveInSubject;
      const originalMarkUnavailable = ContentRepository.markDayUnavailable;
      const originalFindSub = SubmissionRepository.findSubmission;
      const originalFindQuestions = ContentRepository.findPublicDayQuestions;

      ContentRepository.findDayForStudent = jest.fn().mockResolvedValue({
        id: planDayId,
        planId: 'some-plan-id',
        day: 1,
        topicId: topicA.topicId,
        topicName: topicA.topicName,
        activity: 'practice',
        targetQuestions: 5,
        contentStatus: 'ready',
        subjectId: dummySubjectId,
      });

      LearningRepository.isStudentActiveInSubject = jest.fn().mockResolvedValue(true);
      // Even if Admin deactivated topic later!
      LearningRepository.isTopicActiveInSubject = jest.fn().mockResolvedValue(false);
      ContentRepository.markDayUnavailable = jest.fn().mockResolvedValue(true);
      
      // Day is already completed:
      SubmissionRepository.findSubmission = jest.fn().mockResolvedValue({
        id: 'sub-completed-1',
        scorePercent: 100,
        correctAnswers: 5,
        totalQuestions: 5,
      });

      ContentRepository.findPublicDayQuestions = jest.fn().mockResolvedValue([
        { id: 'q1', questionOrder: 1, question: 'Historical Question 1', options: [] },
      ]);

      const dayDetail = await StudyPlannerSubmissionService.getDay(planDayId, dummyStudentId, dummySchoolId);

      // Must NOT be marked unavailable because it was already completed!
      expect(ContentRepository.markDayUnavailable).not.toHaveBeenCalled();
      expect(dayDetail.submitted).toBe(true);
      expect(dayDetail.contentStatus).toBe('ready');
      expect(dayDetail.questions).toHaveLength(1);
      expect(dayDetail.questions[0].question).toBe('Historical Question 1');

      ContentRepository.findDayForStudent = originalFindDay;
      LearningRepository.isStudentActiveInSubject = originalIsActive;
      LearningRepository.isTopicActiveInSubject = originalIsTopicActive;
      ContentRepository.markDayUnavailable = originalMarkUnavailable;
      SubmissionRepository.findSubmission = originalFindSub;
      ContentRepository.findPublicDayQuestions = originalFindQuestions;
    });
  });

  describe('Multi-Tenant & User Access Security (P5B-18 to P5B-19)', () => {
    test('P5B-18: School A student accessing subject of School B throws SUBJECT_ACCESS_FORBIDDEN (403)', async () => {
      const planDayId = 'aaaaaaaa-1111-4111-8111-111111111111';

      const originalFindDay = ContentRepository.findDayForStudent;
      const originalIsActive = LearningRepository.isStudentActiveInSubject;

      ContentRepository.findDayForStudent = jest.fn().mockResolvedValue({
        id: planDayId,
        subjectId: dummySubjectId,
      });

      // User belongs to otherSchoolId, not dummySchoolId
      LearningRepository.isStudentActiveInSubject = jest.fn().mockResolvedValue(false);

      await expect(
        StudyPlannerSubmissionService.getDay(planDayId, dummyStudentId, otherSchoolId)
      ).rejects.toThrow('SUBJECT_ACCESS_FORBIDDEN');

      ContentRepository.findDayForStudent = originalFindDay;
      LearningRepository.isStudentActiveInSubject = originalIsActive;
    });

    test('P5B-19: User A attempting to read plan day of User B throws PLAN_DAY_NOT_FOUND (404)', async () => {
      const planDayId = 'aaaaaaaa-1111-4111-8111-111111111111';

      const originalFindDay = ContentRepository.findDayForStudent;
      // Database query filters by studentId, returns null if plan belongs to someone else
      ContentRepository.findDayForStudent = jest.fn().mockResolvedValue(null);

      await expect(
        StudyPlannerSubmissionService.getDay(planDayId, otherStudentId, dummySchoolId)
      ).rejects.toThrow('PLAN_DAY_NOT_FOUND');

      ContentRepository.findDayForStudent = originalFindDay;
    });

    test('P5B-18: getActivePlan with School A filters out subjects of School B', async () => {
      const originalQuery = pool.query;
      let capturedSql = '';

      pool.query = jest.fn().mockImplementation((sql, params) => {
        capturedSql = sql;
        return Promise.resolve({ rows: [] });
      });

      await StudyPlannerRepository.getActivePlan(dummyStudentId, dummySubjectId, dummySchoolId);

      expect(capturedSql).toContain('JOIN subjects s ON s.id = sp.subject_id');
      expect(capturedSql).toContain('s.school_id =');

      pool.query = originalQuery;
    });
  });

  describe('Content Repository Security & Canonical Conditions', () => {
    test('findDiagnosticSources queries only approved canonical topics and verifies deck accessibility', async () => {
      const originalQuery = pool.query;
      let capturedSql = '';

      pool.query = jest.fn().mockImplementation((sql, params) => {
        capturedSql = sql;
        return Promise.resolve({ rows: [] });
      });

      await ContentRepository.findDiagnosticSources(dummyStudentId, dummySubjectId, topicA.topicId, dummySchoolId);

      expect(capturedSql).toContain("t.status = 'approved'");
      expect(capturedSql).toContain('(t.review_required = false OR t.review_required IS NULL)');
      expect(capturedSql).toContain('t.parent_id IS NULL');
      expect(capturedSql).toContain('t.is_active = true');
      expect(capturedSql).toContain("fct.review_status = 'approved'");
      expect(capturedSql).toContain('fd.is_public = true');
      expect(capturedSql).toContain('flashcard_deck_class_access');

      pool.query = originalQuery;
    });

    test('findAccessibleCardCountsByTopics uses composite key DISTINCT ON (fct.flashcard_id), filters multiple_choice without invalid columns', async () => {
      const originalQuery = pool.query;
      let capturedSql = '';

      pool.query = jest.fn().mockImplementation((sql, params) => {
        capturedSql = sql;
        return Promise.resolve({ rows: [] });
      });

      await LearningRepository.findAccessibleCardCountsByTopics(dummyStudentId, dummySubjectId, dummySchoolId, [topicA.topicId]);

      expect(capturedSql).toContain('DISTINCT ON (fct.flashcard_id)');
      expect(capturedSql).toContain('COUNT(DISTINCT fc.id)');
      expect(capturedSql).toContain("fc.type = 'multiple_choice'");
      expect(capturedSql).not.toContain('fc.topic_id');
      expect(capturedSql).not.toContain('fct.id');
      expect(capturedSql).not.toContain('flashcards.topic_id');

      pool.query = originalQuery;
    });
  });
});
