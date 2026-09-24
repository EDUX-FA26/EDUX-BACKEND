const LearningStreakService = require('./learningStreak.service');

const LearningController = {
  /**
   * GET /api/learning/streak
   * Trả về tất cả streak của user hiện tại theo từng subject
   */
  async getAllSubjectStreaks(req, res, next) {
    try {
      const userId = req.user.userId || req.user.id;
      const data = await LearningStreakService.getAllSubjectStreaks(userId);
      res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/learning/streak/:subjectId
   * Trả về streak của một subject cụ thể
   */
  async getSubjectStreak(req, res, next) {
    try {
      const userId = req.user.userId || req.user.id;
      const { subjectId } = req.params;
      const data = await LearningStreakService.getSubjectStreak(userId, subjectId);
      res.status(200).json({ data });
    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Subject not found' });
      }
      next(error);
    }
  },

  /**
   * POST /api/learning/streak/:subjectId/recover
   * Khôi phục streak cho một môn học
   */
  async recoverSubjectStreak(req, res, next) {
    try {
      const userId = req.user.userId || req.user.id;
      const { subjectId } = req.params;
      const result = await LearningStreakService.recoverSubjectStreak(userId, subjectId);
      res.status(200).json(result);
    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Subject not found' });
      }
      if (error.message === 'RECOVERY_LIMIT_EXCEEDED') {
        return res.status(400).json({
          success: false,
          message: 'Monthly recovery quota exceeded (maximum 3 times per month)',
        });
      }
      if (error.message === 'NO_STREAK_TO_RECOVER') {
        return res.status(400).json({
          success: false,
          message: 'No streak available to recover for this subject',
        });
      }
      if (error.message === 'NO_MISSED_DAYS') {
        return res.status(400).json({
          success: false,
          message: 'Streak is already active. No missed days to recover.',
        });
      }
      if (error.message === 'STREAK_PERMANENTLY_LOST') {
        return res.status(400).json({
          success: false,
          message: 'Streak is permanently lost because 2 or more consecutive days were missed and cannot be recovered.',
        });
      }
      next(error);
    }
  },

  /**
   * GET /api/learning/activity
   * Lấy lịch sử learning activity của user
   */
  async getActivityHistory(req, res, next) {
    try {
      const userId = req.user.userId || req.user.id;
      const { page = 1, limit = 20, subjectId } = req.query;

      const result = await LearningStreakService.getLearningActivityHistory(userId, {
        page: Number(page),
        limit: Number(limit),
        subjectId,
      });

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/learning/heatmap
   * Lấy dữ liệu heatmap học tập
   */
  async getHeatmap(req, res, next) {
    try {
      const userId = req.user.userId || req.user.id;
      const { subjectId, startDate, endDate, year } = req.query;

      const data = await LearningStreakService.getHeatmap(userId, {
        subjectId,
        startDate,
        endDate,
        year,
      });

      res.status(200).json({ data });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/learning/activity
   * Generic endpoint yêu cầu xác thực qua flashcard deck completion
   */
  async recordActivity(req, res, next) {
    try {
      const userId = req.user.userId || req.user.id;
      const deckId = req.body.deckId || req.body.flashcardDeckId;

      if (!deckId) {
        return res.status(400).json({
          success: false,
          message: 'deckId or flashcardDeckId is required to record learning activity',
        });
      }

      const data = await LearningStreakService.recordFlashcardDeckCompletion({
        userId,
        deckId,
      });

      res.status(200).json({
        success: true,
        message: 'Learning activity recorded successfully',
        data,
      });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Flashcard deck not found' });
      }
      if (error.message === 'FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'Access denied to this deck' });
      }
      next(error);
    }
  },
};

module.exports = LearningController;

