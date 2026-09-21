const { z } = require('zod');

const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  type: z.enum(['assignment', 'material', 'class', 'flashcard']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

module.exports = { searchQuery };
