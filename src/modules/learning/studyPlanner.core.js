/**
 * studyPlanner.core.js
 * Core Lập lịch học tập thích ứng (Adaptive Spaced Repetition)
 * Hỗ trợ ưu tiên Topic từ Giảng viên (AI Audit Log), lặp lại ngắt quãng,
 * và lập lịch linh hoạt cho K ngày (1 <= K <= 7).
 */

function makeStudyPlan7Days(analytics, optionsOrAuditTopics = {}) {
  // 1. Chuẩn hóa options đầu vào
  let auditTopics = [];
  let totalDays = 7;
  let startDayNumber = 1;

  if (Array.isArray(optionsOrAuditTopics)) {
    auditTopics = optionsOrAuditTopics;
  } else if (optionsOrAuditTopics && typeof optionsOrAuditTopics === 'object') {
    auditTopics = Array.isArray(optionsOrAuditTopics.auditTopics) ? optionsOrAuditTopics.auditTopics : [];
    totalDays = Number(optionsOrAuditTopics.totalDays) || 7;
    startDayNumber = Number(optionsOrAuditTopics.startDayNumber) || 1;
  }

  if (totalDays < 1 || totalDays > 7) {
    totalDays = 7;
  }

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

  // 2. Map các Topic được Giảng viên/AI đề xuất củng cố từ bài nộp
  const auditTopicsMap = new Map();
  for (const at of auditTopics) {
    const tid = at.topic_id || at.topicId || at.id;
    if (tid) {
      auditTopicsMap.set(tid, at);
    }
  }

  // 3. Lọc danh sách candidate topics:
  // - Topic do giảng viên chỉ định củng cố -> Luôn được chấp nhận, kể cả accessibleCardCount == 0 (hỗ trợ Pure Topic AI Generation)
  // - Topic thông thường -> Yêu cầu accessibleCardCount > 0
  const candidateTopics = allTopics.filter(topic => {
    if (auditTopicsMap.has(topic.topicId)) {
      return true;
    }
    if (topic.accessibleCardCount !== undefined) {
      return Number(topic.accessibleCardCount) > 0;
    }
    return true;
  });

  if (candidateTopics.length === 0) {
    throw new Error('NO_SCHEDULABLE_TOPICS');
  }

  // 4. Phân nhóm các Topic theo Hàng đợi ưu tiên (Priority Queue)

  // Tầng 1: Topic từ Giảng viên có độ ưu tiên cao (Audit High Priority)
  const auditHighTopics = candidateTopics.filter(t => {
    const at = auditTopicsMap.get(t.topicId);
    return at && String(at.priority).toLowerCase() === 'high';
  });

  // Tầng 2: Topic từ Giảng viên có độ ưu tiên trung bình/khác (Audit Medium Priority)
  const auditMediumTopics = candidateTopics.filter(t => {
    const at = auditTopicsMap.get(t.topicId);
    return at && String(at.priority).toLowerCase() !== 'high';
  });

  // Tầng 3: Nhóm Topic cần luyện tập từ Flashcards (developing / needs review / high-medium priority có evidence)
  const developingTopics = candidateTopics
    .filter(topic =>
      !auditTopicsMap.has(topic.topicId) &&
      (
        topic.masteryStatus === 'developing' ||
        topic.needsReview === true ||
        (!topic.insufficientEvidence && ['high', 'medium'].includes(topic.priority))
      )
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

  // Tầng 4: Nhóm Topic chưa đủ dữ liệu (not_assessed / insufficient_data) -> Diagnostic
  const diagnosticTopics = candidateTopics
    .filter(topic =>
      !auditTopicsMap.has(topic.topicId) &&
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

  // Tầng 5: Nhóm Topic đã nắm vững (mastered) hoặc còn lại -> Ôn tập duy trì (review)
  const maintenanceTopics = candidateTopics
    .filter(topic =>
      !auditTopicsMap.has(topic.topicId) &&
      !developingTopics.includes(topic) &&
      !diagnosticTopics.includes(topic)
    )
    .sort((a, b) => {
      const aMastery = a.masteryEstimate ?? 100;
      const bMastery = b.masteryEstimate ?? 100;
      if (aMastery !== bMastery) return aMastery - bMastery;

      return String(a.topicId || '').localeCompare(String(b.topicId || ''));
    });

  // 5. Khởi tạo mảng slots cho totalDays ngày
  const slots = new Array(totalDays).fill(null);

  // BƯỚC A: Phân bổ Topic Giảng viên Ưu tiên Cao (Spaced Repetition)
  for (const topic of auditHighTopics) {
    const at = auditTopicsMap.get(topic.topicId);
    const firstFree = slots.findIndex(s => s === null);
    if (firstFree === -1) break;

    const baseReason = at?.reason
      ? `Giảng viên đề xuất củng cố: ${at.reason}`
      : 'Chủ đề giảng viên yêu cầu củng cố kiến thức trọng tâm.';

    slots[firstFree] = {
      topic,
      activity: 'practice',
      reasonOverride: baseReason,
      isAudit: true,
      priority: 'high',
    };

    // Lặp lại ngắt quãng (Spaced Repetition): Sau 2-3 ngày củng cố lại
    if (totalDays >= 3) {
      const targetRepeatIdx = firstFree + 3 < totalDays ? firstFree + 3 : (firstFree + 2 < totalDays ? firstFree + 2 : -1);
      if (targetRepeatIdx !== -1 && slots[targetRepeatIdx] === null) {
        slots[targetRepeatIdx] = {
          topic,
          activity: 'practice',
          reasonOverride: 'Luyện tập củng cố nâng cao theo đề xuất của Giảng viên.',
          isAudit: true,
          isSpacedRepeat: true,
          priority: 'high',
        };
      }
    }
  }

  // BƯỚC B: Phân bổ Topic Giảng viên Mức Trung bình
  for (const topic of auditMediumTopics) {
    const at = auditTopicsMap.get(topic.topicId);
    const firstFree = slots.findIndex(s => s === null);
    if (firstFree === -1) break;

    const baseReason = at?.reason
      ? `Giảng viên đề xuất củng cố: ${at.reason}`
      : 'Chủ đề giảng viên khuyến nghị ôn tập thêm.';

    slots[firstFree] = {
      topic,
      activity: 'practice',
      reasonOverride: baseReason,
      isAudit: true,
      priority: 'medium',
    };
  }

  // BƯỚC C: Lấp đầy các ngày còn lại từ Hàng đợi ưu tiên (Developing -> Diagnostic -> Maintenance)
  let devIdx = 0;
  let diagIdx = 0;
  let maintIdx = 0;

  for (let i = 0; i < totalDays; i++) {
    if (slots[i] !== null) continue;

    const prevTopicId = i > 0 && slots[i - 1] ? slots[i - 1].topic.topicId : null;
    let selected = null;
    let activity = null;

    // Xây dựng danh sách ưu tiên ứng viên cho ngày này
    const poolChoices = [];

    // Nếu hôm trước đã học developing và có các topic nhóm khác, đan xen để tạo nhịp điệu học tập phong phú
    const prevWasDeveloping = prevTopicId && developingTopics.some(t => t.topicId === prevTopicId);
    if (prevWasDeveloping && (diagnosticTopics.length > 0 || maintenanceTopics.length > 0)) {
      if (diagnosticTopics.length > 0) poolChoices.push({ list: diagnosticTopics, act: 'diagnostic' });
      if (maintenanceTopics.length > 0) poolChoices.push({ list: maintenanceTopics, act: 'review' });
      if (developingTopics.length > 0) poolChoices.push({ list: developingTopics, act: 'practice' });
    } else {
      if (developingTopics.length > 0) poolChoices.push({ list: developingTopics, act: 'practice' });
      if (diagnosticTopics.length > 0) poolChoices.push({ list: diagnosticTopics, act: 'diagnostic' });
      if (maintenanceTopics.length > 0) poolChoices.push({ list: maintenanceTopics, act: 'review' });
    }

    // Nếu các nhóm trên đều trống, có thể dùng lại topic audit (nếu có)
    if (poolChoices.length === 0) {
      if (auditHighTopics.length > 0) poolChoices.push({ list: auditHighTopics, act: 'practice' });
      if (auditMediumTopics.length > 0) poolChoices.push({ list: auditMediumTopics, act: 'practice' });
    }

    // Chọn ứng viên không trùng với ngày liền trước (nếu candidateTopics.length > 1)
    for (const choice of poolChoices) {
      const cand = choice.list.find(t => t.topicId !== prevTopicId) || (candidateTopics.length === 1 ? choice.list[0] : null);
      if (cand) {
        selected = cand;
        activity = choice.act;
        break;
      }
    }

    // Fallback an toàn nếu tất cả các lựa chọn đều trùng prevTopicId
    if (!selected) {
      selected = candidateTopics.find(t => t.topicId !== prevTopicId) || candidateTopics[0];
      if (developingTopics.includes(selected)) {
        activity = 'practice';
      } else if (diagnosticTopics.includes(selected)) {
        activity = 'diagnostic';
      } else {
        activity = 'review';
      }
    }

    slots[i] = { topic: selected, activity };
  }

  // 6. Xây dựng cấu trúc danh sách days hoàn chỉnh
  const days = [];

  for (let i = 0; i < totalDays; i++) {
    const slot = slots[i];
    const topic = slot.topic;
    const activity = slot.activity;
    const isDiagnostic = activity === 'diagnostic';
    const isPractice = activity === 'practice';
    const isAudit = Boolean(slot.isAudit);

    const defaultTarget = isDiagnostic ? 3 : 5;
    let targetQuestions = defaultTarget;

    if (topic.accessibleCardCount != null && !isAudit) {
      targetQuestions = Math.max(1, Math.min(defaultTarget, Number(topic.accessibleCardCount)));
    } else if (isAudit && topic.accessibleCardCount != null && Number(topic.accessibleCardCount) > 0) {
      targetQuestions = Math.max(1, Math.min(defaultTarget, Number(topic.accessibleCardCount)));
    }

    const durationMinutes = isDiagnostic ? 10 : 15;

    let reason = slot.reasonOverride;
    if (!reason) {
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
    }

    days.push({
      day: startDayNumber + i,
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
        auditRecommended: isAudit,
      }
    });
  }

  return {
    subjectId: analytics.subjectId,
    durationDays: totalDays,
    status: 'draft',
    basedOnAnalytics: true,
    days
  };
}

module.exports = {
  makeStudyPlan7Days,
  makeStudyPlanDays: makeStudyPlan7Days,
};

