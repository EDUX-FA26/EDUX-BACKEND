const { calculateTopicAnalytics } = require('./topicAnalytics.service');

const topic = { id: 'topic-1', name: 'JSON', parent_id: null };
const now = new Date('2026-10-14T12:00:00Z');
const answer = (id, card, correct, submittedAt = '2026-10-10T00:00:00Z') => ({ answer_id: id, flashcard_id: card, is_correct: correct, submitted_at: submittedAt });

describe('Topic analytics heuristic', () => {
  test('uses all attempts for accuracy but only the latest answer for each distinct card in mastery', () => {
    const result = calculateTopicAnalytics(topic, [
      answer('a1', 'c1', false, '2026-10-01T00:00:00Z'), answer('a2', 'c1', true, '2026-10-10T00:00:00Z'),
      answer('a3', 'c2', true), answer('a4', 'c3', false),
    ], now);
    expect(result).toMatchObject({ totalAttempts: 4, distinctQuestionCount: 3, correctAnswers: 2, accuracy: 50, masteryEstimate: 56.25, priority: 'medium', needsReview: true });
  });

  test('does not claim mastery with fewer than three distinct Flashcards even with repeated attempts', () => {
    const result = calculateTopicAnalytics(topic, [answer('a1', 'c1', false), answer('a2', 'c1', false), answer('a3', 'c1', false)], now);
    expect(result).toMatchObject({ totalAttempts: 3, distinctQuestionCount: 1, accuracy: 0, masteryEstimate: null, insufficientEvidence: true, priority: 'insufficient_evidence', needsReview: false });
  });

  test('uses approved-topic rows independently so one Flashcard can contribute to multiple topics', () => {
    const json = calculateTopicAnalytics(topic, [answer('a1', 'c1', true), answer('a2', 'c2', true), answer('a3', 'c3', true)], now);
    const parsing = calculateTopicAnalytics({ id: 'topic-2', name: 'Parsing' }, [answer('a1', 'c1', true), answer('a2', 'c2', true), answer('a3', 'c3', true)], now);
    expect(json.masteryEstimate).toBe(68.75);
    expect(parsing.masteryEstimate).toBe(68.75);
  });

  test('applies configured priority thresholds consistently', () => {
    const threeWrong = calculateTopicAnalytics(topic, [answer('1', 'a', false), answer('2', 'b', false), answer('3', 'c', false)], now);
    const fourWrong = calculateTopicAnalytics(topic, [answer('1', 'a', false), answer('2', 'b', false), answer('3', 'c', false), answer('4', 'd', false)], now);
    const fiveWrong = calculateTopicAnalytics(topic, [answer('1', 'a', false), answer('2', 'b', false), answer('3', 'c', false), answer('4', 'd', false), answer('5', 'e', false)], now);
    expect(threeWrong).toMatchObject({ masteryEstimate: 31.25, priority: 'medium', needsReview: true });
    expect(fourWrong).toMatchObject({ masteryEstimate: 27.78, priority: 'medium', needsReview: true });
    expect(fiveWrong).toMatchObject({ masteryEstimate: 25, priority: 'high', needsReview: true });
  });

  test('reports trend only with three distinct questions in both windows', () => {
    const improving = calculateTopicAnalytics(topic, [
      answer('r1', 'r1', true, '2026-10-10T00:00:00Z'), answer('r2', 'r2', true, '2026-10-09T00:00:00Z'), answer('r3', 'r3', true, '2026-10-08T00:00:00Z'),
      answer('p1', 'p1', false, '2026-09-10T00:00:00Z'), answer('p2', 'p2', false, '2026-09-09T00:00:00Z'), answer('p3', 'p3', false, '2026-09-08T00:00:00Z'),
    ], now);
    expect(improving.trend).toBe('improving');
  });
});
