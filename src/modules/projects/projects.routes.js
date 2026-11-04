
const express = require('express');
const router = express.Router();

const { authenticate } = require(
  '../../middlewares/auth.middleware'
);

const controller = require('./projects.controller');

router.use(authenticate);

// Sinh viên xem Project của mình
router.get('/my', controller.getMine);

// Giảng viên xem các Project trong lớp
router.get('/class/:classId', controller.getByClass);

// Sinh viên tạo Project
router.post('/', controller.create);

// Phản hồi lời mời
router.post('/invitations/:id/accept', controller.accept);
router.post('/invitations/:id/reject', controller.reject);

router.get('/invitations/my', controller.getInvitations);

// Chi tiết Project
router.get('/:projectId', controller.getById);

router.get(
  '/:projectId/invitations',
  controller.getProjectInvitations
);

// Owner mời thành viên
router.post(
  '/:projectId/invitations',
  controller.invite
);

module.exports = router;
