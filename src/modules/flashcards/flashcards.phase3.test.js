const ExcelJS = require('exceljs');
const FlashcardsRepository = require('./flashcards.repository');
const FlashcardsService = require('./flashcards.service');
const { createCard, updateCard, confirmImport } = require('./flashcards.validation');

jest.mock('./flashcards.repository', () => ({
  findDeckById: jest.fn(),
  findCardById: jest.fn(),
  findCanonicalTopicById: jest.fn(),
  getApprovedCanonicalTopicsForSubject: jest.fn(),
  getCardReviewCount: jest.fn(),
  getNextPosition: jest.fn().mockResolvedValue(1),
  createCard: jest.fn(),
  updateCard: jest.fn(),
  createCardsBatchWithTopics: jest.fn(),
  deleteCard: jest.fn(),
}));

describe('EDUX Phase 3: Lecturer Flashcard & Excel Import with Canonical Topic', () => {
  const schoolId = '11111111-1111-4111-8111-111111111111';
  const otherSchoolId = '22222222-2222-4222-8222-222222222222';
  const subjectId = '33333333-3333-4333-8333-333333333333';
  const otherSubjectId = '44444444-4444-4444-8444-444444444444';
  const deckId = '55555555-5555-4555-8555-555555555555';
  const cardId = '66666666-6666-4666-8666-666666666666';
  const topicId = '77777777-7777-4777-8777-777777777777';
  const newTopicId = '88888888-8888-4888-8888-888888888888';

  const lecturerUser = { id: 'lecturer-uuid-1', role: 'lecturer' };
  const tenant = { schoolId, role: 'lecturer' };

  const validCanonicalTopic = {
    id: topicId,
    subject_id: subjectId,
    school_id: schoolId,
    name: 'Biến và Kiểu dữ liệu',
    code: 'VAR_DATA_TYPES',
    status: 'approved',
    review_required: false,
    is_active: true,
    parent_id: null,
  };

  const sampleDeck = {
    id: deckId,
    school_id: schoolId,
    subject_id: subjectId,
    created_by: lecturerUser.id,
    deck_owner_id: lecturerUser.id,
    title: 'Deck Lập trình C',
    is_active: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    FlashcardsRepository.findDeckById.mockResolvedValue(sampleDeck);
    FlashcardsRepository.getNextPosition.mockResolvedValue(1);
  });

  // ─────────────────────────────────────────────────────────
  // 1. CREATE CARD
  // ─────────────────────────────────────────────────────────
  describe('1. createCard with Canonical Topic verification', () => {
    test('rejects creation when topicId is missing', async () => {
      await expect(
        FlashcardsService.createCard(
          deckId,
          {
            type: 'multiple_choice',
            question: 'Biến là gì?',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A',
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('TOPIC_REQUIRED');
    });

    test('rejects creation when topicId does not exist', async () => {
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValueOnce(null);

      await expect(
        FlashcardsService.createCard(
          deckId,
          {
            topicId,
            type: 'multiple_choice',
            question: 'Biến là gì?',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A',
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('TOPIC_NOT_FOUND');
    });

    test('rejects creation when topic belongs to another subject', async () => {
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValueOnce(null);

      await expect(
        FlashcardsService.createCard(
          deckId,
          {
            topicId,
            type: 'multiple_choice',
            question: 'Biến là gì?',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A',
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('TOPIC_NOT_FOUND');
    });

    test('rejects creation when topic is unapproved, inactive or review_required', async () => {
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValueOnce({
        ...validCanonicalTopic,
        status: 'pending',
      });

      await expect(
        FlashcardsService.createCard(
          deckId,
          {
            topicId,
            type: 'multiple_choice',
            question: 'Biến là gì?',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A',
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('TOPIC_NOT_ELIGIBLE');

      // Review required = true (legacy unconfirmed)
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValueOnce({
        ...validCanonicalTopic,
        review_required: true,
      });

      await expect(
        FlashcardsService.createCard(
          deckId,
          {
            topicId,
            type: 'multiple_choice',
            question: 'Biến là gì?',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A',
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('TOPIC_NOT_ELIGIBLE');

      // Inactive
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValueOnce({
        ...validCanonicalTopic,
        is_active: false,
      });

      await expect(
        FlashcardsService.createCard(
          deckId,
          {
            topicId,
            type: 'multiple_choice',
            question: 'Biến là gì?',
            options: ['A', 'B', 'C', 'D'],
            answer: 'A',
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('TOPIC_NOT_ELIGIBLE');
    });

    test('successfully creates card and binds canonical topic', async () => {
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValueOnce(validCanonicalTopic);
      FlashcardsRepository.createCard.mockResolvedValueOnce({
        id: cardId,
        deck_id: deckId,
        question: 'Biến là gì?',
        topic_id: topicId,
        topic_name: 'Biến và Kiểu dữ liệu',
      });

      const result = await FlashcardsService.createCard(
        deckId,
        {
          topicId,
          type: 'multiple_choice',
          question: 'Biến là gì?',
          options: ['A', 'B', 'C', 'D'],
          answer: 'A',
        },
        lecturerUser,
        tenant
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(cardId);
      expect(FlashcardsRepository.createCard).toHaveBeenCalledWith(
        expect.objectContaining({ topic_id: topicId, subject_id: subjectId, school_id: schoolId })
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // 2. UPDATE CARD & REVIEW LOCKING
  // ─────────────────────────────────────────────────────────
  describe('2. updateCard and Review Protection rule', () => {
    const existingCard = {
      id: cardId,
      deck_id: deckId,
      school_id: schoolId,
      subject_id: subjectId,
      created_by: lecturerUser.id,
      deck_owner_id: lecturerUser.id,
      topic_id: topicId,
      is_active: true,
      question: 'Câu hỏi cũ',
      options: ['A', 'B'],
      answer: 'A',
    };

    test('allows updating card content without changing topic when card has 0 reviews', async () => {
      FlashcardsRepository.findCardById.mockResolvedValueOnce(existingCard);
      FlashcardsRepository.getCardReviewCount.mockResolvedValueOnce(0);
      FlashcardsRepository.updateCard.mockResolvedValueOnce({
        ...existingCard,
        question: 'Câu hỏi mới cập nhật',
      });

      const updated = await FlashcardsService.updateCard(
        cardId,
        { question: 'Câu hỏi mới cập nhật' },
        lecturerUser,
        tenant
      );

      expect(updated.question).toBe('Câu hỏi mới cập nhật');
      expect(FlashcardsRepository.getCardReviewCount).toHaveBeenCalledWith(cardId, schoolId);
    });

    test('allows changing topic if card has 0 reviews and new topic is canonical eligible', async () => {
      FlashcardsRepository.findCardById.mockResolvedValueOnce(existingCard);
      FlashcardsRepository.getCardReviewCount.mockResolvedValueOnce(0);
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValueOnce({
        ...validCanonicalTopic,
        id: newTopicId,
        name: 'Vòng lặp và Rẽ nhánh',
      });
      FlashcardsRepository.updateCard.mockResolvedValueOnce({
        ...existingCard,
        topic_id: newTopicId,
        topic_name: 'Vòng lặp và Rẽ nhánh',
      });

      const updated = await FlashcardsService.updateCard(
        cardId,
        { topicId: newTopicId },
        lecturerUser,
        tenant
      );

      expect(updated.topic_id).toBe(newTopicId);
      expect(FlashcardsRepository.getCardReviewCount).toHaveBeenCalledWith(cardId, schoolId);
      expect(FlashcardsRepository.updateCard).toHaveBeenCalledWith(
        cardId,
        expect.anything(),
        expect.objectContaining({ topic_id: newTopicId })
      );
    });

    test('blocks changing topic if card already has student reviews', async () => {
      FlashcardsRepository.findCardById.mockResolvedValueOnce(existingCard);
      FlashcardsRepository.getCardReviewCount.mockResolvedValueOnce(12); // Has 12 reviews!

      await expect(
        FlashcardsService.updateCard(
          cardId,
          { topicId: newTopicId },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('CANNOT_CHANGE_TOPIC_WITH_REVIEWS');

      expect(FlashcardsRepository.updateCard).not.toHaveBeenCalled();
    });

    test('blocks modifying question if card already has student reviews', async () => {
      FlashcardsRepository.findCardById.mockResolvedValueOnce(existingCard);
      FlashcardsRepository.getCardReviewCount.mockResolvedValueOnce(5);

      await expect(
        FlashcardsService.updateCard(
          cardId,
          { question: 'Nội dung câu hỏi mới đã sửa' },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('CANNOT_MODIFY_REVIEWED_CARD');

      expect(FlashcardsRepository.updateCard).not.toHaveBeenCalled();
    });

    test('blocks modifying options if card already has student reviews', async () => {
      FlashcardsRepository.findCardById.mockResolvedValueOnce(existingCard);
      FlashcardsRepository.getCardReviewCount.mockResolvedValueOnce(5);

      await expect(
        FlashcardsService.updateCard(
          cardId,
          { options: ['Option 1', 'Option 2', 'Option 3'] },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('CANNOT_MODIFY_REVIEWED_CARD');

      expect(FlashcardsRepository.updateCard).not.toHaveBeenCalled();
    });

    test('blocks modifying answer if card already has student reviews', async () => {
      FlashcardsRepository.findCardById.mockResolvedValueOnce(existingCard);
      FlashcardsRepository.getCardReviewCount.mockResolvedValueOnce(5);

      await expect(
        FlashcardsService.updateCard(
          cardId,
          { answer: 'B' },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('CANNOT_MODIFY_REVIEWED_CARD');

      expect(FlashcardsRepository.updateCard).not.toHaveBeenCalled();
    });

    test('allows updating non-structural fields (explanation, difficulty) on reviewed card', async () => {
      FlashcardsRepository.findCardById.mockResolvedValueOnce(existingCard);
      FlashcardsRepository.getCardReviewCount.mockResolvedValueOnce(5);
      FlashcardsRepository.updateCard.mockResolvedValueOnce({
        ...existingCard,
        explanation: 'Giải thích mới chi tiết hơn',
        difficulty: 'hard',
      });

      const res = await FlashcardsService.updateCard(
        cardId,
        { explanation: 'Giải thích mới chi tiết hơn', difficulty: 'hard' },
        lecturerUser,
        tenant
      );

      expect(res.explanation).toBe('Giải thích mới chi tiết hơn');
      expect(FlashcardsRepository.updateCard).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────
  // 3. EXCEL IMPORT PREVIEW & DETERMINISTIC MATCHING
  // ─────────────────────────────────────────────────────────
  describe('3. previewCardsFromExcel deterministic matching', () => {
    async function createTestExcelBuffer(rows) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Cards');
      sheet.addRow(['Câu hỏi (*)', 'Lựa chọn A (*)', 'Lựa chọn B (*)', 'Lựa chọn C', 'Lựa chọn D', 'Đáp án đúng (*)', 'Giải thích', 'Độ khó', 'Chủ đề (Topic)']);
      for (const r of rows) {
        sheet.addRow(r);
      }
      return workbook.xlsx.writeBuffer();
    }

    test('parses cards and matches topic by code, name and alias', async () => {
      const approvedCatalog = [
        {
          id: 'topic-111',
          name: 'Biến và Kiểu dữ liệu',
          code: 'VAR_TYPE',
          aliases: ['Bien và kieu', 'Biến'],
        },
        {
          id: 'topic-222',
          name: 'Cấu trúc rẽ nhánh If Else',
          code: 'IF_ELSE',
          aliases: ['Điều kiện', 'Branching'],
        },
      ];

      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValueOnce(approvedCatalog);

      const excelBuffer = await createTestExcelBuffer([
        // Row 2: Match by exact code
        ['Kiểu int có kích thước mấy byte?', '2 byte', '4 byte', '8 byte', '1 byte', 'B', 'Chuẩn C 32-bit/64-bit', 'easy', 'VAR_TYPE'],
        // Row 3: Match by exact name
        ['Cú pháp if lồng nhau?', 'if inside if', 'switch', 'for', 'while', 'A', 'Nested logic', 'medium', 'Cấu trúc rẽ nhánh If Else'],
        // Row 4: Match by alias
        ['Điều kiện switch case?', 'case 1', 'case 2', 'default', 'all', 'D', 'Check all cases', 'hard', 'Branching'],
        // Row 5: Unknown topic label
        ['Hàm đệ quy là gì?', 'Gọi chính nó', 'Vòng lặp', 'Con trỏ', 'Mảng', 'A', 'Recursion concept', 'hard', 'Chủ đề chưa có trong trường'],
      ]);

      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        excelBuffer,
        lecturerUser,
        tenant
      );

      expect(preview).toBeDefined();
      expect(preview.previewId).toBeDefined();
      expect(preview.totalRows).toBe(4);
      expect(preview.rows).toHaveLength(4);

      // Row 1 (Code match)
      expect(preview.rows[0].candidates).toHaveLength(1);
      expect(preview.rows[0].candidates[0].topicId).toBe('topic-111');
      expect(preview.rows[0].candidates[0].matchType).toBe('exact_code');
      expect(preview.rows[0].confirmedTopicId).toBeNull(); // Never auto-confirmed

      // Row 2 (Name match)
      expect(preview.rows[1].candidates).toHaveLength(1);
      expect(preview.rows[1].candidates[0].topicId).toBe('topic-222');
      expect(preview.rows[1].candidates[0].matchType).toBe('exact_name');
      expect(preview.rows[1].confirmedTopicId).toBeNull();

      // Row 3 (Alias match)
      expect(preview.rows[2].candidates).toHaveLength(1);
      expect(preview.rows[2].candidates[0].topicId).toBe('topic-222');
      expect(preview.rows[2].candidates[0].matchType).toBe('exact_alias');
      expect(preview.rows[2].confirmedTopicId).toBeNull();

      // Row 4 (Unresolved label)
      expect(preview.rows[3].candidates).toHaveLength(0);
      expect(preview.rows[3].confirmedTopicId).toBeNull();
    });

    test('rejects workbook with no worksheets', async () => {
      const workbook = new ExcelJS.Workbook();
      const buffer = await workbook.xlsx.writeBuffer();

      await expect(
        FlashcardsService.previewCardsFromExcel(deckId, buffer, lecturerUser, tenant)
      ).rejects.toThrow('EMPTY_WORKBOOK');
    });
  });

  // ─────────────────────────────────────────────────────────
  // 4. CONFIRM CARDS IMPORT & TRANSACTION
  // ─────────────────────────────────────────────────────────
  describe('4. confirmCardsImport transactional commit', () => {
    async function createTestExcelBuffer(rows) {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Cards');
      sheet.addRow(['Question', 'A', 'B', 'C', 'D', 'Correct', 'Explanation', 'Difficulty', 'Topic']);
      for (const r of rows) {
        sheet.addRow(r);
      }
      return workbook.xlsx.writeBuffer();
    }

    test('rejects confirm when any row is missing a topicId', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValueOnce([validCanonicalTopic]);

      const buffer = await createTestExcelBuffer([
        ['Câu 1?', 'A', 'B', 'C', 'D', 'A', 'Exp 1', 'easy', 'VAR_DATA_TYPES'],
        ['Câu 2?', 'A', 'B', 'C', 'D', 'B', 'Exp 2', 'easy', 'UNKNOWN_TOPIC'],
      ]);

      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      // Only confirm row 2, leave row 3 missing
      await expect(
        FlashcardsService.confirmCardsImport(
          deckId,
          {
            previewId: preview.previewId,
            rows: [
              { rowNumber: 2, topicId: validCanonicalTopic.id },
              // Row 3 is omitted
            ],
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('ROW_TOPIC_MISSING');
    });

    test('successfully confirms and batch creates cards with topics', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValue([validCanonicalTopic]);
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValue(validCanonicalTopic);

      const buffer = await createTestExcelBuffer([
        ['Câu 1?', 'A', 'B', 'C', 'D', 'A', 'Exp 1', 'easy', 'VAR_DATA_TYPES'],
      ]);

      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      FlashcardsRepository.createCardsBatchWithTopics.mockResolvedValueOnce([
        { id: 'card-1', question: 'Câu 1?', topic_id: validCanonicalTopic.id },
      ]);

      const result = await FlashcardsService.confirmCardsImport(
        deckId,
        {
          previewId: preview.previewId,
          rows: [
            { rowNumber: 2, topicId: validCanonicalTopic.id },
          ],
        },
        lecturerUser,
        tenant
      );

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(FlashcardsRepository.createCardsBatchWithTopics).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            question: 'Câu 1?',
            topic_id: validCanonicalTopic.id,
          }),
        ]),
        expect.objectContaining({
          subject_id: subjectId,
          school_id: schoolId,
        })
      );

      // Test idempotency on retry with same preview
      const retryResult = await FlashcardsService.confirmCardsImport(
        deckId,
        {
          previewId: preview.previewId,
          rows: [
            { rowNumber: 2, topicId: validCanonicalTopic.id },
          ],
        },
        lecturerUser,
        tenant
      );
      expect(retryResult.success).toBe(true);
      expect(retryResult.idempotent).toBe(true);
    });

    test('rejects confirm when userId does not match preview session creator', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValueOnce([validCanonicalTopic]);
      const buffer = await createTestExcelBuffer([
        ['Câu 1?', 'A', 'B', 'C', 'D', 'A', 'Exp 1', 'easy', 'VAR_DATA_TYPES'],
      ]);
      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      const otherUser = { id: 'other-lecturer-id', role: 'school_admin' };
      const adminTenant = { schoolId, role: 'school_admin' };
      await expect(
        FlashcardsService.confirmCardsImport(
          deckId,
          {
            previewId: preview.previewId,
            rows: [{ rowNumber: 2, topicId: validCanonicalTopic.id }],
          },
          otherUser,
          adminTenant
        )
      ).rejects.toThrow('PREVIEW_ACCESS_DENIED');
    });

    test('rejects confirm when deckId does not match preview session deck', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValueOnce([validCanonicalTopic]);
      const buffer = await createTestExcelBuffer([
        ['Câu 1?', 'A', 'B', 'C', 'D', 'A', 'Exp 1', 'easy', 'VAR_DATA_TYPES'],
      ]);
      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      await expect(
        FlashcardsService.confirmCardsImport(
          '99999999-9999-9999-9999-999999999999',
          {
            previewId: preview.previewId,
            rows: [{ rowNumber: 2, topicId: validCanonicalTopic.id }],
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('PREVIEW_DECK_MISMATCH');
    });

    test('rejects confirm when rows contain duplicate rowNumbers', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValueOnce([validCanonicalTopic]);
      const buffer = await createTestExcelBuffer([
        ['Câu 1?', 'A', 'B', 'C', 'D', 'A', 'Exp 1', 'easy', 'VAR_DATA_TYPES'],
      ]);
      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      await expect(
        FlashcardsService.confirmCardsImport(
          deckId,
          {
            previewId: preview.previewId,
            rows: [
              { rowNumber: 2, topicId: validCanonicalTopic.id },
              { rowNumber: 2, topicId: validCanonicalTopic.id },
            ],
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('DUPLICATE_ROW_NUMBER');
    });

    test('rejects confirm when rows contain rowNumber not present in preview', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValueOnce([validCanonicalTopic]);
      const buffer = await createTestExcelBuffer([
        ['Câu 1?', 'A', 'B', 'C', 'D', 'A', 'Exp 1', 'easy', 'VAR_DATA_TYPES'],
      ]);
      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      await expect(
        FlashcardsService.confirmCardsImport(
          deckId,
          {
            previewId: preview.previewId,
            rows: [
              { rowNumber: 2, topicId: validCanonicalTopic.id },
              { rowNumber: 999, topicId: validCanonicalTopic.id },
            ],
          },
          lecturerUser,
          tenant
        )
      ).rejects.toThrow('INVALID_ROW_NUMBER');
    });

    test('rejects concurrent confirm when lock is active with CONFIRM_IN_PROGRESS', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValue([validCanonicalTopic]);
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValue(validCanonicalTopic);

      const buffer = await createTestExcelBuffer([
        ['Câu 1?', 'A', 'B', 'C', 'D', 'A', 'Exp 1', 'easy', 'VAR_DATA_TYPES'],
      ]);
      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      FlashcardsRepository.createCardsBatchWithTopics.mockImplementationOnce(async () => {
        // While this creation is in-flight and holding lock, concurrent request should fail
        await expect(
          FlashcardsService.confirmCardsImport(
            deckId,
            {
              previewId: preview.previewId,
              rows: [{ rowNumber: 2, topicId: validCanonicalTopic.id }],
            },
            lecturerUser,
            tenant
          )
        ).rejects.toThrow('CONFIRM_IN_PROGRESS');

        return [{ id: 'card-1', question: 'Câu 1?' }];
      });

      const res = await FlashcardsService.confirmCardsImport(
        deckId,
        {
          previewId: preview.previewId,
          rows: [{ rowNumber: 2, topicId: validCanonicalTopic.id }],
        },
        lecturerUser,
        tenant
      );
      expect(res.success).toBe(true);
    });

    test('guarantees card content comes from server-side preview, ignoring client modifications', async () => {
      FlashcardsRepository.getApprovedCanonicalTopicsForSubject.mockResolvedValue([validCanonicalTopic]);
      FlashcardsRepository.findCanonicalTopicById.mockResolvedValue(validCanonicalTopic);

      const buffer = await createTestExcelBuffer([
        ['Câu hỏi gốc từ file Excel', 'A', 'B', 'C', 'D', 'A', 'Giải thích gốc', 'easy', 'VAR_DATA_TYPES'],
      ]);
      const preview = await FlashcardsService.previewCardsFromExcel(
        deckId,
        buffer,
        lecturerUser,
        tenant
      );

      FlashcardsRepository.createCardsBatchWithTopics.mockResolvedValueOnce([
        { id: 'card-1', question: 'Câu hỏi gốc từ file Excel' },
      ]);

      await FlashcardsService.confirmCardsImport(
        deckId,
        {
          previewId: preview.previewId,
          rows: [
            {
              rowNumber: 2,
              topicId: validCanonicalTopic.id,
              // Malicious client tampering attempt
              question: 'HACKED QUESTION',
              answer: 'HACKED ANSWER',
            },
          ],
        },
        lecturerUser,
        tenant
      );

      expect(FlashcardsRepository.createCardsBatchWithTopics).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            question: 'Câu hỏi gốc từ file Excel', // Original, untampered question
          }),
        ]),
        expect.anything()
      );
    });
  });

  // ─────────────────────────────────────────────────────────
  // 5. ZOD VALIDATION SCHEMAS
  // ─────────────────────────────────────────────────────────
  describe('5. Zod Validation Schemas', () => {
    test('createCard schema requires topicId as UUID', () => {
      const valid = createCard.safeParse({
        topicId: '11111111-1111-4111-8111-111111111111',
        question: 'What is X?',
        options: ['A', 'B'],
        answer: 'A',
      });
      expect(valid.success).toBe(true);

      const missingTopic = createCard.safeParse({
        question: 'What is X?',
        options: ['A', 'B'],
        answer: 'A',
      });
      expect(missingTopic.success).toBe(false);

      const invalidTopicUUID = createCard.safeParse({
        topicId: 'not-a-valid-uuid',
        question: 'What is X?',
        options: ['A', 'B'],
        answer: 'A',
      });
      expect(invalidTopicUUID.success).toBe(false);
    });

    test('confirmImport schema validates previewId and rows array', () => {
      const valid = confirmImport.safeParse({
        previewId: '550e8400-e29b-41d4-a716-446655440000',
        rows: [
          { rowNumber: 2, topicId: '11111111-1111-4111-8111-111111111111' },
        ],
      });
      expect(valid.success).toBe(true);

      const missingPreviewId = confirmImport.safeParse({
        rows: [{ rowNumber: 2, topicId: '11111111-1111-4111-8111-111111111111' }],
      });
      expect(missingPreviewId.success).toBe(false);

      const invalidRow = confirmImport.safeParse({
        previewId: '550e8400-e29b-41d4-a716-446655440000',
        rows: [{ rowNumber: 'not-a-number', topicId: 'invalid' }],
      });
      expect(invalidRow.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────
  // 6. LEGACY DEPRECATION & ZERO TOPIC CREATION GUARANTEE
  // ─────────────────────────────────────────────────────────
  describe('6. Legacy Deprecation & Zero Topic Auto-Creation Guarantee', () => {
    test('direct importCardsFromExcel throws DIRECT_IMPORT_DEPRECATED', async () => {
      await expect(
        FlashcardsService.importCardsFromExcel(deckId, Buffer.from('test'), lecturerUser, tenant)
      ).rejects.toThrow('DIRECT_IMPORT_DEPRECATED');
    });

    test('findOrCreateTopic unconditionally throws FIND_OR_CREATE_TOPIC_DEPRECATED', async () => {
      const actualRepo = jest.requireActual('./flashcards.repository');
      await expect(
        actualRepo.findOrCreateTopic('Biến', subjectId, schoolId)
      ).rejects.toThrow('FIND_OR_CREATE_TOPIC_DEPRECATED');
    });
  });
});
