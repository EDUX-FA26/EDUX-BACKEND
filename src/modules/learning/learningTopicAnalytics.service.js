const LearningRepository = require('./learning.repository');
const { calculateTopicAnalytics } = require('./topicAnalytics.service');

const LearningTopicAnalyticsService = {
  async getStudentTopicPerformance(studentId, subjectId, schoolId = null, now = new Date()) {
    // If caller passed (studentId, subjectId, now) where 3rd arg is Date or string
    let actualSchoolId = schoolId;
    let actualNow = now;
    if (schoolId instanceof Date) {
      actualNow = schoolId;
      actualSchoolId = null;
    }

    const subject = await LearningRepository.findSubjectById(subjectId, actualSchoolId);
    if (!subject) throw new Error('SUBJECT_NOT_FOUND');
    if (!await LearningRepository.isStudentActiveInSubject(studentId, subjectId, actualSchoolId)) {
      throw new Error('SUBJECT_ACCESS_FORBIDDEN');
    }

    const repoArgs = actualSchoolId ? [subjectId, actualSchoolId] : [subjectId];
    const studentRepoArgs = actualSchoolId ? [studentId, subjectId, actualSchoolId] : [studentId, subjectId];

    const [topics, answers, reviewSummary, unclassifiedSummary] = await Promise.all([
      LearningRepository.findActiveTopicsBySubject(...repoArgs),
      LearningRepository.findSubmittedMultipleChoiceTopicAnswers(...studentRepoArgs),
      LearningRepository.findTopicReviewCountsBySubject
        ? LearningRepository.findTopicReviewCountsBySubject(...studentRepoArgs).catch(() => [])
        : Promise.resolve([]),
      LearningRepository.findUnclassifiedEventsCountBySubject
        ? LearningRepository.findUnclassifiedEventsCountBySubject(...studentRepoArgs).catch(() => ({ totalUnclassifiedEvents: 0 }))
        : Promise.resolve({ totalUnclassifiedEvents: 0 }),
    ]);
    const answersByTopic = new Map();
    answers.forEach((answer) => {
      if (!answersByTopic.has(answer.topic_id)) answersByTopic.set(answer.topic_id, []);
      answersByTopic.get(answer.topic_id).push(answer);
    });

    const reviewsByTopic = new Map();
    (reviewSummary || []).forEach((r) => {
      if (r.topic_id) reviewsByTopic.set(r.topic_id, r);
    });

    const calculatedTopics = topics.map((topic) =>
      calculateTopicAnalytics(
        topic,
        answersByTopic.get(topic.id) || [],
        actualNow,
        reviewsByTopic.get(topic.id) || null
      )
    );

    const evaluatedTopics = calculatedTopics.filter((t) => t.dataQuality === 'sufficient').length;
    const unassessedTopics = calculatedTopics.filter((t) => t.dataQuality === 'no_data').length;
    const totalQuizAnswers = answers.length;
    const totalCorrectQuiz = answers.filter((a) => a.is_correct).length;
    const accuracyPercent = totalQuizAnswers > 0 ? Number(((totalCorrectQuiz / totalQuizAnswers) * 100).toFixed(2)) : null;

    const totalReviewEvents = (reviewSummary || []).reduce((sum, r) => sum + (Number(r.total_reviews) || 0), 0);

    const evaluatedTopicsWithMastery = calculatedTopics.filter((t) => t.masteryEstimate !== null);
    const overallMastery = evaluatedTopicsWithMastery.length > 0
      ? Math.round(evaluatedTopicsWithMastery.reduce((sum, t) => sum + t.masteryEstimate, 0) / evaluatedTopicsWithMastery.length)
      : null;

    const unclassifiedEvents = Number(unclassifiedSummary?.totalUnclassifiedEvents || 0);

    return {
      subjectId,
      overview: {
        totalReviewEvents,
        totalQuizAnswers,
        accuracyPercent,
        overallMastery,
        evaluatedTopics,
        unassessedTopics,
        unclassifiedEvents,
      },
      topics: calculatedTopics,
    };
  },
};

module.exports = LearningTopicAnalyticsService;
