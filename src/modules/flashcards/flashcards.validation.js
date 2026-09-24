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
    type:        z.enum(['essay', 'multiple_choice']).optional().default('essay'),
    question:    z.string().min(1, 'Câu hỏi không được để trống'),
    answer:      z.string().min(1, 'Đáp án không được để trống'),
    options:     z.array(z.any()).optional().default([]),
    explanation: z.string().optional().default(''),
    difficulty:  z.enum(['easy', 'medium', 'hard']).default('medium'),
    position:    z.number().int().min(0).optional(),
  }).refine(data => {
    if (data.type === 'multiple_choice') {
      return Array.isArray(data.options) && data.options.length >= 2;
    }
    return true;
  }, {
    message: 'Flashcard trắc nghiệm phải có ít nhất 2 lựa chọn (options)',
    path: ['options'],
  }),

  // PUT /api/flashcards/:id
  updateCard: z.object({
    type:        z.enum(['essay', 'multiple_choice']).optional(),
    question:    z.string().min(1).optional(),
    answer:      z.string().min(1).optional(),
    options:     z.array(z.any()).optional(),
    explanation: z.string().optional(),
    difficulty:  z.enum(['easy', 'medium', 'hard']).optional(),
    position:    z.number().int().min(0).optional(),
    is_active:   z.boolean().optional(),
  }),

  // ── REVIEW ────────────────────────────────────────────────

  // POST /api/flashcards/cards/:cardId/reviews
  submitReview: z.object({
    result: z.enum(['correct', 'incorrect'], {
      errorMap: () => ({ message: "result phải là 'correct' hoặc 'incorrect'" }),
    }),
  }),
};

module.exports = flashcardsSchemas;
