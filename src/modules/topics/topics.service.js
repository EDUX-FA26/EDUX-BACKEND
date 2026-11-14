const TopicsRepository = require('./topics.repository');
const LearningRepository = require('../learning/learning.repository');

async function assertManageSubject(user, subjectId, schoolId = null) {
  const subject = await LearningRepository.findSubjectById(subjectId, schoolId);
  if (!subject) throw new Error('SUBJECT_NOT_FOUND');
  if (user.role === 'admin' || user.role === 'school_admin') return subject;
  if (user.role !== 'lecturer' || !await TopicsRepository.isLecturerAssignedToSubject(user.id, subjectId, schoolId)) {
    throw new Error('FORBIDDEN');
  }
  return subject;
}

const TopicsService = {
  async list(subjectId, user, schoolId = null) {
    await assertManageSubject(user, subjectId, schoolId);
    return TopicsRepository.listBySubject(subjectId, schoolId);
  },
  async create(data, user, schoolId = null) {
    await assertManageSubject(user, data.subjectId, schoolId);
    if (data.parentId) {
      const parent = await TopicsRepository.findById(data.parentId, schoolId);
      if (!parent || parent.subject_id !== data.subjectId || !parent.is_active) throw new Error('INVALID_PARENT_TOPIC');
    }
    return TopicsRepository.create({ ...data, createdBy: user.id, schoolId });
  },
  async update(topicId, data, user, schoolId = null) {
    const topic = await TopicsRepository.findById(topicId, schoolId);
    if (!topic) throw new Error('TOPIC_NOT_FOUND');
    await assertManageSubject(user, topic.subject_id, schoolId);
    if (data.parentId) {
      const parent = await TopicsRepository.findById(data.parentId, schoolId);
      if (!parent || parent.id === topicId || parent.subject_id !== topic.subject_id || !parent.is_active) throw new Error('INVALID_PARENT_TOPIC');
    }
    return TopicsRepository.update(topicId, data, schoolId);
  },
  async mapFlashcard(topicId, flashcardId, reviewStatus, user, schoolId = null) {
    const topic = await TopicsRepository.findById(topicId, schoolId);
    const card = await TopicsRepository.findFlashcardContext(flashcardId, schoolId);
    if (!topic) throw new Error('TOPIC_NOT_FOUND');
    if (!card || !card.is_active || !card.deck_is_active) throw new Error('FLASHCARD_NOT_FOUND');
    await assertManageSubject(user, topic.subject_id, schoolId);
    if (user.role !== 'admin' && user.role !== 'school_admin' && card.created_by !== user.id) throw new Error('FORBIDDEN');
    if (topic.subject_id !== card.subject_id) throw new Error('TOPIC_FLASHCARD_SUBJECT_MISMATCH');
    return TopicsRepository.upsertManualMapping({ flashcardId, topicId, reviewStatus, mappedBy: user.id });
  },
};

module.exports = TopicsService;
