const { z } = require('zod');

const classMaterialSchemas = {
  // POST /api/classes/:classId/materials
  createClassMaterial: z.object({
    title: z.string().min(1, 'Tiêu đề không được để trống').max(255),
    description: z.string().max(2000).default(''),
    is_private: z.boolean().default(true),
  }),

  // PATCH /api/materials/classes/:id
  updateClassMaterial: z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    is_private: z.boolean().optional(),
  }),

  // GET /api/classes/:classId/materials (query)
  listClassMaterialsQuery: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  }),
};

module.exports = classMaterialSchemas;

