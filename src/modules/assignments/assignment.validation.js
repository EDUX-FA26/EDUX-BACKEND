const { z } = require('zod');

const createAssignmentSchema = z.object({
  body: z.object({
    class_id: z.string().uuid('Invalid class_id'),
    session_id: z.string().uuid('Invalid session_id').optional().nullable(),
    title: z.string().min(1, 'Title is required').max(255, 'Title too long'),
    description: z.string().optional(),
    instructions: z.string().optional(),
    deadline: z.string().datetime({ message: 'Invalid datetime format for deadline' }),
    max_score: z.coerce.number().min(0).default(10),
    weight: z.coerce.number().min(0).max(100).default(0),
    ai_declaration_required: z.coerce.boolean().default(true),
    min_ai_interactions: z.coerce.number().min(0).default(1),
    max_ai_interactions: z.coerce.number().min(0).default(20),
    allow_late_submission: z.coerce.boolean().default(true),
    publish_status: z.enum(['draft', 'published', 'closed']).default('draft'),
  })
});

const updateAssignmentSchema = z.object({
  body: z.object({
    title: z.string().min(1, 'Title is required').max(255, 'Title too long').optional(),
    description: z.string().optional(),
    instructions: z.string().optional(),
    deadline: z.string().datetime({ message: 'Invalid datetime format for deadline' }).optional(),
    max_score: z.coerce.number().min(0).optional(),
    weight: z.coerce.number().min(0).max(100).optional(),
    ai_declaration_required: z.coerce.boolean().optional(),
    min_ai_interactions: z.coerce.number().min(0).optional(),
    max_ai_interactions: z.coerce.number().min(0).optional(),
    allow_late_submission: z.coerce.boolean().optional(),
    session_id: z.string().uuid('Invalid session_id').optional().nullable(),
  })
});

const updateStatusSchema = z.object({
  body: z.object({
    publish_status: z.enum(['draft', 'published', 'closed'], {
      errorMap: () => ({ message: 'publish_status must be draft, published, or closed' })
    })
  })
});

const queryAssignmentsSchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(10),
    class_id: z.string().uuid('Invalid class_id').optional(),
    publish_status: z.enum(['draft', 'published', 'closed']).optional(),
    search: z.string().optional(),
  })
});

module.exports = {
  createAssignmentSchema,
  updateAssignmentSchema,
  updateStatusSchema,
  queryAssignmentsSchema,
};
