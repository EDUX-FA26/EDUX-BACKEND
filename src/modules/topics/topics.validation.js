const { z } = require('zod');

const topicId = z.string().uuid('topicId must be a UUID');
const aliasId = z.string().uuid('aliasId must be a UUID');

const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

module.exports = {
  listQuery: z.object({
    subjectId: z.string().uuid('subjectId must be a UUID'),
    includeAll: booleanQuery.optional(),
    status: z.enum(['approved', 'pending_approval', 'rejected', 'all']).optional(),
    reviewRequired: booleanQuery.optional(),
    isActive: booleanQuery.optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  }),

  topicIdParam: z.object({ topicId }),

  aliasParams: z.object({
    topicId,
    aliasId,
  }),

  createTopic: z
    .object({
      subjectId: z.string().uuid('subjectId must be a UUID'),
      name: z.string().trim().min(1, 'Tên Topic không được để trống').max(255, 'Tên Topic tối đa 255 ký tự'),
      code: z.string().trim().min(1).max(80, 'Mã Topic tối đa 80 ký tự').optional().nullable(),
      description: z.string().max(4000, 'Mô tả tối đa 4000 ký tự').optional().default(''),
      parentId: z.string().uuid().nullable().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.parentId) {
        ctx.addIssue({
          code: 'custom',
          path: ['parentId'],
          message: 'Hệ thống dùng mô hình Flat Topic, không hỗ trợ parentId / Chapter',
        });
      }
    }),

  batchImportTopics: z.object({
    subjectId: z.string().uuid('subjectId must be a UUID'),
    topics: z
      .array(
        z.object({
          name: z.string().trim().min(1, 'Tên Topic không được để trống').max(255),
          code: z.string().trim().min(1).max(80).optional().nullable(),
          description: z.string().max(4000).optional().default(''),
          aliases: z.array(z.string().trim().min(1).max(200)).optional().default([]),
        })
      )
      .min(1, 'Danh sách topic import phải có ít nhất 1 dòng')
      .max(200, 'Tối đa import 200 topic mỗi lần'),
  }),

  updateTopic: z
    .object({
      name: z.string().trim().min(1, 'Tên Topic không được để trống').max(255).optional(),
      code: z.string().trim().min(1).max(80).optional().nullable(),
      description: z.string().max(4000).optional(),
      isActive: z.boolean().optional(),
      parentId: z.string().uuid().nullable().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.parentId) {
        ctx.addIssue({
          code: 'custom',
          path: ['parentId'],
          message: 'Hệ thống dùng mô hình Flat Topic, không hỗ trợ parentId / Chapter',
        });
      }
      if (Object.keys(data).length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'At least one field is required',
        });
      }
    }),

  confirmLegacy: z.object({
    code: z.string().trim().min(1).max(80).optional().nullable(),
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(4000).optional(),
    reviewNote: z.string().trim().max(2000).optional().default(''),
  }),

  reviewProposal: z.object({
    status: z.enum(['approved', 'rejected'], {
      errorMap: () => ({ message: "Trạng thái phê duyệt chỉ nhận 'approved' hoặc 'rejected'" }),
    }),
    code: z.string().trim().max(80, 'Mã Topic tối đa 80 ký tự').optional().nullable(),
    name: z.string().trim().min(1, 'Tên Topic không được để trống').max(255).optional(),
    description: z.string().max(4000).optional(),
    reviewNote: z.string().trim().max(2000).optional().default(''),
  }),

  createProposal: z.object({
    subjectId: z.string().uuid('subjectId must be a UUID'),
    name: z.string().trim().min(1, 'Tên Topic đề xuất không được để trống').max(255),
    code: z.string().trim().max(80, 'Mã Topic tối đa 80 ký tự').optional().nullable(),
    description: z.string().max(4000).optional().default(''),
    reason: z.string().trim().max(2000).optional().default(''),
  }),

  createAlias: z.object({
    alias: z.string().trim().min(1, 'Tên Alias không được để trống').max(200, 'Alias tối đa 200 ký tự'),
  }),

  updateStatus: z.object({
    isActive: z.boolean({ required_error: 'isActive is required' }),
  }),

  mappingParams: z.object({ topicId, flashcardId: z.string().uuid('flashcardId must be a UUID') }),

  mappingBody: z.object({ reviewStatus: z.enum(['pending_review', 'approved', 'rejected']).default('approved') }),

  classifyFlashcard: z.object({
    flashcardId: z.string().uuid('flashcardId must be a UUID'),
  }),

  classificationFlashcardParam: z.object({
    flashcardId: z.string().uuid(),
  }),

  reviewClassification: z
    .object({
      action: z.enum(['approve', 'reject', 'change']),
      topicId: z.string().uuid().optional(),
    })
    .superRefine((data, ctx) => {
      if (data.action === 'change' && !data.topicId) {
        ctx.addIssue({
          code: 'custom',
          path: ['topicId'],
          message: 'topicId is required when changing topic',
        });
      }

      if (data.action !== 'change' && data.topicId !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['topicId'],
          message: 'topicId is only allowed when changing topic',
        });
      }
    }),

  generateSimilar: z.object({
    flashcardId: z.string().uuid(),
    count: z.number().int().min(1).max(5).default(3),
  }),
};
