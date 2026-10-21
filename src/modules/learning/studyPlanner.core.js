
const REVIEW_DAYS = new Set([1, 3, 5, 7]);

function makeStudyPlan7Days(analytics) {
  if (
    !analytics ||
    !analytics.subjectId ||
    !Array.isArray(analytics.topics)
  ) {
    throw new Error('INVALID_ANALYTICS');
  }

  const topics = analytics.topics;

  if (topics.length === 0) {
    throw new Error('NO_TOPICS_AVAILABLE');
  }

  // 1. Các Topic cần ôn tập, đã có đủ bằng chứng
  const weakTopics = topics
    .filter(topic =>
      !topic.insufficientEvidence &&
      (
        topic.needsReview === true ||
        ['high', 'medium'].includes(topic.priority)
      )
    )
    .sort((a, b) => {
      const priorityScore = { high: 0, medium: 1 };

      const aScore = priorityScore[a.priority] ?? 2;
      const bScore = priorityScore[b.priority] ?? 2;

      if (aScore !== bScore) {
        return aScore - bScore;
      }

      return (a.masteryEstimate ?? 100) -
             (b.masteryEstimate ?? 100);
    });

  // 2. Topic chưa đủ dữ liệu không được coi là yếu
  const diagnosticTopics = topics
    .filter(topic => topic.insufficientEvidence === true)
    .sort((a, b) =>
      (a.evidenceCount ?? 0) -
      (b.evidenceCount ?? 0)
    );

  // 3. Topic còn lại: luyện tập duy trì
  const maintenanceTopics = topics.filter(topic =>
    !weakTopics.includes(topic) &&
    !diagnosticTopics.includes(topic)
  );

  const days = [];

  let reviewIndex = 0;
  let diagnosticIndex = 0;
  let maintenanceIndex = 0;

  for (let day = 1; day <= 7; day++) {
    let topic = null;
    let activity = null;

    if (
      REVIEW_DAYS.has(day) &&
      weakTopics.length > 0
    ) {
      topic = weakTopics[
        reviewIndex % weakTopics.length
      ];

      reviewIndex++;
      activity = 'review';

    } else if (diagnosticTopics.length > 0) {
      topic = diagnosticTopics[
        diagnosticIndex % diagnosticTopics.length
      ];

      diagnosticIndex++;
      activity = 'diagnostic';

    } else if (weakTopics.length > 0) {
      topic = weakTopics[
        reviewIndex % weakTopics.length
      ];

      reviewIndex++;
      activity = 'review';

    } else if (maintenanceTopics.length > 0) {
      topic = maintenanceTopics[
        maintenanceIndex % maintenanceTopics.length
      ];

      maintenanceIndex++;
      activity = 'practice';
    }

    if (!topic) {
      throw new Error('NO_SCHEDULABLE_TOPICS');
    }

    const isDiagnostic = activity === 'diagnostic';

    days.push({
      day,
      topicId: topic.topicId,
      topicName: topic.topicName,

      activity,

      durationMinutes: isDiagnostic ? 10 : 15,
      targetQuestions: isDiagnostic ? 3 : 5,

      reason: isDiagnostic
        ? 'Chưa đủ dữ liệu để đánh giá năng lực.'
        : activity === 'review'
          ? 'Ưu tiên ôn tập dựa trên kết quả học tập.'
          : 'Luyện tập duy trì kiến thức.',

      // Dữ liệu gốc để giải thích việc đề xuất
      analyticsSnapshot: {
        accuracy: topic.accuracy,
        masteryEstimate: topic.masteryEstimate,
        evidenceCount: topic.evidenceCount,
        priority: topic.priority
      }
    });
  }

  return {
    subjectId: analytics.subjectId,
    durationDays: 7,
    status: 'draft',
    basedOnAnalytics: true,
    days
  };
}

module.exports = {
  makeStudyPlan7Days
};
