const FlashcardsTestService = require('./flashcardsTest.service');

const FlashcardsTestController = {
  // POST /api/flashcards/decks/:deckId/tests
  async createTest(req, res, next) {
    try {
      const result = await FlashcardsTestService.createTest(req.params.deckId, req.user);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'DECK_EMPTY')     return res.status(422).json({ success: false, message: 'Bộ thẻ chưa có câu hỏi nào để tạo bài kiểm tra' });
      next(error);
    }
  },

  // GET /api/flashcards/tests/:testId
  async getTest(req, res, next) {
    try {
      const result = await FlashcardsTestService.getTest(req.params.testId, req.user);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'TEST_NOT_FOUND') return res.status(404).json({ success: false, message: 'Test session not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // POST /api/flashcards/tests/:testId/submit
  async submitTest(req, res, next) {
    try {
      const result = await FlashcardsTestService.submitTest(req.params.testId, req.body, req.user);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'TEST_NOT_FOUND')         return res.status(404).json({ success: false, message: 'Test session not found' });
      if (error.message === 'FORBIDDEN')              return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'TEST_ALREADY_SUBMITTED') return res.status(409).json({ success: false, message: 'Test has already been submitted' });
      next(error);
    }
  },

  // GET /api/flashcards/tests/:testId/result
  async getTestResult(req, res, next) {
    try {
      const result = await FlashcardsTestService.getTestResult(req.params.testId, req.user);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'TEST_NOT_FOUND')     return res.status(404).json({ success: false, message: 'Test session not found' });
      if (error.message === 'FORBIDDEN')          return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'TEST_NOT_SUBMITTED') return res.status(400).json({ success: false, message: 'Test is not submitted yet' });
      next(error);
    }
  },
};

module.exports = FlashcardsTestController;
