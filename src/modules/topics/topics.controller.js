const TopicsService = require('./topics.service');
const TopicClassificationService = require('./topicClassification.service');
const TopicClassificationReviewService = require('./topicClassificationReview.service');
const TopicSimilarService = require('./topicSimilar.service');

function sendError(error, res, next) {
  if (error.message === 'TOPIC_NOT_FOUND' || error.message === 'SUBJECT_NOT_FOUND' || error.message === 'FLASHCARD_NOT_FOUND') return res.status(404).json({ success: false, message: error.message });
  if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
  if (error.message === 'INVALID_PARENT_TOPIC' || error.message === 'TOPIC_FLASHCARD_SUBJECT_MISMATCH') return res.status(400).json({ success: false, message: error.message });
  return next(error);
}

module.exports = {
  list: async (req, res, next) => { try { res.json({ success: true, data: await TopicsService.list(req.query.subjectId, req.user) }); } catch (e) { sendError(e, res, next); } },

  create: async (req, res, next) => { try { res.status(201).json({ success: true, data: await TopicsService.create(req.body, req.user) }); } catch (e) { sendError(e, res, next); } },

  update: async (req, res, next) => { try { res.json({ success: true, data: await TopicsService.update(req.params.topicId, req.body, req.user) }); } catch (e) { sendError(e, res, next); } },

  mapFlashcard: async (req, res, next) => { try { res.status(201).json({ success: true, data: await TopicsService.mapFlashcard(req.params.topicId, req.params.flashcardId, req.body.reviewStatus, req.user) }); } catch (e) { sendError(e, res, next); } },

  reviewClassification: async (req, res, next) => {
    try {
      const result = await TopicClassificationReviewService.review(
        req.params.flashcardId,
        req.body,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'AI classification reviewed successfully',
        data: result
      });
    } catch (error) {
      if (error.status && error.status >= 400 && error.status < 500) {
        return res.status(error.status).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },


  generateSimilar: async (req, res, next) => {
    try {
      const result = await TopicSimilarService.generate(
        req.body.flashcardId,
        req.body.count ?? 3,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'Similar flashcards generated successfully',
        data: result
      });
    } catch (error) {
      if (
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 600
      ) {
        return res.status(error.status).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },

  classifyFlashcard: async (req, res, next) => {
    try {
      const result = await TopicClassificationService.classify(
        req.body.flashcardId,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'Flashcard classification completed',
        data: result
      });
    } catch (error) {
      const allowedErrors = new Set([
        'FLASHCARD_NOT_FOUND',
        'FORBIDDEN',
        'NO_TOPICS_AVAILABLE',
        'TOO_MANY_TOPICS',
        'CLASSIFICATION_INPUT_TOO_LARGE',
        'AI_INVALID_RESPONSE',
        'AI_INVALID_TOPIC',
        'AI_CLASSIFICATION_FAILED',
        'AI_SUGGESTION_REJECTED',
        'AI_SUGGESTION_ALREADY_REVIEWED',


      ]);

      if (allowedErrors.has(error.message)) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message
        });
      }

      return next(error);
    }
  },
};
