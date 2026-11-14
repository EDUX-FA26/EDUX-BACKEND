const express = require('express');
const multer = require('multer');

const SubmissionController = require('./submission.controller');
const gradingController = require('../grading/grading.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireSchoolContext } = require('../../middlewares/requireSchoolContext');
const { authorizeSchoolRoles } = require('../../middlewares/authorizeSchoolRoles');
const { validate } = require('../../middlewares/validate.middleware');
const {
  submitSubmissionSchema,
  queryAssignmentSubmissionsSchema,
  reviewSubmissionSchema,
  saveDraftDeclarationsSchema
} = require('./submission.validation');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
router.use(authenticate, requireSchoolContext);

// Các routes cá nhân (của student)
router.get(
  '/my-submissions',
  authorizeSchoolRoles('student'),
  SubmissionController.getMySubmissions
);

// Lấy bài nộp của chính mình theo assignmentId
router.get(
  '/assignments/:assignmentId/my-submission',
  authorizeSchoolRoles('student'),
  SubmissionController.getMySubmissionByAssignment
);

// Danh sách bài nộp của 1 assignment (cho lecturer/school_admin, hoặc student xem bài của chính mình)
router.get(
  '/assignments/:assignmentId',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  validate(queryAssignmentSubmissionsSchema, 'query'),
  SubmissionController.getAssignmentSubmissions
);

// 1. Lưu bản nháp bài nộp (Save Draft - chỉ cho student)
router.post(
  '/:assignmentId/draft',
  authorizeSchoolRoles('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.saveDraft
);

// 1a. Silent Auto-Save Draft File (chỉ cho student)
router.post(
  '/:assignmentId/draft-file',
  authorizeSchoolRoles('student'),
  upload.any(),
  SubmissionController.saveDraftFile
);

// 1b. Xóa file bản nháp (chỉ cho student)
router.delete(
  '/:assignmentId/draft-file',
  authorizeSchoolRoles('student'),
  SubmissionController.removeDraftFile
);

// 1c. Silent Auto-Save Draft Declarations (Debounced text/JSON - chỉ cho student)
router.patch(
  '/:assignmentId/draft-declarations',
  authorizeSchoolRoles('student'),
  validate(saveDraftDeclarationsSchema),
  SubmissionController.saveDraftDeclarations
);
router.post(
  '/:assignmentId/draft-declarations',
  authorizeSchoolRoles('student'),
  validate(saveDraftDeclarationsSchema),
  SubmissionController.saveDraftDeclarations
);

// 1d. Pre-submission AI Sanity Check (chỉ cho student, on-demand)
router.post(
  '/:assignmentId/sanity-check',
  authorizeSchoolRoles('student'),
  SubmissionController.sanityCheck
);

// 2. Nộp bài chính thức (Submit Final - chỉ cho student)
router.post(
  '/:assignmentId/submit-final',
  authorizeSchoolRoles('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.submitFinal
);

// 2b. Chốt nộp bài chính thức từ bản nháp theo submission ID
router.patch(
  '/:id/submit',
  authorizeSchoolRoles('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.submitFinalById
);

// Nộp bài / Nộp lại bài / Draft qua endpoint files (cho student)
router.post(
  '/:assignmentId/files',
  authorizeSchoolRoles('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.submitAssignment
);

// Xem chi tiết 1 bài nộp (có query ?include_history=true)
router.get(
  '/:id',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  SubmissionController.getSubmissionById
);

// Xóa 1 file trong version hiện tại của bài nộp (cho student)
router.delete(
  '/:id/files/:fileId',
  authorizeSchoolRoles('student'),
  SubmissionController.deleteSubmissionFile
);

// Lấy (tải) file cụ thể trong bài nộp
router.get(
  '/:id/files/:fileId',
  authorizeSchoolRoles('school_admin', 'lecturer', 'student'),
  SubmissionController.getSubmissionFile
);

// Đánh giá bài nộp (cho lecturer/school_admin)
router.patch(
  '/:id/review',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  validate(reviewSubmissionSchema),
  SubmissionController.reviewSubmission
);

// AI Audit Rubric: POST /api/submissions/:submissionId/ai-rubric or /api/submissions/:submissionId/evaluate
router.post(
  '/:submissionId/ai-rubric',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  gradingController.handleAuditRubric
);

router.post(
  '/:submissionId/evaluate',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  gradingController.handleAuditRubric
);

router.get(
  '/:submissionId/ai-rubric',
  authorizeSchoolRoles('school_admin', 'lecturer'),
  gradingController.handleAuditRubric
);

module.exports = router;