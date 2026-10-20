const LearningRepository = require('./learning.repository');
const { calculateTopicAnalytics } = require('./topicAnalytics.service');

const LearningTopicAnalyticsService = {
  async getStudentTopicPerformance(studentId, subjectId, now = new Date()) {
    const subject = await LearningRepository.findSubjectById(subjectId);
    if (!subject) throw new Error('SUBJECT_NOT_FOUND');
    if (!await LearningRepository.isStudentActiveInSubject(studentId, subjectId)) {
      throw new Error('SUBJECT_ACCESS_FORBIDDEN');
    }

    const [topics, answers] = await Promise.all([
      LearningRepository.findActiveTopicsBySubject(subjectId),
      LearningRepository.findSubmittedMultipleChoiceTopicAnswers(studentId, subjectId),
    ]);
    const answersByTopic = new Map();
    answers.forEach((answer) => {
      if (!answersByTopic.has(answer.topic_id)) answersByTopic.set(answer.topic_id, []);
      answersByTopic.get(answer.topic_id).push(answer);
    });
    return {
      subjectId,
      topics: topics.map((topic) => calculateTopicAnalytics(topic, answersByTopic.get(topic.id) || [], now)),
    };
  },
};

module.exports = LearningTopicAnalyticsService;
