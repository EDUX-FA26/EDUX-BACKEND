const { z } = require('zod');

const learningSchemas = {
  subjectIdParam: z.object({
    subjectId: z.string().uuid('subjectId phải là UUID hợp lệ'),
  }),

  getActivitiesQuery: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
    subjectId: z.string().uuid('subjectId phải là UUID hợp lệ').optional(),
  }),

  getHeatmapQuery: z.object({
    subjectId: z.string().uuid('subjectId phải là UUID hợp lệ').optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate phải có định dạng YYYY-MM-DD').optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate phải có định dạng YYYY-MM-DD').optional(),
    year: z.string().regex(/^\d{4}$/, 'year phải có 4 chữ số').optional(),
  }),

  postActivity: z.object({
    deckId: z.string().uuid('deckId phải là UUID hợp lệ').optional(),
    flashcardDeckId: z.string().uuid('flashcardDeckId phải là UUID hợp lệ').optional(),
    activityType: z.string().optional().default('flashcard_deck_completed'),
  }).refine((data) => data.deckId || data.flashcardDeckId, {
    message: 'deckId hoặc flashcardDeckId là bắt buộc để xác định flashcard deck hoàn thành',
  }),
};

module.exports = learningSchemas;

