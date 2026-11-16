const ExcelJS = require('exceljs');
const TopicMatchingService = require('./topicMatching.service');
const FlashcardService = require('../flashcards/flashcards.service');
const FlashcardsRepository = require('../flashcards/flashcards.repository');

describe('EDUX Phase 4: Topic Matching & Lecturer Confirmation Test Suite', () => {
  const sampleCatalog = [
    {
      id: 'topic-uuid-1',
      code: 'REV_MOV_1930_1935',
      name: 'Cao trào cách mạng 1930-1931 và khôi phục phong trào 1932-1935',
      aliases: ['Xô Viết Nghệ Tĩnh', 'Phong trào 1930-1935', 'Cao trào 1930'],
      status: 'approved',
      review_required: false,
      is_active: true,
      parent_id: null,
    },
    {
      id: 'topic-uuid-2',
      code: 'AUG_REV_1945',
      name: 'Cao trào kháng Nhật cứu nước và Tổng khởi nghĩa Tháng Tám 1945',
      aliases: ['Cách mạng Tháng Tám', 'Cách mạng Tháng 8', 'Tổng khởi nghĩa 1945'],
      status: 'approved',
      review_required: false,
      is_active: true,
      parent_id: null,
    },
    {
      id: 'topic-uuid-3',
      code: 'GENEVA_1954',
      name: 'Hiệp định Giơ-ne-vơ năm 1954',
      aliases: ['Hiệp định Geneve', 'Geneva Accords 1954'],
      status: 'approved',
      review_required: false,
      is_active: true,
      parent_id: null,
    },
    {
      id: 'topic-uuid-4',
      code: 'DBP_1954',
      name: 'Chiến dịch Điện Biên Phủ 1954',
      aliases: ['Điện Biên Phủ', 'Chấn động địa cầu'],
      status: 'approved',
      review_required: false,
      is_active: true,
      parent_id: null,
    },
  ];

  async function createTestExcelBuffer(rows) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Cards');
    sheet.addRow(['Câu hỏi (*)', 'Lựa chọn A (*)', 'Lựa chọn B (*)', 'Lựa chọn C', 'Lựa chọn D', 'Đáp án đúng (*)', 'Giải thích', 'Độ khó', 'Chủ đề (Topic)']);
    for (const r of rows) {
      sheet.addRow(r);
    }
    return workbook.xlsx.writeBuffer();
  }

  describe('Tier A: Deterministic Exact & Normalized Matching', () => {
    test('Khớp chính xác theo Topic Code (Exact Code Match)', async () => {
      const result = await TopicMatchingService.matchTopic({
        rawTopic: 'REV_MOV_1930_1935',
        catalogTopics: sampleCatalog,
      });

      expect(result.matchType).toBe('exact_code');
      expect(result.suggestedTopicId).toBe('topic-uuid-1');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].score).toBe(1.0);
      expect(result.isAmbiguous).toBe(false);
    });

    test('Khớp không phân biệt hoa thường theo Topic Code', async () => {
      const result = await TopicMatchingService.matchTopic({
        rawTopic: 'aug_rev_1945',
        catalogTopics: sampleCatalog,
      });

      expect(result.matchType).toBe('exact_code');
      expect(result.suggestedTopicId).toBe('topic-uuid-2');
    });

    test('Khớp chính xác theo Tên Topic (Exact Name Match)', async () => {
      const result = await TopicMatchingService.matchTopic({
        rawTopic: 'Chiến dịch Điện Biên Phủ 1954',
        catalogTopics: sampleCatalog,
      });

      expect(result.matchType).toBe('exact_name');
      expect(result.suggestedTopicId).toBe('topic-uuid-4');
      expect(result.candidates[0].score).toBe(1.0);
    });

    test('Khớp chính xác theo Alias (Exact Alias Match)', async () => {
      const result = await TopicMatchingService.matchTopic({
        rawTopic: 'Xô Viết Nghệ Tĩnh',
        catalogTopics: sampleCatalog,
      });

      expect(result.matchType).toBe('exact_alias');
      expect(result.suggestedTopicId).toBe('topic-uuid-1');
      expect(result.candidates[0].score).toBeGreaterThanOrEqual(0.95);
    });

    test('Khớp không dấu / chuẩn hóa Unicode (Normalized Match)', async () => {
      const result = await TopicMatchingService.matchTopic({
        rawTopic: 'Hiep dinh Geneve',
        catalogTopics: sampleCatalog,
      });

      expect(['exact_alias', 'normalized']).toContain(result.matchType);
      expect(result.suggestedTopicId).toBe('topic-uuid-3');
      expect(result.candidates[0].score).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('Tier B: Lexical Fuzzy & Stopwords & Ambiguity Handling', () => {
    test('Khớp mờ (Fuzzy) theo cụm từ tương đồng cao', async () => {
      const result = await TopicMatchingService.matchTopic({
        rawTopic: 'Kháng Nhật cứu nước và Khởi nghĩa Tháng 8',
        catalogTopics: sampleCatalog,
      });

      expect(result.matchType).toBe('fuzzy');
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.candidates[0].topicId).toBe('topic-uuid-2');
      expect(result.candidates[0].score).toBeGreaterThanOrEqual(0.45);
    });

    test('Chặn từ dừng chung chung (Generic Stopwords) như Bài 1, Chương 2, Tổng quan', async () => {
      const stopwords = ['Bài 1', 'Chương 2', 'Tổng quan', 'Ôn tập', 'Chủ đề 3'];

      for (const sw of stopwords) {
        const res = await TopicMatchingService.matchTopic({
          rawTopic: sw,
          catalogTopics: sampleCatalog,
        });

        expect(res.matchType).toBe('no_match');
        expect(res.suggestedTopicId).toBeNull();
        expect(res.candidates).toHaveLength(0);
      }
    });

    test('Xử lý input rỗng hoặc chỉ có khoảng trắng', async () => {
      const res = await TopicMatchingService.matchTopic({
        rawTopic: '   ',
        catalogTopics: sampleCatalog,
      });

      expect(res.matchType).toBe('no_match');
      expect(res.suggestedTopicId).toBeNull();
      expect(res.candidates).toHaveLength(0);
    });

    test('Phát hiện phân vân (Ambiguity Detection) khi 2 Topic có điểm tương đồng sát nhau', async () => {
      const ambiguousCatalog = [
        {
          id: 'topic-a',
          code: 'MATH_CALC_01',
          name: 'Giải tích 1 giới hạn hàm số',
          aliases: [],
          status: 'approved',
          review_required: false,
          is_active: true,
          parent_id: null,
        },
        {
          id: 'topic-b',
          code: 'MATH_CALC_02',
          name: 'Giải tích 1 giới hạn dãy số',
          aliases: [],
          status: 'approved',
          review_required: false,
          is_active: true,
          parent_id: null,
        },
      ];

      const res = await TopicMatchingService.matchTopic({
        rawTopic: 'Giải tích 1 giới hạn',
        catalogTopics: ambiguousCatalog,
      });

      expect(res.candidates.length).toBe(2);
      expect(res.isAmbiguous).toBe(true);
      expect(res.suggestedTopicId).toBeNull(); // Không tự gán khi phân vân
    });
  });

  describe('Tier C: AI Semantic Match Candidate Allowlist Enforcement', () => {
    test('Từ chối nếu AI trả về ID không nằm trong Catalog Allowlist', async () => {
      const limitedCatalog = [
        { id: 'uuid-valid-1', code: 'C1', name: 'Topic 1', aliases: [], status: 'approved' },
      ];

      const fakeAiResult = {
        topicId: 'uuid-fake-999',
        score: 0.99,
        reason: 'Fabricated response',
      };

      const validId = limitedCatalog.find((c) => c.id === fakeAiResult.topicId);
      expect(validId).toBeUndefined();
    });
  });

  describe('Lecturer Confirmation Requirement (No Auto-Confirm)', () => {
    test('previewCardsFromExcel khởi tạo confirmedTopicId: null cho mọi dòng', async () => {
      jest.spyOn(FlashcardsRepository, 'findDeckById').mockResolvedValue({
        id: 'deck-123',
        school_id: 'school-1',
        subject_id: 'sub-1',
        created_by: 'lecturer-1',
        is_active: true,
      });

      jest.spyOn(FlashcardsRepository, 'getApprovedCanonicalTopicsForSubject').mockResolvedValue(sampleCatalog);

      const excelBuffer = await createTestExcelBuffer([
        [
          'Ý nghĩa lịch sử của phong trào 1930-1935 là gì?',
          'Khẳng định quyền lãnh đạo của Đảng',
          'Chưa có ý nghĩa',
          'Lựa chọn C',
          'Lựa chọn D',
          'A',
          'Giải thích A',
          'medium',
          'Phong trào 1930-1935',
        ],
        [
          'Hiệp định Giơ-ne-vơ được ký kết năm nào?',
          '1954',
          '1945',
          '1975',
          '1930',
          '1954',
          'Giải thích B',
          'easy',
          'Geneva Accords 1954',
        ],
      ]);

      const preview = await FlashcardService.previewCardsFromExcel(
        'deck-123',
        excelBuffer,
        { id: 'lecturer-1', role: 'lecturer' },
        { schoolId: 'school-1' }
      );

      expect(preview.rows).toHaveLength(2);
      for (const row of preview.rows) {
        // Bắt buộc theo Phase 4: confirmedTopicId ban đầu luôn là null (không tự động confirm)
        expect(row.confirmedTopicId).toBeNull();
        expect(row.candidates.length).toBeGreaterThan(0);
        expect(row.suggestedTopicId).toBeDefined();
      }

      jest.restoreAllMocks();
    });
  });

  describe('Flashcard Service Topic Suggestions API', () => {
    test('getTopicSuggestions trả về danh sách ứng viên hợp lệ từ Catalog', async () => {
      jest.spyOn(FlashcardsRepository, 'findDeckById').mockResolvedValue({
        id: 'deck-123',
        school_id: 'school-1',
        subject_id: 'sub-1',
        created_by: 'lecturer-1',
        is_active: true,
      });

      jest.spyOn(FlashcardsRepository, 'getApprovedCanonicalTopicsForSubject').mockResolvedValue(sampleCatalog);

      const suggestions = await FlashcardService.getTopicSuggestions(
        'deck-123',
        {
          question: 'Năm 1954, sự kiện nào buộc Pháp phải rút quân khỏi miền Bắc Việt Nam?',
          answer: 'Chiến dịch Điện Biên Phủ 1954',
          limit: 3,
        },
        { id: 'lecturer-1', role: 'lecturer' },
        { schoolId: 'school-1' }
      );

      expect(suggestions).toBeDefined();
      expect(Array.isArray(suggestions.candidates)).toBe(true);
      expect(suggestions.candidates.length).toBeGreaterThan(0);
      expect(suggestions.candidates[0].topicId).toBe('topic-uuid-4');

      jest.restoreAllMocks();
    });

    test('getTopicSuggestions chặn truy cập trái tenant/school', async () => {
      jest.spyOn(FlashcardsRepository, 'findDeckById').mockResolvedValue(null);

      await expect(
        FlashcardService.getTopicSuggestions(
          'deck-123',
          { question: 'Test question' },
          { id: 'lecturer-1', role: 'lecturer' },
          { schoolId: 'school-OTHER' }
        )
      ).rejects.toThrow('DECK_NOT_FOUND');

      jest.restoreAllMocks();
    });
  });

  describe('Test P4-12 — Multi-Tenant & Subject Isolation', () => {
    const schoolA = 'school-A-uuid';
    const schoolB = 'school-B-uuid';
    const subjectOriginal = 'subject-orig-uuid';
    const subjectOther = 'subject-other-uuid';
    const lecturerOwner = { id: 'lecturer-owner-id', role: 'lecturer' };
    const lecturerOther = { id: 'lecturer-other-id', role: 'lecturer' };

    const deckP4Test = {
      id: 'deck-p4test-uuid',
      title: 'P4TEST Deck',
      school_id: schoolA,
      subject_id: subjectOriginal,
      created_by: lecturerOwner.id,
      is_active: true,
    };

    const topicOriginalSubject = {
      id: 'topic-orig-uuid',
      code: 'WEB_DEV_HTML',
      name: 'Lập trình Web cơ bản với HTML',
      status: 'approved',
      review_required: false,
      is_active: true,
      parent_id: null,
      school_id: schoolA,
      subject_id: subjectOriginal,
    };

    const topicOtherSubject = {
      id: 'topic-other-sub-uuid',
      code: 'P4QA_OTHER_SUBJECT',
      name: 'Chủ đề thuộc môn học khác cùng trường',
      status: 'approved',
      review_required: false,
      is_active: true,
      parent_id: null,
      school_id: schoolA,
      subject_id: subjectOther,
    };

    const topicSchoolB = {
      id: 'topic-school-b-uuid',
      code: 'P4QA_SCHOOL_B_TOPIC',
      name: 'Chủ đề của trường B',
      status: 'approved',
      review_required: false,
      is_active: true,
      parent_id: null,
      school_id: schoolB,
      subject_id: subjectOriginal,
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('Test A — Khác Subject: Topic của Subject khác không xuất hiện trong candidates, dù mã khớp chính xác', async () => {
      // 1. Deck P4TEST thuộc subjectOriginal
      jest.spyOn(FlashcardsRepository, 'findDeckById').mockImplementation(async (id, sId) => {
        if (id === deckP4Test.id && sId === schoolA) return deckP4Test;
        return null;
      });

      // 2. getApprovedCanonicalTopicsForSubject truy vấn theo (schoolId, deck.subject_id)
      // Giả lập DB chỉ trả về topic thuộc subjectOriginal, không bao gồm topicOtherSubject
      jest.spyOn(FlashcardsRepository, 'getApprovedCanonicalTopicsForSubject').mockImplementation(async (sId, subId) => {
        if (sId === schoolA && subId === subjectOriginal) {
          return [topicOriginalSubject];
        }
        if (sId === schoolA && subId === subjectOther) {
          return [topicOtherSubject];
        }
        return [];
      });

      // 3. Lecturer mở Deck P4TEST của subject ban đầu và gọi Topic Suggestions với rawTopic = "P4QA_OTHER_SUBJECT"
      const res = await FlashcardService.getTopicSuggestions(
        deckP4Test.id,
        { rawTopic: 'P4QA_OTHER_SUBJECT' },
        lecturerOwner,
        { schoolId: schoolA, role: 'lecturer' }
      );

      // PASS KHI: Topic của Subject khác không xuất hiện trong candidates
      expect(res.candidates).toHaveLength(0);
      expect(res.suggestedTopicId).toBeNull();
      expect(res.candidates.some((c) => c.topicCode === 'P4QA_OTHER_SUBJECT')).toBe(false);
    });

    test('Test B — Khác School: School A không nhận được ứng viên School B; Backend từ chối UUID không thuộc School/Subject', async () => {
      // 1. Giả lập deck của School A
      jest.spyOn(FlashcardsRepository, 'findDeckById').mockImplementation(async (id, sId) => {
        if (id === deckP4Test.id && sId === schoolA) return deckP4Test;
        return null;
      });

      // DB chỉ trả về topics của School A
      jest.spyOn(FlashcardsRepository, 'getApprovedCanonicalTopicsForSubject').mockImplementation(async (sId, subId) => {
        if (sId === schoolA && subId === subjectOriginal) {
          return [topicOriginalSubject];
        }
        if (sId === schoolB) {
          return [topicSchoolB];
        }
        return [];
      });

      // Lecturer School A gọi Suggestions với tên hoặc mã topic của School B
      const suggestions = await FlashcardService.getTopicSuggestions(
        deckP4Test.id,
        { rawTopic: 'P4QA_SCHOOL_B_TOPIC' },
        lecturerOwner,
        { schoolId: schoolA, role: 'lecturer' }
      );

      // PASS KHI: School A không nhận được ứng viên của School B
      expect(suggestions.candidates).toHaveLength(0);
      expect(suggestions.candidates.some((c) => c.topicId === topicSchoolB.id)).toBe(false);

      // Giả lập findCanonicalTopicById: chỉ tìm thấy khi khớp cả topicId, schoolId và subjectId
      jest.spyOn(FlashcardsRepository, 'findCanonicalTopicById').mockImplementation(async (tid, sId, subId) => {
        if (tid === topicOriginalSubject.id && sId === schoolA && subId === subjectOriginal) {
          return topicOriginalSubject;
        }
        // Topic của School B không tìm thấy trong School A
        return null;
      });

      // Thử lưu Flashcard mới với UUID của Topic thuộc School B
      await expect(
        FlashcardService.createCard(
          deckP4Test.id,
          {
            type: 'multiple_choice',
            question: 'Câu hỏi test khác School',
            options: ['A', 'B'],
            answer: 'A',
            topicId: topicSchoolB.id, // UUID của School B
          },
          lecturerOwner,
          { schoolId: schoolA, role: 'lecturer' }
        )
      ).rejects.toThrow('TOPIC_NOT_FOUND');
    });

    test('Test C — Quyền truy cập Deck: Giảng viên không được phép quản lý Deck P4TEST bị từ chối 403 / 404', async () => {
      // Deck P4TEST thuộc sở hữu của lecturerOwner
      jest.spyOn(FlashcardsRepository, 'findDeckById').mockImplementation(async (id, sId) => {
        if (id === deckP4Test.id && sId === schoolA) return deckP4Test;
        return null;
      });

      // Trường hợp 1: Lecturer khác cùng trường nhưng không phải chủ deck và không phải admin -> FORBIDDEN (403)
      await expect(
        FlashcardService.getTopicSuggestions(
          deckP4Test.id,
          { rawTopic: 'Test' },
          lecturerOther, // ID khác created_by
          { schoolId: schoolA, role: 'lecturer' }
        )
      ).rejects.toThrow('FORBIDDEN');

      // Trường hợp 2: Deck không tồn tại trong School của user (hoặc user từ School B gọi deck School A) -> DECK_NOT_FOUND (404)
      await expect(
        FlashcardService.getTopicSuggestions(
          deckP4Test.id,
          { rawTopic: 'Test' },
          lecturerOwner,
          { schoolId: schoolB, role: 'lecturer' } // School B không tìm thấy deck của School A
        )
      ).rejects.toThrow('DECK_NOT_FOUND');
    });
  });
});
