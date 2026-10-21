const { z } = require('zod');

const topicId = z.string().uuid('topicId must be a UUID');
module.exports = {
  listQuery: z.object({ subjectId: z.string().uuid('subjectId must be a UUID') }),
  topicIdParam: z.object({ topicId }),
  mappingParams: z.object({ topicId, flashcardId: z.string().uuid('flashcardId must be a UUID') }),
  createTopic: z.object({
    subjectId: z.string().uuid(), name: z.string().trim().min(1).max(255),
    description: z.string().max(4000).optional().default(''), parentId: z.string().uuid().nullable().optional(),
  }),
  updateTopic: z.object({
    name: z.string().trim().min(1).max(255).optional(), description: z.string().max(4000).optional(),
    parentId: z.string().uuid().nullable().optional(), isActive: z.boolean().optional(),
  }).refine((data) => Object.keys(data).length > 0, 'At least one field is required'),
  classifyFlashcard: z.object({
    flashcardId: z.string().uuid('flashcardId must be a UUID')
  }),

  classificationFlashcardParam: z.object({
    flashcardId: z.string().uuid()
  }),

  reviewClassification: z.object({
    action: z.enum(['approve', 'reject', 'change']),
    topicId: z.string().uuid().optional()
  }).superRefine((data, ctx) => {
    if (data.action === 'change' && !data.topicId) {
      ctx.addIssue({
        code: 'custom',
        path: ['topicId'],
        message: 'topicId is required when changing topic'
      });
    }

    if (data.action !== 'change' && data.topicId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['topicId'],
        message: 'topicId is only allowed when changing topic'
      });
    }
  }),

  generateSimilar: z.object({
    flashcardId: z.string().uuid(),
    count: z.number().int().min(1).max(5).default(3)
  }),

  mappingBody: z.object({ reviewStatus: z.enum(['pending_review', 'approved', 'rejected']).default('approved') }),
};
