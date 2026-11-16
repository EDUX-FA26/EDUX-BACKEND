const { z } = require('zod');

const flashcardsSchemas = {

  // ── DECK ────────────────────────────────────────────────────────

  // POST /api/flashcards/decks
  createDeck: z.object({
    title:       z.string().min(1, 'Tiêu đề không được để trống').max(255),
    description: z.string().max(2000).optional().default(''),
    subject_id:  z.string().uuid('subject_id không hợp lệ'),
    class_id:    z.string().uuid('class_id không hợp lệ').optional().nullable(),
    is_public:   z.boolean().default(false),
  }),

  // put /api/flashcards/decks/:deckId
  updateDeck: z.object({
    title:       z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional(),
    subject_id:  z.string().uuid().optional(),
    class_id:    z.string().uuid().nullable().optional(),
    is_public:   z.boolean().optional(),
    is_active:   z.boolean().optional(),
  }),

  // GET /api/flashcards/decks (query params)
  getDecksQuery: z.object({
    page:       z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit:      z.string().regex(/^\d+$/).transform(Number).default('10'),
    subject_id: z.string().uuid().optional(),
    class_id:   z.string().uuid().optional(),
    is_public:  z.enum(['true', 'false']).optional(),
  }),

  // ── CARD ────────────────────────────────────────────────────────

  // POST /api/flashcards/decks/:deckId/cards
  createCard: z.object({
    type:        z.enum(['multiple_choice']).optional().default('multiple_choice'),
    question:    z.string().min(1, 'Câu hỏi không được để trống'),
    answer:      z.string().min(1, 'Đáp án không được để trống'),
    options:     z.array(z.any()).optional().default([]),
    explanation: z.string().optional().default(''),
    difficulty:  z.enum(['easy', 'medium', 'hard']).default('medium'),
    position:    z.number().int().min(0).optional(),
    topicId:     z.string().uuid('Vui lòng chọn Canonical Topic hợp lệ (UUID)').optional().nullable(),
    topic_id:    z.string().uuid().optional().nullable(),
    topicName:   z.string().trim().max(255).optional().nullable(),
  }).refine(data => {
    return Boolean(data.topicId || data.topic_id);
  }, {
    message: 'Câu hỏi mới bắt buộc phải chọn Canonical Topic chuẩn (topicId)',
    path: ['topicId'],
  }).refine(data => {
    if (data.type === 'multiple_choice') {
      return Array.isArray(data.options) && data.options.length >= 2;
    }
    return true;
  }, {
    message: 'Flashcard trắc nghiệm phải có ít nhất 2 lựa chọn (options)',
    path: ['options'],
  }),

  // PUT /api/flashcards/decks/:deckId/cards/:cardId
  updateCard: z.object({
    type:        z.enum(['multiple_choice']).optional(),
    question:    z.string().min(1).optional(),
    answer:      z.string().min(1).optional(),
    options:     z.array(z.any()).optional(),
    explanation: z.string().optional(),
    difficulty:  z.enum(['easy', 'medium', 'hard']).optional(),
    position:    z.number().int().min(0).optional(),
    is_active:   z.boolean().optional(),
    topicId:     z.string().uuid().optional().nullable(),
    topic_id:    z.string().uuid().optional().nullable(),
    topicName:   z.string().trim().max(255).optional().nullable(),
  }),

  // ── EXCEL IMPORT ──────────────────────────────────────────

  confirmImport: z.object({
    previewId: z.string().min(1, 'previewId là bắt buộc'),
    idempotencyKey: z.string().optional(),
    rows: z.array(
      z.object({
        rowNumber: z.number().int().min(2, 'rowNumber tối thiểu là 2'),
        topicId: z.string().uuid('topicId phải là UUID hợp lệ'),
      })
    ).min(1, 'Cần ít nhất một dòng câu hỏi được xác nhận Topic'),
  }),

  // POST /api/flashcards/decks/:deckId/topic-suggestions
  topicSuggestions: z.object({
    rawTopic: z.string().trim().max(255).optional().default(''),
    question: z.string().trim().max(4000).optional().default(''),
    answer: z.string().trim().max(4000).optional().default(''),
    limit: z.coerce.number().int().min(1).max(10).default(3).optional(),
  }),

  // ── REVIEW ────────────────────────────────────────────────

  // POST /api/flashcards/cards/:cardId/reviews
  submitReview: z.object({
    result: z.enum(['again', 'hard', 'good', 'easy'], {
      errorMap: () => ({ message: "result phải là 'again', 'hard', 'good' hoặc 'easy'" }),
    }),
  }),
};

module.exports = flashcardsSchemas;
