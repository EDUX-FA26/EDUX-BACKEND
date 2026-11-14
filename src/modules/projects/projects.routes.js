"use strict";

const express = require('express');
const router = express.Router();

const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const tasksRoutes = require("./tasks/tasks.routes");

const controller = require('./projects.controller');

// ==========================================
// Multi-Tenant Middleware Chain
// ==========================================
router.use(authenticate, requireSchoolContext);

// ==========================================
// PROJECT ROUTES
// ==========================================

// Sinh viên xem Project của mình
router.get('/my', authorizeSchoolRoles('student'), controller.getMine);

// Giảng viên hoặc Admin xem Project theo lớp
router.get(
    '/class/:classId',
    authorizeSchoolRoles('lecturer', 'school_admin'),
    controller.getByClass
);

// Sinh viên tạo Project
router.post(
    '/',
    authorizeSchoolRoles('student'),
    controller.create
);

// Sinh viên phản hồi lời mời
router.post(
    '/invitations/:id/accept',
    authorizeSchoolRoles('student'),
    controller.accept
);

router.post(
    '/invitations/:id/reject',
    authorizeSchoolRoles('student'),
    controller.reject
);

// Lời mời của sinh viên
router.get(
    '/invitations/my',
    authorizeSchoolRoles('student'),
    controller.getInvitations
);

// ==========================================
// PROJECT TASK MANAGEMENT
// ==========================================

router.use(
    "/:projectId/tasks",
    tasksRoutes
);

// ==========================================
// PROJECT DETAILS & INVITATIONS
// ==========================================

// Chi tiết Project
router.get(
    '/:projectId',
    authorizeSchoolRoles('student', 'lecturer', 'school_admin'),
    controller.getById
);

// Owner xem danh sách lời mời
router.get(
    '/:projectId/invitations',
    authorizeSchoolRoles('student'),
    controller.getProjectInvitations
);

// Owner mời thành viên
router.post(
    '/:projectId/invitations',
    authorizeSchoolRoles('student'),
    controller.invite
);

module.exports = router;