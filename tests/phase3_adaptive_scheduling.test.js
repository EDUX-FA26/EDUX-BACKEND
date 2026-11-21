const test = require('node:test');
const assert = require('node:assert/strict');
const { makeStudyPlan7Days, makeStudyPlanDays } = require('../src/modules/learning/studyPlanner.core');

const dummySubjectId = '22222222-2222-4222-8222-222222222222';

const topicA = {
  topicId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  topicCode: 'TOPIC_A',
  topicName: 'Giải tích — Đạo hàm',
  masteryStatus: 'developing',
  masteryEstimate: 45,
  needsReview: true,
  priority: 'high',
  accessibleCardCount: 10,
};

const topicB = {
  topicId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  topicCode: 'TOPIC_B',
  topicName: 'Giải tích — Tích phân',
  masteryStatus: 'mastered',
  masteryEstimate: 85,
  needsReview: false,
  priority: 'low',
  accessibleCardCount: 12,
};

const topicC = {
  topicId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  topicCode: 'TOPIC_C',
  topicName: 'Giải tích — Giới hạn',
  masteryStatus: 'not_assessed',
  masteryEstimate: null,
  needsReview: false,
  accessibleCardCount: 8,
};

const topicZeroCardsAudit = {
  topicId: 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz',
  topicCode: 'VNR_FOUNDING',
  topicName: 'Hội nghị thành lập Đảng 1930',
  masteryStatus: 'not_assessed',
  masteryEstimate: null,
  needsReview: false,
  accessibleCardCount: 0, // 0 thẻ flashcard
};

test('Phase 3: Backward compatibility - Standard call without audit topics generates valid 7 days', () => {
  const analytics = {
    subjectId: dummySubjectId,
    topics: [topicA, topicB],
  };

  const plan = makeStudyPlan7Days(analytics);
  assert.equal(plan.durationDays, 7);
  assert.equal(plan.days.length, 7);
  assert.deepEqual(plan.days.map(d => d.day), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(plan.days[0].topicId, topicA.topicId);
  assert.equal(plan.days[0].activity, 'practice');
});

test('Phase 3: Priority Queue - Audit topic is scheduled on the earliest available day (Day 1)', () => {
  const analytics = {
    subjectId: dummySubjectId,
    topics: [topicA, topicB, topicC],
  };

  const auditTopics = [
    {
      topic_id: topicC.topicId,
      priority: 'high',
      reason: 'Sinh viên chưa nắm vững định nghĩa giới hạn và tính hội tụ.',
    }
  ];

  const plan = makeStudyPlan7Days(analytics, { auditTopics });
  assert.equal(plan.days.length, 7);
  
  // Day 1 must be Topic C (Lecturer audit topic)
  const day1 = plan.days[0];
  assert.equal(day1.topicId, topicC.topicId);
  assert.equal(day1.activity, 'practice');
  assert.equal(day1.reason.includes('Giảng viên đề xuất củng cố'), true);
  assert.equal(day1.analyticsSnapshot.auditRecommended, true);
});

test('Phase 3: Spaced Repetition - High-priority audit topic repeats after 2-3 days interval', () => {
  const analytics = {
    subjectId: dummySubjectId,
    topics: [topicA, topicB, topicC],
  };

  const auditTopics = [
    {
      topic_id: topicC.topicId,
      priority: 'high',
      reason: 'Lỗ hổng kiến thức nghiêm trọng.',
    }
  ];

  const plan = makeStudyPlan7Days(analytics, { auditTopics, totalDays: 7 });
  
  // Topic C appears at Day 1
  assert.equal(plan.days[0].topicId, topicC.topicId);

  // Spaced repetition slot at Day 4 (index 3)
  const day4 = plan.days[3];
  assert.equal(day4.topicId, topicC.topicId);
  assert.equal(day4.activity, 'practice');
  assert.equal(day4.reason.includes('Luyện tập củng cố nâng cao theo đề xuất của Giảng viên'), true);
});

test('Phase 3: Zero-Card Audit Topic - Is NOT dropped and gets scheduled with targetQuestions = 5', () => {
  const analytics = {
    subjectId: dummySubjectId,
    topics: [topicZeroCardsAudit, topicB],
  };

  const auditTopics = [
    {
      topic_id: topicZeroCardsAudit.topicId,
      priority: 'medium',
      reason: 'Sinh viên thiếu luận cứ lịch sử.',
    }
  ];

  const plan = makeStudyPlan7Days(analytics, { auditTopics });
  
  // Must include the zero card topic because it is endorsed by Lecturer
  const scheduledTopics = plan.days.map(d => d.topicId);
  assert.equal(scheduledTopics.includes(topicZeroCardsAudit.topicId), true);
  
  const auditDay = plan.days.find(d => d.topicId === topicZeroCardsAudit.topicId);
  assert.equal(auditDay.targetQuestions, 5); // Default 5 questions for pure topic AI gen
});

test('Phase 3: Zero-Card Non-Audit Topic throws NO_SCHEDULABLE_TOPICS if no other cards available', () => {
  const analytics = {
    subjectId: dummySubjectId,
    topics: [topicZeroCardsAudit],
  };

  assert.throws(() => {
    makeStudyPlan7Days(analytics, { auditTopics: [] });
  }, /NO_SCHEDULABLE_TOPICS/);
});

test('Phase 3: Variable totalDays (K days) & startDayNumber (for in-place re-alignment)', () => {
  const analytics = {
    subjectId: dummySubjectId,
    topics: [topicA, topicB],
  };

  // Remaining 5 days, starting from Day 3
  const plan = makeStudyPlanDays(analytics, {
    totalDays: 5,
    startDayNumber: 3,
  });

  assert.equal(plan.durationDays, 5);
  assert.equal(plan.days.length, 5);
  assert.deepEqual(plan.days.map(d => d.day), [3, 4, 5, 6, 7]);
});

test('Phase 3: Anti-Collision - Adjacent days do not share identical topic when multiple topics exist', () => {
  const analytics = {
    subjectId: dummySubjectId,
    topics: [topicA, topicB, topicC],
  };

  const plan = makeStudyPlan7Days(analytics);
  for (let i = 1; i < plan.days.length; i++) {
    assert.notEqual(plan.days[i].topicId, plan.days[i - 1].topicId);
  }
});
