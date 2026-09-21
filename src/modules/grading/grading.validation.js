const { z } = require('zod');

const gradeSchemas = {
  // POST /api/grades — Create grade + feedback
  createGrade: z.object({
    submissionId: z.string().uuid('submissionId phải là UUID hợp lệ'),
    score: z
      .number({ required_error: 'score là bắt buộc' })
      .min(0, 'score không được âm'),
    maxScore: z
      .number()
      .positive('maxScore phải lớn hơn 0')
      .optional(),
    feedback: z.string().max(5000).default(''),
  }),

  // PATCH /api/grades/:id — Update grade + feedback (partial)
  updateGrade: z
    .object({
      score: z.number().min(0, 'score không được âm').optional(),
      maxScore: z.number().positive('maxScore phải lớn hơn 0').optional(),
      feedback: z.string().max(5000).optional(),
    })
    .refine(
      (data) => Object.keys(data).some((k) => data[k] !== undefined),
      { message: 'Cần cung cấp ít nhất một field để cập nhật' }
    ),
};

module.exports = gradeSchemas;

