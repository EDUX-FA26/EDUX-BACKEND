const LearningRepository = require('./learning.repository');
const LearningStreakService = require('./learningStreak.service');

function toNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function parseOptions(value) {
  if (typeof value !== 'string') return value || [];
  try { return JSON.parse(value); } catch (_) { return []; }
}

const LearningProfileService = {
  async getStudentProfile({ studentId, subjectId, historyLimit = 20, wrongAnswersLimit = 50 }) {
    const subject = await LearningRepository.findSubjectById(subjectId);
    if (!subject) throw new Error('SUBJECT_NOT_FOUND');

    const isMember = await LearningRepository.isStudentActiveInSubject(studentId, subjectId);
    if (!isMember) throw new Error('SUBJECT_ACCESS_FORBIDDEN');

    const [assignmentRows, testHistory, testSummary, wrongAnswers, reviewSummary, reviewHistory, dueFlashcards, streak] = await Promise.all([
      LearningRepository.findAssignmentGradesBySubject(studentId, subjectId),
      LearningRepository.findSubmittedFlashcardTestsBySubject(studentId, subjectId, historyLimit),
      LearningRepository.getFlashcardTestAnswerSummaryBySubject(studentId, subjectId),
      LearningRepository.findWrongFlashcardTestAnswersBySubject(studentId, subjectId, wrongAnswersLimit),
      LearningRepository.getFlashcardReviewSummaryBySubject(studentId, subjectId),
      LearningRepository.findFlashcardReviewHistoryBySubject(studentId, subjectId, historyLimit),
      LearningRepository.findDueFlashcardsBySubject(studentId, subjectId),
      LearningStreakService.getSubjectStreak(studentId, subjectId),
    ]);

    const earnedScore = assignmentRows.reduce((sum, row) => sum + Number(row.score), 0);
    const maxScore = assignmentRows.reduce((sum, row) => sum + Number(row.max_score), 0);
    const totalAnswers = Number(testSummary.total_answers || 0);
    const correctAnswers = Number(testSummary.correct_answers || 0);

    return {
      subject: { id: subject.id, code: subject.code, name: subject.name },
      assignments: {
        items: assignmentRows.map((row) => ({
          gradeId: row.grade_id,
          assignmentId: row.assignment_id,
          title: row.assignment_title,
          earnedScore: toNumber(row.score),
          maxScore: toNumber(row.max_score),
          feedback: row.feedback || '',
          gradedAt: row.graded_at,
        })),
        gradedCount: assignmentRows.length,
        totalEarnedScore: earnedScore,
        totalMaxScore: maxScore,
        scoreRate: maxScore > 0 ? Number(((earnedScore / maxScore) * 100).toFixed(2)) : null,
      },
      flashcardTests: {
        history: testHistory.map((row) => ({
          testId: row.test_id,
          deckId: row.deck_id,
          deckTitle: row.deck_title,
          totalQuestions: Number(row.total_questions),
          answeredCount: Number(row.answered_count),
          correctCount: Number(row.correct_count),
          incorrectCount: Number(row.incorrect_count),
          score: toNumber(row.score),
          startedAt: row.started_at,
          submittedAt: row.submitted_at,
        })),
        totalAnswers,
        distinctFlashcardsAnswered: Number(testSummary.distinct_flashcards || 0),
        correctAnswers,
        incorrectAnswers: Number(testSummary.incorrect_answers || 0),
        accuracy: totalAnswers > 0 ? Number(((correctAnswers / totalAnswers) * 100).toFixed(2)) : null,
        wrongAnswers: wrongAnswers.map((row) => ({
          testId: row.test_id,
          deckId: row.deck_id,
          deckTitle: row.deck_title,
          submittedAt: row.submitted_at,
          flashcardId: row.flashcard_id,
          question: row.question,
          questionType: row.question_type,
          options: parseOptions(row.options),
          studentAnswer: row.student_answer,
          correctAnswer: row.correct_answer,
          explanation: row.explanation || '',
          score: toNumber(row.score),
        })),
      },
      flashcardReviews: {
        totalReviews: Number(reviewSummary.total_reviews || 0),
        ratings: {
          again: Number(reviewSummary.again || 0), hard: Number(reviewSummary.hard || 0),
          good: Number(reviewSummary.good || 0), easy: Number(reviewSummary.easy || 0),
        },
        history: reviewHistory.map((row) => ({
          reviewId: row.review_id, flashcardId: row.flashcard_id, deckId: row.deck_id,
          deckTitle: row.deck_title, question: row.question, rating: row.result, reviewedAt: row.reviewed_at,
        })),
      },
      dueFlashcards: dueFlashcards.map((row) => ({
        flashcardId: row.flashcard_id, deckId: row.deck_id, deckTitle: row.deck_title,
        questionType: row.question_type, question: row.question, options: parseOptions(row.options),
        difficulty: row.difficulty, position: row.position, dueDate: row.due_date,
        intervalDays: row.interval_days, repetitions: row.repetitions, easeFactor: toNumber(row.ease_factor),
        lastReviewedAt: row.last_reviewed_at,
      })),
      streak,
      limits: { historyLimit, wrongAnswersLimit },
    };
  },
};

module.exports = LearningProfileService;
