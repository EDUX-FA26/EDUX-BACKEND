jest.mock('./learning.repository', () => ({
  findSubjectById: jest.fn(), isStudentActiveInSubject: jest.fn(),
  findActiveTopicsBySubject: jest.fn(), findSubmittedMultipleChoiceTopicAnswers: jest.fn(),
}));
const repo = require('./learning.repository');
const service = require('./learningTopicAnalytics.service');

describe('LearningTopicAnalyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repo.findSubjectById.mockResolvedValue({ id: 's' });
    repo.isStudentActiveInSubject.mockResolvedValue(true);
    repo.findActiveTopicsBySubject.mockResolvedValue([{ id: 't', name: 'Topic' }]);
    repo.findSubmittedMultipleChoiceTopicAnswers.mockResolvedValue([]);
  });
  test('returns active topic with zero evidence and only queries the authenticated student', async () => {
    const result = await service.getStudentTopicPerformance('student-1', 's', new Date('2026-10-14'));
    expect(result.topics[0]).toMatchObject({ totalAttempts: 0, masteryEstimate: null, priority: 'insufficient_evidence' });
    expect(repo.findSubmittedMultipleChoiceTopicAnswers).toHaveBeenCalledWith('student-1', 's');
  });
  test('rejects student without subject membership', async () => {
    repo.isStudentActiveInSubject.mockResolvedValue(false);
    await expect(service.getStudentTopicPerformance('student-2', 's')).rejects.toThrow('SUBJECT_ACCESS_FORBIDDEN');
  });
});
