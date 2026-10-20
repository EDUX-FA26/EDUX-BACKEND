const TopicsRepository = require('./topics.repository');
const LearningRepository = require('../learning/learning.repository');

async function assertManageSubject(user, subjectId) {
  const subject = await LearningRepository.findSubjectById(subjectId);
  if (!subject) throw new Error('SUBJECT_NOT_FOUND');
  if (user.role === 'admin') return subject;
  if (user.role !== 'lecturer' || !await TopicsRepository.isLecturerAssignedToSubject(user.id, subjectId)) {
    throw new Error('FORBIDDEN');
  }
  return subject;
}

const TopicsService = {
  async list(subjectId, user) {
    await assertManageSubject(user, subjectId);
    return TopicsRepository.listBySubject(subjectId);
  },
  async create(data, user) {
    await assertManageSubject(user, data.subjectId);
    if (data.parentId) {
      const parent = await TopicsRepository.findById(data.parentId);
      if (!parent || parent.subject_id !== data.subjectId || !parent.is_active) throw new Error('INVALID_PARENT_TOPIC');
    }
    return TopicsRepository.create({ ...data, createdBy: user.id });
  },
  async update(topicId, data, user) {
    const topic = await TopicsRepository.findById(topicId);
    if (!topic) throw new Error('TOPIC_NOT_FOUND');
    await assertManageSubject(user, topic.subject_id);
    if (data.parentId) {
      const parent = await TopicsRepository.findById(data.parentId);
      if (!parent || parent.id === topicId || parent.subject_id !== topic.subject_id || !parent.is_active) throw new Error('INVALID_PARENT_TOPIC');
    }
    return TopicsRepository.update(topicId, data);
  },
  async mapFlashcard(topicId, flashcardId, reviewStatus, user) {
    const topic = await TopicsRepository.findById(topicId);
    const card = await TopicsRepository.findFlashcardContext(flashcardId);
    if (!topic) throw new Error('TOPIC_NOT_FOUND');
    if (!card || !card.is_active || !card.deck_is_active) throw new Error('FLASHCARD_NOT_FOUND');
    await assertManageSubject(user, topic.subject_id);
    if (user.role !== 'admin' && card.created_by !== user.id) throw new Error('FORBIDDEN');
    if (topic.subject_id !== card.subject_id) throw new Error('TOPIC_FLASHCARD_SUBJECT_MISMATCH');
    return TopicsRepository.upsertManualMapping({ flashcardId, topicId, reviewStatus, mappedBy: user.id });
  },
};

module.exports = TopicsService;
