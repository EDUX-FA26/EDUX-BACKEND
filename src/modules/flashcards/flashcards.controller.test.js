const FlashcardsController = require('./flashcards.controller');
const FlashcardsService = require('./flashcards.service');

jest.mock('./flashcards.service');

function createMockRes() {
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('Flashcards Controller Phase 3 Unit Verification', () => {
  const schoolId = '11111111-1111-4111-8111-111111111111';
  const deckId = '22222222-2222-4222-8222-222222222222';
  const cardId = '33333333-3333-4333-8333-333333333333';
  const topicId = '44444444-4444-4444-8444-444444444444';

  const lecturerUser = { id: 'lecturer-1', role: 'lecturer' };
  const tenant = { schoolId, role: 'lecturer' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCard', () => {
    test('returns 201 when card created successfully', async () => {
      const req = {
        params: { deckId },
        body: { question: 'Q1', answer: 'A', topicId },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.createCard.mockResolvedValueOnce({ id: cardId, question: 'Q1', topic_id: topicId });

      await FlashcardsController.createCard(req, res, next);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(cardId);
    });

    test('returns 400 when topic is required', async () => {
      const req = {
        params: { deckId },
        body: { question: 'Q1', answer: 'A' },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.createCard.mockRejectedValueOnce(new Error('TOPIC_REQUIRED'));

      await FlashcardsController.createCard(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Canonical Topic');
    });

    test('returns 409 when topic is not eligible', async () => {
      const req = {
        params: { deckId },
        body: { question: 'Q1', answer: 'A', topicId },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.createCard.mockRejectedValueOnce(new Error('TOPIC_NOT_ELIGIBLE'));

      await FlashcardsController.createCard(req, res, next);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
    });
  });

  describe('updateCard', () => {
    test('returns 400 when attempting to change topic on reviewed card', async () => {
      const req = {
        params: { cardId },
        body: { topicId },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.updateCard.mockRejectedValueOnce(new Error('CANNOT_CHANGE_TOPIC_WITH_REVIEWS'));

      await FlashcardsController.updateCard(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('lịch sử');
    });

    test('returns 400 when attempting to modify question, options or answer on reviewed card', async () => {
      const req = {
        params: { cardId },
        body: { question: 'Changed question' },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.updateCard.mockRejectedValueOnce(new Error('CANNOT_MODIFY_REVIEWED_CARD'));

      await FlashcardsController.updateCard(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('lịch sử ôn tập');
    });
  });

  describe('previewImport', () => {
    test('returns 400 if no file provided', async () => {
      const req = {
        params: { deckId },
        file: null,
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      await FlashcardsController.previewImport(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('returns 200 with preview data on success', async () => {
      const req = {
        params: { deckId },
        file: { buffer: Buffer.from('test') },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.previewCardsFromExcel.mockResolvedValueOnce({
        previewId: 'opaque-uuid',
        totalRows: 5,
        rows: [],
      });

      await FlashcardsController.previewImport(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.previewId).toBe('opaque-uuid');
    });
  });

  describe('confirmImport', () => {
    test('returns 200 on successful confirm', async () => {
      const req = {
        params: { deckId },
        body: {
          previewId: 'opaque-uuid',
          rows: [{ rowNumber: 2, topicId }],
        },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.confirmCardsImport.mockResolvedValueOnce({
        success: true,
        importedCount: 1,
      });

      await FlashcardsController.confirmImport(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('returns 410 when preview is expired or not found', async () => {
      const req = {
        params: { deckId },
        body: { previewId: 'expired-uuid', rows: [] },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.confirmCardsImport.mockRejectedValueOnce(new Error('PREVIEW_EXPIRED'));

      await FlashcardsController.confirmImport(req, res, next);

      expect(res.statusCode).toBe(410);
      expect(res.body.success).toBe(false);
    });

    test('returns 422 when any row lacks a topic', async () => {
      const req = {
        params: { deckId },
        body: { previewId: 'uuid', rows: [] },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.confirmCardsImport.mockRejectedValueOnce(new Error('ROW_TOPIC_MISSING'));

      await FlashcardsController.confirmImport(req, res, next);

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
    });

    test('returns 409 when confirmation is already in progress', async () => {
      const req = {
        params: { deckId },
        body: { previewId: 'uuid', rows: [{ rowNumber: 2, topicId }] },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.confirmCardsImport.mockRejectedValueOnce(new Error('CONFIRM_IN_PROGRESS'));

      await FlashcardsController.confirmImport(req, res, next);

      expect(res.statusCode).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('đang được xử lý');
    });

    test('returns 422 when rows contain duplicate rowNumbers', async () => {
      const req = {
        params: { deckId },
        body: { previewId: 'uuid', rows: [{ rowNumber: 2, topicId }, { rowNumber: 2, topicId }] },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.confirmCardsImport.mockRejectedValueOnce(new Error('DUPLICATE_ROW_NUMBER'));

      await FlashcardsController.confirmImport(req, res, next);

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('trùng lặp');
    });

    test('returns 422 when rows contain invalid rowNumbers', async () => {
      const req = {
        params: { deckId },
        body: { previewId: 'uuid', rows: [{ rowNumber: 999, topicId }] },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.confirmCardsImport.mockRejectedValueOnce(new Error('INVALID_ROW_NUMBER'));

      await FlashcardsController.confirmImport(req, res, next);

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('không hợp lệ');
    });
  });

  describe('importCards (Legacy)', () => {
    test('returns 400 when attempting direct import', async () => {
      const req = {
        params: { deckId },
        file: { buffer: Buffer.from('test') },
        user: lecturerUser,
        tenant,
      };
      const res = createMockRes();
      const next = jest.fn();

      FlashcardsService.importCardsFromExcel.mockRejectedValueOnce(new Error('DIRECT_IMPORT_DEPRECATED'));

      await FlashcardsController.importCards(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Preview');
    });
  });
});
