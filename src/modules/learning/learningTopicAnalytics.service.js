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

    const [topics, answers] = await Promise.all([
      LearningRepository.findActiveTopicsBySubject(subjectId, actualSchoolId),
      LearningRepository.findSubmittedMultipleChoiceTopicAnswers(studentId, subjectId, actualSchoolId),
    ]);
    const answersByTopic = new Map();
    answers.forEach((answer) => {
      if (!answersByTopic.has(answer.topic_id)) answersByTopic.set(answer.topic_id, []);
      answersByTopic.get(answer.topic_id).push(answer);
    });
    return {
      subjectId,
      topics: topics.map((topic) => calculateTopicAnalytics(topic, answersByTopic.get(topic.id) || [], actualNow)),
    };
  },
};

module.exports = LearningTopicAnalyticsService;
