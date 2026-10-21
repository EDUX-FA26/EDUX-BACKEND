jest.mock('./learning.repository', () => ({
  findSubjectById: jest.fn(),
  isStudentActiveInSubject: jest.fn(),
  findAssignmentGradesBySubject: jest.fn(),
  findSubmittedFlashcardTestsBySubject: jest.fn(),
  getFlashcardTestAnswerSummaryBySubject: jest.fn(),
  findWrongFlashcardTestAnswersBySubject: jest.fn(),
  getFlashcardReviewSummaryBySubject: jest.fn(),
  findFlashcardReviewHistoryBySubject: jest.fn(),
  findDueFlashcardsBySubject: jest.fn(),
}));
jest.mock('./learningStreak.service', () => ({ getSubjectStreak: jest.fn() }));

const Repository = require('./learning.repository');
const StreakService = require('./learningStreak.service');
const ProfileService = require('./learningProfile.service');

const studentId = '11111111-1111-4111-8111-111111111111';
const subjectId = '22222222-2222-4222-8222-222222222222';

function setupEmptyProfile() {
  Repository.findSubjectById.mockResolvedValue({ id: subjectId, code: 'CS101', name: 'Programming' });
  Repository.isStudentActiveInSubject.mockResolvedValue(true);
  Repository.findAssignmentGradesBySubject.mockResolvedValue([]);
  Repository.findSubmittedFlashcardTestsBySubject.mockResolvedValue([]);
  Repository.getFlashcardTestAnswerSummaryBySubject.mockResolvedValue({ total_answers: 0, correct_answers: 0, incorrect_answers: 0, distinct_flashcards: 0 });
  Repository.findWrongFlashcardTestAnswersBySubject.mockResolvedValue([]);
  Repository.getFlashcardReviewSummaryBySubject.mockResolvedValue({ total_reviews: 0, again: 0, hard: 0, good: 0, easy: 0 });
  Repository.findFlashcardReviewHistoryBySubject.mockResolvedValue([]);
  Repository.findDueFlashcardsBySubject.mockResolvedValue([]);
  StreakService.getSubjectStreak.mockResolvedValue({ currentStreak: 0, longestStreak: 0 });
}

describe('LearningProfileService', () => {
  beforeEach(() => { jest.clearAllMocks(); setupEmptyProfile(); });

  test('aggregates unweighted assignment rate, submitted-answer attempts, ratings, and due cards', async () => {
    Repository.findAssignmentGradesBySubject.mockResolvedValue([
      { grade_id: 'g1', assignment_id: 'a1', assignment_title: 'A', score: '8', max_score: '10', feedback: null, graded_at: '2026-10-01' },
      { grade_id: 'g2', assignment_id: 'a2', assignment_title: 'B', score: '15', max_score: '20', feedback: 'Good', graded_at: '2026-10-02' },
    ]);
    Repository.findSubmittedFlashcardTestsBySubject.mockResolvedValue([
      { test_id: 't1', deck_id: 'd1', deck_title: 'Deck', total_questions: 2, answered_count: 2, correct_count: 1, incorrect_count: 1, score: '5', started_at: 'x', submitted_at: 'y' },
    ]);
    Repository.getFlashcardTestAnswerSummaryBySubject.mockResolvedValue({ total_answers: 6, correct_answers: 4, incorrect_answers: 2, distinct_flashcards: 3 });
    Repository.findWrongFlashcardTestAnswersBySubject.mockResolvedValue([{ test_id: 't1', deck_id: 'd1', deck_title: 'Deck', flashcard_id: 'f1', question: 'Q', question_type: 'mcq', options: '["a","b"]', student_answer: 'a', correct_answer: 'b', explanation: 'Why', score: '0' }]);
    Repository.getFlashcardReviewSummaryBySubject.mockResolvedValue({ total_reviews: 4, again: 1, hard: 1, good: 1, easy: 1 });
    Repository.findDueFlashcardsBySubject.mockResolvedValue([{ flashcard_id: 'f2', deck_id: 'd1', deck_title: 'Deck', question_type: 'mcq', question: 'Due', options: ['a'], difficulty: 'easy', position: 1, due_date: '2026-10-14', interval_days: 2, repetitions: 3, ease_factor: '2.5', last_reviewed_at: null }]);

    const profile = await ProfileService.getStudentProfile({ studentId, subjectId, historyLimit: 10, wrongAnswersLimit: 10 });

    expect(profile.assignments).toMatchObject({ gradedCount: 2, totalEarnedScore: 23, totalMaxScore: 30, scoreRate: 76.67 });
    expect(profile.flashcardTests).toMatchObject({ totalAnswers: 6, distinctFlashcardsAnswered: 3, correctAnswers: 4, incorrectAnswers: 2, accuracy: 66.67 });
    expect(profile.flashcardTests.wrongAnswers[0]).toMatchObject({ correctAnswer: 'b', options: ['a', 'b'] });
    expect(profile.flashcardReviews.ratings).toEqual({ again: 1, hard: 1, good: 1, easy: 1 });
    expect(profile.dueFlashcards[0]).not.toHaveProperty('answer');
    expect(Repository.findSubmittedFlashcardTestsBySubject).toHaveBeenCalledWith(studentId, subjectId, 10);
  });

  test('returns null rates and empty collections when the student has no learning data', async () => {
    const profile = await ProfileService.getStudentProfile({ studentId, subjectId });

    expect(profile.assignments.scoreRate).toBeNull();
    expect(profile.flashcardTests.accuracy).toBeNull();
    expect(profile.assignments.items).toEqual([]);
    expect(profile.flashcardTests.wrongAnswers).toEqual([]);
    expect(profile.dueFlashcards).toEqual([]);
  });

  test('rejects a missing subject or a student without active membership', async () => {
    Repository.findSubjectById.mockResolvedValueOnce(null);
    await expect(ProfileService.getStudentProfile({ studentId, subjectId })).rejects.toThrow('SUBJECT_NOT_FOUND');

    setupEmptyProfile();
    Repository.isStudentActiveInSubject.mockResolvedValueOnce(false);
    await expect(ProfileService.getStudentProfile({ studentId, subjectId })).rejects.toThrow('SUBJECT_ACCESS_FORBIDDEN');
  });
});
