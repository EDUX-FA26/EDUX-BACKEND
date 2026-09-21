const express = require('express');
const multer = require('multer');

const SubmissionController = require('./submission.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  submitSubmissionSchema,
  queryAssignmentSubmissionsSchema,
  reviewSubmissionSchema
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

// Danh sách bài nộp của 1 assignment (cho lecturer/admin)
router.get(
  '/assignments/:assignmentId',
  authorize('admin', 'lecturer'),
  validate(queryAssignmentSubmissionsSchema, 'query'),
  SubmissionController.getAssignmentSubmissions
);

// Nộp bài / Nộp lại bài (cho student)
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

module.exports = router;