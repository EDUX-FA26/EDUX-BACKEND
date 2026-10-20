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
  mappingBody: z.object({ reviewStatus: z.enum(['pending_review', 'approved', 'rejected']).default('approved') }),
};
