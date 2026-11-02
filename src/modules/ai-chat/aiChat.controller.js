const AiChatService = require('./aiChat.service');

module.exports = {
  async chat(req, res, next) {
    try {
      const result = await AiChatService.answer(req.body?.message, req.user);
      res.json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'MESSAGE_REQUIRED') return res.status(400).json({ success: false, message: 'Vui lòng nhập câu hỏi.' });
      if (error.message === 'MESSAGE_TOO_LONG') return res.status(400).json({ success: false, message: 'Câu hỏi tối đa 500 ký tự.' });
      next(error);
    }
  },
};
