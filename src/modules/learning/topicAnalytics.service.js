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

function calculateTopicAnalytics(topic, rows, now = new Date()) {
  const attempts = rows.length;
  const correctAnswers = rows.filter((row) => row.is_correct).length;
  const latest = latestByCard(rows);
  const distinctQuestionCount = latest.length;
  const accuracy = attempts ? round((correctAnswers / attempts) * 100) : null;
  const hasEvidence = distinctQuestionCount >= MIN_DISTINCT_EVIDENCE;
  const rawLatestScore = latest.length ? latest.reduce((sum, row) => sum + outcomePercent(row), 0) / latest.length : null;
  const masteryEstimate = hasEvidence
    ? round(((rawLatestScore * distinctQuestionCount) + (PRIOR_MASTERY * PRIOR_WEIGHT)) / (distinctQuestionCount + PRIOR_WEIGHT))
    : null;
  let priority = 'insufficient_evidence';
  if (hasEvidence && distinctQuestionCount >= HIGH_PRIORITY_DISTINCT && masteryEstimate < 50) priority = 'high';
  else if (hasEvidence && masteryEstimate < 70) priority = 'medium';
  else if (hasEvidence) priority = 'low';
  return {
    topicId: topic.id,
    topicName: topic.name,
    parentTopicId: topic.parent_id || null,
    totalAttempts: attempts,
    evidenceCount: attempts,
    distinctQuestionCount,
    correctAnswers,
    incorrectAnswers: attempts - correctAnswers,
    accuracy,
    masteryEstimate,
    masteryMethod: 'latest_per_distinct_flashcard_with_neutral_prior',
    insufficientEvidence: !hasEvidence,
    trend: trendFor(rows, now),
    needsReview: priority === 'high' || priority === 'medium',
    priority,
  };
}

module.exports = { calculateTopicAnalytics, MIN_DISTINCT_EVIDENCE, HIGH_PRIORITY_DISTINCT, PRIOR_WEIGHT, PRIOR_MASTERY };
