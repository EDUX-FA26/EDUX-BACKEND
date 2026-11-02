const express = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const controller = require('./aiChat.controller');

const router = express.Router();
router.use(authenticate);
router.post('/', (req, res, next) => {
  if (req.user?.role !== 'student') {
    return res.status(403).json({ success: false, message: 'AI chat hiện chỉ dành cho sinh viên.' });
  }
  next();
}, controller.chat);

module.exports = router;
