const { z } = require('zod');

const classSchemas = {
  // Query params for GET /api/classes
  getClassesQuery: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).default('10'),
    search: z.string().optional(),
    include_inactive: z.enum(['true', 'false']).transform(val => val === 'true').default('false'),
  }),

  // Payload for POST /api/classes
  createClass: z.object({
    class_code: z.string().min(1, 'Mã lớp không được để trống'),
    semester_id: z.string().uuid('ID học kỳ không hợp lệ'),
    subject_id: z.string().uuid('ID môn học không hợp lệ'),
    lecturer_id: z.string().uuid('ID giảng viên không hợp lệ'),
    max_students: z.number().int().min(0).default(0),
    is_active: z.boolean().default(true),
  }),

  // Payload for PATCH /api/classes/:id
  updateClass: z.object({
    class_code: z.string().min(1).optional(),
    semester_id: z.string().uuid().optional(),
    subject_id: z.string().uuid().optional(),
    lecturer_id: z.string().uuid().optional(),
    max_students: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  }),

  // Query params for GET /api/classes/:id/members
  getMembersQuery: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
    search: z.string().optional(),
  })
};

module.exports = classSchemas;
