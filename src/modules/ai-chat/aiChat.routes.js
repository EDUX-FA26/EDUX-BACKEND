const express = require('express');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const controller = require('./aiChat.controller');

const router = express.Router();

// Bắt buộc đăng nhập, có School Context và vai trò Student trong trường hiện tại
router.use(authenticate);
router.use(requireSchoolContext);
router.use(authorizeSchoolRoles('student'));

router.post('/', controller.chat);

module.exports = router;
