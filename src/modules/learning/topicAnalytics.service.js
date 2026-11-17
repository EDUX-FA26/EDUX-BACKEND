const MIN_DISTINCT_EVIDENCE = 3;
const HIGH_PRIORITY_DISTINCT = 5;
const PRIOR_WEIGHT = 5;
const PRIOR_MASTERY = 50;
const TREND_WINDOW_DAYS = 30;

function round(value) { return Number(value.toFixed(2)); }
function outcomePercent(answer) { return answer.is_correct ? 100 : 0; }

function latestByCard(rows) {
  const latest = new Map();
  [...rows].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at) || String(b.answer_id).localeCompare(String(a.answer_id)))
    .forEach((row) => { if (!latest.has(row.flashcard_id)) latest.set(row.flashcard_id, row); });
  return [...latest.values()];
}

function trendFor(rows, now) {
  const end = new Date(now);
  const recentStart = new Date(end); recentStart.setUTCDate(recentStart.getUTCDate() - TREND_WINDOW_DAYS);
  const previousStart = new Date(recentStart); previousStart.setUTCDate(previousStart.getUTCDate() - TREND_WINDOW_DAYS);
  const recent = latestByCard(rows.filter((r) => new Date(r.submitted_at) >= recentStart && new Date(r.submitted_at) <= end));
  const previous = latestByCard(rows.filter((r) => new Date(r.submitted_at) >= previousStart && new Date(r.submitted_at) < recentStart));
  if (recent.length < MIN_DISTINCT_EVIDENCE || previous.length < MIN_DISTINCT_EVIDENCE) return 'insufficient_evidence';
  const recentScore = recent.reduce((sum, row) => sum + outcomePercent(row), 0) / recent.length;
  const previousScore = previous.reduce((sum, row) => sum + outcomePercent(row), 0) / previous.length;
  if (recentScore - previousScore >= 5) return 'improving';
  if (previousScore - recentScore >= 5) return 'declining';
  return 'stable';
}

function calculateTopicAnalytics(topic, rows = [], now = new Date(), reviewData = null) {
  const attempts = rows.length;
  const reviewCount = reviewData ? Number(reviewData.total_reviews || 0) : 0;
  const correctAnswers = rows.filter((row) => row.is_correct).length;
  const latest = latestByCard(rows);
  const distinctQuestionCount = latest.length;
  const accuracy = attempts ? round((correctAnswers / attempts) * 100) : null;
  const hasEvidence = distinctQuestionCount >= MIN_DISTINCT_EVIDENCE;
  const rawLatestScore = latest.length ? latest.reduce((sum, row) => sum + outcomePercent(row), 0) / latest.length : null;
  const masteryEstimate = hasEvidence
    ? round(((rawLatestScore * distinctQuestionCount) + (PRIOR_MASTERY * PRIOR_WEIGHT)) / (distinctQuestionCount + PRIOR_WEIGHT))
    : null;

  // Determine lastStudiedAt from latest quiz answer or SRS review
  let lastStudiedAt = null;
  if (rows.length > 0) {
    const latestQuizTime = rows.reduce((max, r) => {
      const t = r.submitted_at ? new Date(r.submitted_at) : null;
      return t && t > max ? t : max;
    }, new Date(0));
    if (latestQuizTime.getTime() > 0) lastStudiedAt = latestQuizTime.toISOString();
  }
  if (reviewData?.last_reviewed_at) {
    const revTime = new Date(reviewData.last_reviewed_at);
    if (!lastStudiedAt || revTime > new Date(lastStudiedAt)) {
      lastStudiedAt = revTime.toISOString();
    }
  }

  const totalActivity = attempts + reviewCount;

  // State classification theo Phase 5:
  // 1. not_assessed: chưa có attempt hoặc review nào
  // 2. insufficient_data: có activity nhưng distinctQuestionCount < 3
  // 3. developing: distinctQuestionCount >= 3 nhưng masteryEstimate < 70%
  // 4. mastered: distinctQuestionCount >= 3 và masteryEstimate >= 70%
  let masteryStatus = 'not_assessed';
  let priority = 'diagnostic';
  let dataQuality = 'no_data';
  let needsReview = false;

  if (totalActivity === 0) {
    masteryStatus = 'not_assessed';
    priority = 'insufficient_evidence';
    dataQuality = 'no_data';
    needsReview = false;
  } else if (!hasEvidence) {
    masteryStatus = 'insufficient_data';
    priority = 'insufficient_evidence';
    dataQuality = 'insufficient';
    needsReview = false;
  } else if (masteryEstimate !== null && masteryEstimate >= 70) {
    masteryStatus = 'mastered';
    priority = 'low';
    dataQuality = 'sufficient';
    needsReview = false;
  } else {
    masteryStatus = 'developing';
    priority = (distinctQuestionCount >= HIGH_PRIORITY_DISTINCT && masteryEstimate < 50) ? 'high' : 'medium';
    dataQuality = 'sufficient';
    needsReview = true;
  }

  return {
    topicId: topic.id,
    topicCode: topic.code || null,
    topicName: topic.name,
    parentTopicId: topic.parent_id || null,
    totalAttempts: attempts,
    totalReviews: reviewCount,
    totalQuizAnswers: attempts,
    evidenceCount: attempts,
    distinctQuestionCount,
    correctAnswers,
    incorrectAnswers: attempts - correctAnswers,
    accuracy,
    accuracyPercent: accuracy,
    masteryEstimate,
    masteryStatus,
    masteryMethod: 'latest_per_distinct_flashcard_with_neutral_prior',
    insufficientEvidence: !hasEvidence,
    trend: trendFor(rows, now),
    needsReview,
    priority,
    lastStudiedAt,
    dataQuality,
  };
}

module.exports = { calculateTopicAnalytics, MIN_DISTINCT_EVIDENCE, HIGH_PRIORITY_DISTINCT, PRIOR_WEIGHT, PRIOR_MASTERY };
