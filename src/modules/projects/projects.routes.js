
"use strict";

const express = require('express');
const router = express.Router();

const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const controller = require('./projects.controller');

// ==========================================
// Multi-Tenant Middleware Chain
// authenticate -> requireSchoolContext
// ==========================================
router.use(authenticate, requireSchoolContext);

// Sinh viên xem Project của mình
router.get('/my', authorizeSchoolRoles('student'), controller.getMine);

// Giảng viên hoặc Quản trị viên trường xem các Project trong lớp
router.get('/class/:classId', authorizeSchoolRoles('lecturer', 'school_admin'), controller.getByClass);

// Sinh viên tạo Project
router.post('/', authorizeSchoolRoles('student'), controller.create);

// Sinh viên phản hồi lời mời
router.post('/invitations/:id/accept', authorizeSchoolRoles('student'), controller.accept);
router.post('/invitations/:id/reject', authorizeSchoolRoles('student'), controller.reject);

// Lời mời của sinh viên
router.get('/invitations/my', authorizeSchoolRoles('student'), controller.getInvitations);

// Chi tiết Project (Student tham gia, Lecturer phụ trách, hoặc School Admin)
router.get('/:projectId', authorizeSchoolRoles('student', 'lecturer', 'school_admin'), controller.getById);

// Owner xem danh sách lời mời của Project
router.get('/:projectId/invitations', authorizeSchoolRoles('student'), controller.getProjectInvitations);

// Owner mời thành viên vào Project
router.post('/:projectId/invitations', authorizeSchoolRoles('student'), controller.invite);

module.exports = router;
