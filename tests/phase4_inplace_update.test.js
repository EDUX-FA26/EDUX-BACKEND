const test = require('node:test');
const assert = require('node:assert/strict');
const StudyPlannerService = require('../src/modules/learning/studyPlanner.service');
const StudyPlannerRepository = require('../src/modules/learning/studyPlanner.repository');
const LearningRepository = require('../src/modules/learning/learning.repository');
const { pool } = require('../src/config/db.config');

const dummyStudentId = '11111111-1111-4111-8111-111111111111';
const dummySubjectId = '22222222-2222-4222-8222-222222222222';
const dummySchoolId = '33333333-3333-4333-8333-333333333333';

const topicA = {
  topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  topicName: 'Topic A - Flashcard Weak',
  priority: 'high',
  masteryStatus: 'developing',
  accessibleCardCount: 5,
};

const topicB = {
  topicId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  topicName: 'Topic B - Mastered',
  priority: 'low',
  masteryStatus: 'mastered',
  accessibleCardCount: 5,
};

const topicAudit = {
  topicId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  topicName: 'Topic C - Lecturer Flagged',
  priority: 'high',
  masteryStatus: 'developing',
  accessibleCardCount: 0, // 0 cards, Pure Topic AI
};

test('Phase 4: In-place Partial Plan Update - Preserves completed days and realigns uncompleted days', async () => {
  // Mock active plan with Day 1 completed, Days 2-7 uncompleted
  const planId = '99999999-9999-4999-8999-999999999999';
  const mockDays = [1, 2, 3, 4, 5, 6, 7].map(d => ({
    planDayId: `00000000-0000-4000-8000-00000000000${d}`,
    day: d,
    topicId: topicB.topicId,
    topicName: topicB.topicName,
    activity: 'review',
    durationMinutes: 15,
    targetQuestions: 5,
    reason: 'Initial schedule',
    contentStatus: d === 1 ? 'ready' : 'pending',
    studyDate: `2026-11-${17 + d}`,
    isCompleted: d === 1, // Day 1 completed
    submission: d === 1 ? { scorePercent: 100, submittedAt: '2026-11-18T10:00:00Z' } : null,
  }));

  const mockActivePlan = {
    planId,
    subjectId: dummySubjectId,
    startsOn: '2026-11-18',
    status: 'draft',
    durationDays: 7,
    completedDays: 1,
    progressPercent: 14,
    days: mockDays,
  };

  const origGetActivePlan = StudyPlannerRepository.getActivePlan;
  const origUpdateUnsubmittedPlanDays = StudyPlannerRepository.updateUnsubmittedPlanDays;
  const origFindApproved = LearningRepository.findApprovedReviewTopicsByStudent;
  const origFindAccessible = LearningRepository.findAccessibleCardCountsByTopics;

  let updateCalledWith = null;

  try {
    // 1. Mock LearningRepository
    LearningRepository.findApprovedReviewTopicsByStudent = async () => [
      {
        topicId: topicAudit.topicId,
        topic_id: topicAudit.topicId,
        topicName: topicAudit.topicName,
        priority: 'high',
        reason: 'Lecturer noticed gap in assignment',
      },
    ];

    LearningRepository.findAccessibleCardCountsByTopics = async () => {
      const m = new Map();
      m.set(topicA.topicId, 5);
      m.set(topicB.topicId, 5);
      m.set(topicAudit.topicId, 0);
      return m;
    };

    // 2. Mock StudyPlannerRepository
    let activeCallCount = 0;
    StudyPlannerRepository.getActivePlan = async () => {
      activeCallCount++;
      if (activeCallCount === 1) {
        return mockActivePlan;
      }
      // Return refreshed plan reflecting updated uncompleted days
      return {
        ...mockActivePlan,
        days: mockDays.map(d => {
          if (d.day === 1) return d;
          if (d.day === 2) {
            return {
              ...d,
              topicId: topicAudit.topicId,
              topicName: topicAudit.topicName,
              reason: 'Audit Log Giảng viên đề xuất ôn tập (Mức độ: high): Lecturer noticed gap in assignment',
            };
          }
          return d;
        }),
      };
    };

    StudyPlannerRepository.updateUnsubmittedPlanDays = async (payload) => {
      updateCalledWith = payload;
      return payload.updatedDays;
    };

    const analytics = {
      subjectId: dummySubjectId,
      topics: [topicA, topicB, topicAudit],
    };

    const result = await StudyPlannerService.generateForStudent(
      analytics,
      dummyStudentId,
      false,
      dummySchoolId
    );

    // Verify
    assert.strictEqual(result.realigned, true);
    assert.strictEqual(result.created, false);
    assert.strictEqual(result.planId, planId);

    // Day 1 must remain completed with original data
    assert.strictEqual(result.days[0].day, 1);
    assert.strictEqual(result.days[0].isCompleted, true);
    assert.strictEqual(result.days[0].topicId, topicB.topicId);

    // updateUnsubmittedPlanDays must have been called for exactly 6 uncompleted days (Days 2 to 7)
    assert.ok(updateCalledWith);
    assert.strictEqual(updateCalledWith.planId, planId);
    assert.strictEqual(updateCalledWith.updatedDays.length, 6);

    // First updated day (Day 2) should receive the high-priority audit topic
    assert.strictEqual(updateCalledWith.updatedDays[0].dayNumber, 2);
    assert.strictEqual(updateCalledWith.updatedDays[0].topicId, topicAudit.topicId);
  } finally {
    StudyPlannerRepository.getActivePlan = origGetActivePlan;
    StudyPlannerRepository.updateUnsubmittedPlanDays = origUpdateUnsubmittedPlanDays;
    LearningRepository.findApprovedReviewTopicsByStudent = origFindApproved;
    LearningRepository.findAccessibleCardCountsByTopics = origFindAccessible;
  }
});

test('Phase 4: updateUnsubmittedPlanDays in repository deletes unsubmitted questions and updates day fields', async () => {
  const mockQueries = [];
  const mockClient = {
    query: async (sql, params) => {
      mockQueries.push({ sql: sql.trim(), params });
      if (sql.includes('SELECT 1 FROM study_plan_day_submissions')) {
        // First day (day 2) not submitted, day 3 is submitted
        if (params && params[0] === 'day-2-uuid') {
          return { rows: [] };
        }
        return { rows: [{ 1: 1 }] };
      }
      if (sql.includes('UPDATE study_plan_days')) {
        return { rows: [{ id: params[5], topic_id: params[0] }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };

  const origConnect = pool.connect;
  pool.connect = async () => mockClient;

  try {
    const updated = await StudyPlannerRepository.updateUnsubmittedPlanDays({
      planId: 'plan-uuid',
      updatedDays: [
        {
          planDayId: 'day-2-uuid',
          topicId: topicAudit.topicId,
          activity: 'practice',
          durationMinutes: 15,
          targetQuestions: 5,
          reason: 'Lecturer priority',
        },
        {
          planDayId: 'day-3-uuid', // already submitted
          topicId: topicAudit.topicId,
          activity: 'practice',
          durationMinutes: 15,
          targetQuestions: 5,
          reason: 'Should be skipped',
        },
      ],
    });

    assert.strictEqual(updated.length, 1);
    assert.strictEqual(updated[0].id, 'day-2-uuid');

    // Confirm DELETE was executed for day-2-uuid only
    const deleteQueries = mockQueries.filter(q => q.sql.includes('DELETE FROM study_plan_questions'));
    assert.strictEqual(deleteQueries.length, 1);
    assert.deepStrictEqual(deleteQueries[0].params, ['day-2-uuid']);

    // Confirm COMMIT was called
    const hasCommit = mockQueries.some(q => q.sql === 'COMMIT');
    assert.strictEqual(hasCommit, true);
  } finally {
    pool.connect = origConnect;
  }
});

test('Phase 4: createPreview includes approved review topics in generated schedule', async () => {
  const origFindApproved = LearningRepository.findApprovedReviewTopicsByStudent;
  const origFindAccessible = LearningRepository.findAccessibleCardCountsByTopics;

  try {
    LearningRepository.findApprovedReviewTopicsByStudent = async () => [
      {
        topicId: topicAudit.topicId,
        topic_id: topicAudit.topicId,
        topicName: topicAudit.topicName,
        priority: 'high',
        reason: 'Lecturer weak topic recommendation',
      },
    ];

    LearningRepository.findAccessibleCardCountsByTopics = async () => {
      const m = new Map();
      m.set(topicA.topicId, 5);
      m.set(topicB.topicId, 5);
      m.set(topicAudit.topicId, 0);
      return m;
    };

    const analytics = {
      subjectId: dummySubjectId,
      topics: [topicA, topicB, topicAudit],
    };

    const preview = await StudyPlannerService.createPreview(
      analytics,
      dummyStudentId,
      dummySchoolId
    );

    assert.strictEqual(preview.days.length, 7);
    // Day 1 must be the high priority audit topic
    assert.strictEqual(preview.days[0].topicId, topicAudit.topicId);
    assert.ok(preview.days[0].reason.includes('Giảng viên đề xuất củng cố'));
  } finally {
    LearningRepository.findApprovedReviewTopicsByStudent = origFindApproved;
    LearningRepository.findAccessibleCardCountsByTopics = origFindAccessible;
  }
});
