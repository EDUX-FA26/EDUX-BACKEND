const LearningStreakService = require('./learningStreak.service');
const LearningProfileService = require('./learningProfile.service');
const LearningTopicAnalyticsService = require('./learningTopicAnalytics.service');
const StudyPlannerService = require('./studyPlanner.service');
const StudyPlannerContentService = require('./studyPlannerContent.service');
const StudyPlannerSubmissionService =
  require('./studyPlannerSubmission.service');

const LearningController = {
  /**
   * GET /api/learning/profile?subjectId=...
   * Chỉ trả dữ liệu học tập của student đang đăng nhập.
   */
  async getLearningProfile(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({ success: false, message: 'Student access is required' });
      }

      const data = await LearningProfileService.getStudentProfile({
        studentId: req.user.id,
        subjectId: req.query.subjectId,
        historyLimit: req.query.historyLimit,
        wrongAnswersLimit: req.query.wrongAnswersLimit,
      });

      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Subject not found' });
      }
      if (error.message === 'SUBJECT_ACCESS_FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'You are not an active member of this subject' });
      }
      return next(error);
    }
  },

  async getTopicPerformance(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({ success: false, message: 'Student access is required' });
      }
      const data = await LearningTopicAnalyticsService.getStudentTopicPerformance(req.user.id, req.query.subjectId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') {
        return res.status(404).json({ success: false, message: 'Subject not found' });
      }
      if (error.message === 'SUBJECT_ACCESS_FORBIDDEN') {
        return res.status(403).json({ success: false, message: 'You are not an active member of this subject' });
      }
      return next(error);
    }
  },

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


  async getStudyPlanPreview(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({
          success: false,
          message: 'Student access is required'
        });
      }

      const { subjectId } = req.query;

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (
        typeof subjectId !== 'string' ||
        !uuidRegex.test(subjectId)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Valid subjectId is required'
        });
      }

      // Tái sử dụng Analytics thật từ Phase 2A.
      // Hàm này đã kiểm tra quyền học Subject.
      const analytics =
        await LearningTopicAnalyticsService
          .getStudentTopicPerformance(
            req.user.id,
            subjectId
          );

      // Tạo lịch học 7 ngày từ kết quả Analytics.
      const data =
        StudyPlannerService.createPreview(analytics);

      return res.status(200).json({
        success: true,
        message: 'Study plan preview generated successfully',
        data
      });

    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Subject not found'
        });
      }

      if (error.message === 'SUBJECT_ACCESS_FORBIDDEN') {
        return res.status(403).json({
          success: false,
          message: 'You are not an active member of this subject'
        });
      }

      if (
        error.message === 'NO_TOPICS_AVAILABLE' ||
        error.message === 'NO_SCHEDULABLE_TOPICS'
      ) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },


  async getStudyPlanMistakes(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({
          success: false,
          message: 'Student access is required'
        });
      }

      const analytics =
        await LearningTopicAnalyticsService
          .getStudentTopicPerformance(
            req.user.id,
            req.query.subjectId
          );

      const data =
        await StudyPlannerService.getMistakesPreview(
          analytics,
          req.user.id
        );

      return res.status(200).json({
        success: true,
        message: 'Incorrect flashcards retrieved successfully',
        data
      });

    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'Subject not found'
        });
      }

      if (error.message === 'SUBJECT_ACCESS_FORBIDDEN') {
        return res.status(403).json({
          success: false,
          message: 'Subject access forbidden'
        });
      }

      if (error.message === 'NO_TOPICS_AVAILABLE') {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },



  async getStudyPlanDay(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({
          success: false,
          message: 'Student access is required'
        });
      }

      const data =
        await StudyPlannerSubmissionService.getDay(
          req.params.planDayId,
          req.user.id
        );

      return res.status(200).json({
        success: true,
        message: 'Study day retrieved successfully',
        data
      });

    } catch (error) {
      const knownErrors = new Set([
        'PLAN_DAY_NOT_FOUND',
        'SUBJECT_ACCESS_FORBIDDEN'
      ]);

      if (knownErrors.has(error.message)) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },

  async submitStudyPlanDay(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({
          success: false,
          message: 'Student access is required'
        });
      }

      const data =
        await StudyPlannerSubmissionService.submitDay(
          req.params.planDayId,
          req.user.id,
          req.body.answers
        );

      return res.status(201).json({
        success: true,
        message: 'Study day submitted successfully',
        data
      });

    } catch (error) {
      const knownErrors = new Set([
        'PLAN_DAY_NOT_FOUND',
        'SUBJECT_ACCESS_FORBIDDEN',
        'STUDY_DAY_NOT_READY',
        'STUDY_DAY_ALREADY_SUBMITTED',
        'INCOMPLETE_STUDY_DAY_CONTENT',
        'INVALID_ANSWER_COUNT',
        'INVALID_ANSWER_FORMAT',
        'DUPLICATE_ANSWER',
        'INVALID_QUESTION_ID',
        'INVALID_STORED_ANSWER'
      ]);

      if (knownErrors.has(error.message)) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },


  async getStudyPlanDayResult(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({
          success: false,
          message: 'Student access is required'
        });
      }

      const data =
        await StudyPlannerSubmissionService.getResult(
          req.params.planDayId,
          req.user.id
        );

      return res.status(200).json({
        success: true,
        message: 'Study day result retrieved successfully',
        data
      });

    } catch (error) {
      const knownErrors = new Set([
        'PLAN_DAY_NOT_FOUND',
        'SUBJECT_ACCESS_FORBIDDEN',
        'SUBMISSION_NOT_FOUND'
      ]);

      if (knownErrors.has(error.message)) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },


  async generateStudyPlanDay(req, res, next) {
    try {
      // Chỉ sinh viên được sử dụng.
      if (req.user.role !== 'student') {
        return res.status(403).json({
          success: false,
          message: 'Student access is required'
        });
      }

      const { planDayId } = req.params;

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      if (!uuidRegex.test(planDayId || '')) {
        return res.status(400).json({
          success: false,
          message: 'Valid planDayId is required'
        });
      }

      // studentId luôn lấy từ JWT.
      const data =
        await StudyPlannerContentService.generateDay(
          planDayId,
          req.user.id
        );

      return res.status(data.created ? 201 : 200).json({
        success: true,
        message: data.contentStatus === 'unavailable'
          ? 'No eligible flashcards for this study day'
          : data.created
            ? 'Study day questions generated successfully'
            : 'Existing study day questions returned',
        data
      });

    } catch (error) {
      const knownErrors = new Set([
        'PLAN_DAY_NOT_FOUND',
        'SUBJECT_ACCESS_FORBIDDEN',
        'PLAN_DAY_STATE_CHANGED',
        'SOURCE_FLASHCARD_UNAVAILABLE',
        'INVALID_TARGET_QUESTIONS',
        'GENERATION_INPUT_TOO_LARGE',
        'AI_GENERATION_FAILED',
        'AI_INVALID_RESPONSE',
        'AI_INVALID_QUESTION',
        'AI_INVALID_OPTIONS',
        'AI_DUPLICATE_QUESTION',
        'AI_MATH_METADATA_REQUIRED',
        'AI_MATH_INVALID_EXPRESSION',
        'AI_MATH_UNSUPPORTED_EXPRESSION',
        'AI_MATH_DERIVATIVE_FAILED',
        'AI_MATH_INSUFFICIENT_VERIFICATION',
        'AI_MATH_INVALID_LIMIT_OPTION',
        'AI_MATH_UNSUPPORTED_LIMIT',
        'AI_MATH_LIMIT_NOT_VERIFIABLE',
        'AI_MATH_UNSUPPORTED_TYPE',
        'AI_MULTIPLE_OR_NO_CORRECT_OPTIONS',
        'AI_WRONG_CORRECT_OPTION',
      ]);

      if (knownErrors.has(error.message)) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },


  async generateStudyPlan(req, res, next) {
    try {
      if (req.user.role !== 'student') {
        return res.status(403).json({
          success: false,
          message: 'Student access is required'
        });
      }

      const analytics =
        await LearningTopicAnalyticsService
          .getStudentTopicPerformance(
            req.user.id,
            req.query.subjectId
          );

      const data =
        await StudyPlannerService.generateForStudent(
          analytics,
          req.user.id
        );

      return res.status(data.created ? 201 : 200).json({
        success: true,
        message: data.created
          ? 'Study plan created successfully'
          : 'Existing study plan returned',
        data
      });

    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'SUBJECT_NOT_FOUND'
        });
      }

      if (error.message === 'SUBJECT_ACCESS_FORBIDDEN') {
        return res.status(403).json({
          success: false,
          message: 'SUBJECT_ACCESS_FORBIDDEN'
        });
      }

      if (
        error.message === 'NO_TOPICS_AVAILABLE' ||
        error.message === 'NO_SCHEDULABLE_TOPICS'
      ) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },



};


module.exports = LearningController;

