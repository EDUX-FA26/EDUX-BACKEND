const REVIEW_DAYS = new Set([1, 3, 5, 7]);

function makeStudyPlan7Days(analytics) {
  if (
    !analytics ||
    !analytics.subjectId ||
    !Array.isArray(analytics.topics)
  ) {
    throw new Error('INVALID_ANALYTICS');
  }

  const allTopics = analytics.topics;

  if (allTopics.length === 0) {
    throw new Error('NO_TOPICS_AVAILABLE');
  }

  // Lọc chỉ các topic có thẻ học sinh truy cập được (nếu trường accessibleCardCount được cung cấp)
  const candidateTopics = allTopics.filter(topic => {
    if (topic.accessibleCardCount !== undefined) {
      return Number(topic.accessibleCardCount) > 0;
    }
    return true;
  });

  if (candidateTopics.length === 0) {
    throw new Error('NO_SCHEDULABLE_TOPICS');
  }

  // 1. Nhóm Topic cần luyện tập (developing / needs review / high-medium priority có evidence)
  const developingTopics = candidateTopics
    .filter(topic =>
      topic.masteryStatus === 'developing' ||
      topic.needsReview === true ||
      (!topic.insufficientEvidence && ['high', 'medium'].includes(topic.priority))
    )
    .sort((a, b) => {
      const priorityScore = { high: 0, medium: 1 };
      const aScore = priorityScore[a.priority] ?? 2;
      const bScore = priorityScore[b.priority] ?? 2;
      if (aScore !== bScore) return aScore - bScore;

      const aMastery = a.masteryEstimate ?? 100;
      const bMastery = b.masteryEstimate ?? 100;
      if (aMastery !== bMastery) return aMastery - bMastery;

      const aEvidence = a.evidenceCount ?? 0;
      const bEvidence = b.evidenceCount ?? 0;
      if (aEvidence !== bEvidence) return aEvidence - bEvidence;

      return String(a.topicId || '').localeCompare(String(b.topicId || ''));
    });

  // 2. Nhóm Topic chưa đủ dữ liệu (not_assessed / insufficient_data) -> Diagnostic
  const diagnosticTopics = candidateTopics
    .filter(topic =>
      !developingTopics.includes(topic) &&
      (
        topic.masteryStatus === 'not_assessed' ||
        topic.masteryStatus === 'insufficient_data' ||
        topic.insufficientEvidence === true
      )
    )
    .sort((a, b) => {
      const aEvidence = a.evidenceCount ?? 0;
      const bEvidence = b.evidenceCount ?? 0;
      if (aEvidence !== bEvidence) return aEvidence - bEvidence;

      return String(a.topicId || '').localeCompare(String(b.topicId || ''));
    });

  // 3. Nhóm Topic đã nắm vững (mastered) hoặc còn lại -> Ôn tập duy trì (review)
  const maintenanceTopics = candidateTopics
    .filter(topic =>
      !developingTopics.includes(topic) &&
      !diagnosticTopics.includes(topic)
    )
    .sort((a, b) => {
      const aMastery = a.masteryEstimate ?? 100;
      const bMastery = b.masteryEstimate ?? 100;
      if (aMastery !== bMastery) return aMastery - bMastery;

      return String(a.topicId || '').localeCompare(String(b.topicId || ''));
    });

  const days = [];
  let devIdx = 0;
  let diagIdx = 0;
  let maintIdx = 0;

  for (let day = 1; day <= 7; day++) {
    let topic = null;
    let activity = null;

    if (REVIEW_DAYS.has(day)) {
      // Ngày lẻ (1, 3, 5, 7): Ưu tiên practice (developing)
      if (developingTopics.length > 0) {
        topic = developingTopics[devIdx % developingTopics.length];
        devIdx++;
        activity = 'practice';
      } else if (diagnosticTopics.length > 0) {
        topic = diagnosticTopics[diagIdx % diagnosticTopics.length];
        diagIdx++;
        activity = 'diagnostic';
      } else if (maintenanceTopics.length > 0) {
        topic = maintenanceTopics[maintIdx % maintenanceTopics.length];
        maintIdx++;
        activity = 'review';
      }
    } else {
      // Ngày chẵn (2, 4, 6): Ưu tiên diagnostic hoặc ôn tập duy trì (review)
      if (diagnosticTopics.length > 0) {
        topic = diagnosticTopics[diagIdx % diagnosticTopics.length];
        diagIdx++;
        activity = 'diagnostic';
      } else if (maintenanceTopics.length > 0) {
        topic = maintenanceTopics[maintIdx % maintenanceTopics.length];
        maintIdx++;
        activity = 'review';
      } else if (developingTopics.length > 0) {
        topic = developingTopics[devIdx % developingTopics.length];
        devIdx++;
        activity = 'practice';
      }
    }

    if (!topic) {
      throw new Error('NO_SCHEDULABLE_TOPICS');
    }

    // Tránh trùng topic ở 2 ngày liên tiếp nếu có nhiều hơn 1 topic khả dụng
    if (days.length > 0 && candidateTopics.length > 1 && days[days.length - 1].topicId === topic.topicId) {
      // Tìm topic thay thế từ danh sách candidate
      const nextCandidate = candidateTopics.find(t => t.topicId !== topic.topicId);
      if (nextCandidate) {
        topic = nextCandidate;
        if (developingTopics.includes(topic)) {
          activity = 'practice';
        } else if (diagnosticTopics.includes(topic)) {
          activity = 'diagnostic';
        } else {
          activity = 'review';
        }
      }
    }

    const isDiagnostic = activity === 'diagnostic';
    const isPractice = activity === 'practice';

    const defaultTarget = isDiagnostic ? 3 : 5;
    const targetQuestions = topic.accessibleCardCount != null
      ? Math.max(1, Math.min(defaultTarget, Number(topic.accessibleCardCount)))
      : defaultTarget;

    const durationMinutes = isDiagnostic ? 10 : 15;

    let reason;
    if (isPractice) {
      reason = topic.masteryEstimate !== null
        ? `Mastery dưới ngưỡng (${topic.masteryEstimate}%); ưu tiên luyện tập cải thiện.`
        : 'Chủ đề đang rèn luyện; ưu tiên luyện tập cải thiện.';
    } else if (isDiagnostic) {
      reason = topic.masteryStatus === 'insufficient_data'
        ? 'Chưa đủ câu hỏi đánh giá độc lập; cần làm bài khảo sát ban đầu.'
        : 'Chủ đề chưa có dữ liệu đánh giá; cần khảo sát ban đầu.';
    } else {
      reason = topic.masteryEstimate !== null
        ? `Chủ đề đã nắm vững (${topic.masteryEstimate}%); ôn tập duy trì kiến thức.`
        : 'Chủ đề đã đạt ngưỡng; ôn tập duy trì kiến thức.';
    }

    days.push({
      day,
      topicId: topic.topicId,
      topicCode: topic.topicCode || null,
      topicName: topic.topicName,
      activity,
      durationMinutes,
      targetQuestions,
      reason,
      contentStatus: 'ready',
      analyticsSnapshot: {
        accuracy: topic.accuracy ?? null,
        masteryEstimate: topic.masteryEstimate ?? null,
        masteryStatus: topic.masteryStatus || null,
        evidenceCount: topic.evidenceCount ?? 0,
        priority: topic.priority || null,
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
