const { z } = require('zod');

// Schema cho body khi nộp bài (submit / resubmit)
const submitSubmissionSchema = z.object({
  note: z.string().optional()
});

// Schema cho query khi lấy danh sách submissions của 1 assignment
const queryAssignmentSubmissionsSchema = z.object({
  page: z.string().regex(/^\d+$/).optional().transform(Number),
  limit: z.string().regex(/^\d+$/).optional().transform(Number),
  status: z.enum(['pending', 'submitted', 'resubmitted', 'late', 'evaluated', 'reviewed', 'graded', 'flagged', 'withdrawn']).optional()
});

// Schema cho việc review bài nộp
const reviewSubmissionSchema = z.object({
  status: z.enum(['reviewed', 'graded', 'flagged']),
  feedback: z.string().optional()
});

module.exports = {
  submitSubmissionSchema,
  queryAssignmentSubmissionsSchema,
  reviewSubmissionSchema
};
