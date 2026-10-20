const TopicsService = require('./topics.service');
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
};
