const express = require('express');
const multer = require('multer');

const SubmissionController = require('./submission.controller');
const gradingController = require('../grading/grading.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  submitSubmissionSchema,
  queryAssignmentSubmissionsSchema,
  reviewSubmissionSchema,
  saveDraftDeclarationsSchema
} = require('./submission.validation');

const upload = multer({ storage: multer.memoryStorage() });

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
  }
  next();
};

const router = express.Router();
router.use(authenticate);

// Các routes cá nhân (của student)
router.get('/my-submissions', SubmissionController.getMySubmissions);

// Lấy bài nộp của chính mình theo assignmentId
router.get(
  '/assignments/:assignmentId/my-submission',
  authorize('student'),
  SubmissionController.getMySubmissionByAssignment
);

// Danh sách bài nộp của 1 assignment (cho lecturer/admin, hoặc student xem bài của chính mình)
router.get(
  '/assignments/:assignmentId',
  authorize('admin', 'lecturer', 'student'),
  validate(queryAssignmentSubmissionsSchema, 'query'),
  SubmissionController.getAssignmentSubmissions
);

// 1. Lưu bản nháp bài nộp (Save Draft - chỉ cho student)
router.post(
  '/:assignmentId/draft',
  authorize('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.saveDraft
);

// 1a. Silent Auto-Save Draft File (chỉ cho student)
router.post(
  '/:assignmentId/draft-file',
  authorize('student'),
  upload.any(),
  SubmissionController.saveDraftFile
);

// 1b. Xóa file bản nháp (chỉ cho student)
router.delete(
  '/:assignmentId/draft-file',
  authorize('student'),
  SubmissionController.removeDraftFile
);

// 1c. Silent Auto-Save Draft Declarations (Debounced text/JSON - chỉ cho student)
router.patch(
  '/:assignmentId/draft-declarations',
  authorize('student'),
  validate(saveDraftDeclarationsSchema),
  SubmissionController.saveDraftDeclarations
);
router.post(
  '/:assignmentId/draft-declarations',
  authorize('student'),
  validate(saveDraftDeclarationsSchema),
  SubmissionController.saveDraftDeclarations
);

// 1d. Pre-submission AI Sanity Check (chỉ cho student, on-demand)
router.post(
  '/:assignmentId/sanity-check',
  authorize('student'),
  SubmissionController.sanityCheck
);

// 2. Nộp bài chính thức (Submit Final - chỉ cho student)
router.post(
  '/:assignmentId/submit-final',
  authorize('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.submitFinal
);

// 2b. Chốt nộp bài chính thức từ bản nháp theo submission ID
router.patch(
  '/:id/submit',
  authorize('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.submitFinalById
);

// Nộp bài / Nộp lại bài / Draft qua endpoint files (cho student)
router.post(
  '/:assignmentId/files',
  authorize('student'),
  upload.array('files'),
  validate(submitSubmissionSchema),
  SubmissionController.submitAssignment
);

// Xem chi tiết 1 bài nộp (có query ?include_history=true)
router.get(
  '/:id',
  SubmissionController.getSubmissionById
);

// Xóa 1 file trong version hiện tại của bài nộp (cho student)
router.delete(
  '/:id/files/:fileId',
  authorize('student'),
  SubmissionController.deleteSubmissionFile
);

// Lấy (tải) file cụ thể trong bài nộp
router.get(
  '/:id/files/:fileId',
  SubmissionController.getSubmissionFile
);

// Đánh giá bài nộp (cho lecturer/admin)
router.patch(
  '/:id/review',
  authorize('admin', 'lecturer'),
  validate(reviewSubmissionSchema),
  SubmissionController.reviewSubmission
);

// AI Audit Rubric: POST /api/submissions/:submissionId/ai-rubric or /api/submissions/:submissionId/evaluate
router.post(
  '/:submissionId/ai-rubric',
  authorize('admin', 'lecturer'),
  gradingController.handleAuditRubric
);

router.post(
  '/:submissionId/evaluate',
  authorize('admin', 'lecturer'),
  gradingController.handleAuditRubric
);

router.get(
  '/:submissionId/ai-rubric',
  authorize('admin', 'lecturer'),
  gradingController.handleAuditRubric
);

module.exports = router;