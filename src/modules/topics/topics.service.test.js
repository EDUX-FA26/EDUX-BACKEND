jest.mock('./topics.repository', () => ({
  isLecturerAssignedToSubject: jest.fn(), findById: jest.fn(), findFlashcardContext: jest.fn(),
  upsertManualMapping: jest.fn(), listBySubject: jest.fn(), create: jest.fn(), update: jest.fn(),
}));
jest.mock('../learning/learning.repository', () => ({ findSubjectById: jest.fn() }));
const repo = require('./topics.repository');
const learning = require('../learning/learning.repository');
const service = require('./topics.service');

describe('TopicsService manual mapping', () => {
  const user = { id: 'lecturer-1', role: 'lecturer' };
  beforeEach(() => {
    jest.clearAllMocks();
    learning.findSubjectById.mockResolvedValue({ id: 'subject-1' });
    repo.isLecturerAssignedToSubject.mockResolvedValue(true);
    repo.findById.mockResolvedValue({ id: 'topic-1', subject_id: 'subject-1', is_active: true });
    repo.findFlashcardContext.mockResolvedValue({ id: 'card-1', subject_id: 'subject-1', created_by: 'lecturer-1', is_active: true, deck_is_active: true });
    repo.upsertManualMapping.mockImplementation(async value => value);
  });
  test.each(['pending_review', 'rejected', 'approved'])('allows manual mapping with %s status', async (reviewStatus) => {
    const result = await service.mapFlashcard('topic-1', 'card-1', reviewStatus, user);
    expect(result.reviewStatus).toBe(reviewStatus);
  });
  test('rejects Topic and Flashcard from different subjects before database trigger', async () => {
    repo.findFlashcardContext.mockResolvedValueOnce({ id: 'card-1', subject_id: 'other-subject', created_by: 'lecturer-1', is_active: true, deck_is_active: true });
    await expect(service.mapFlashcard('topic-1', 'card-1', 'approved', user)).rejects.toThrow('TOPIC_FLASHCARD_SUBJECT_MISMATCH');
  });
});
