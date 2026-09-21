const { z } = require('zod');

const assignmentMaterialSchemas = {
  // POST /api/assignments/:assignmentId/materials
  createAssignmentMaterial: z.object({
    description: z.string().max(2000).default(''),
  }),

  // PATCH /api/assignments/:assignmentId/materials/:materialId
  updateAssignmentMaterial: z.object({
    description: z.string().max(2000).optional(),
  }),

  // GET /api/assignments/:assignmentId/materials (query)
  listAssignmentMaterialsQuery: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  }),
};

module.exports = assignmentMaterialSchemas;

