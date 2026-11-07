const { z } = require('zod');

// Schema cho body khi nộp bài (submit / resubmit / draft)
const submitSubmissionSchema = z.object({
  note: z.string().optional(),
  is_draft: z.union([z.boolean(), z.string()]).optional(),
  ai_declarations: z.any().optional(),
  clear_files: z.union([z.boolean(), z.string()]).optional()
});

// Schema cho query khi lấy danh sách submissions của 1 assignment
const queryAssignmentSubmissionsSchema = z.object({
  page: z.string().regex(/^\d+$/).optional().transform(Number),
  limit: z.string().regex(/^\d+$/).optional().transform(Number),
  status: z.enum(['draft', 'pending', 'submitted', 'resubmitted', 'late', 'evaluated', 'reviewed', 'graded', 'flagged', 'withdrawn']).optional()
});

// Schema cho việc review bài nộp
const reviewSubmissionSchema = z.object({
  status: z.enum(['reviewed', 'graded', 'flagged']),
  feedback: z.string().optional()
});

// Schema cho auto-save draft declarations
const saveDraftDeclarationsSchema = z.object({
  ai_declarations: z.any().optional(),
  scopes: z.any().optional(),
  note: z.string().optional()
});

module.exports = {
  submitSubmissionSchema,
  queryAssignmentSubmissionsSchema,
  reviewSubmissionSchema,
  saveDraftDeclarationsSchema
};
