const TopicsRepository = require('./topics.repository');
const LearningRepository = require('../learning/learning.repository');
const TopicsService = require('./topics.service');

jest.mock('./topics.repository', () => ({
  isLecturerAssignedToSubject: jest.fn(),
  findSubject: jest.fn(),
  findById: jest.fn(),
  findDetail: jest.fn(),
  listBySubject: jest.fn(),
  listCatalog: jest.fn(),
  findConflictByName: jest.fn(),
  findConflictByCode: jest.fn(),
  checkAliasConflict: jest.fn(),
  createCanonical: jest.fn(),
  createProposal: jest.fn(),
  update: jest.fn(),
  confirmLegacy: jest.fn(),
  reviewProposal: jest.fn(),
  setStatus: jest.fn(),
  getReferenceCounts: jest.fn(),
  listAliases: jest.fn(),
  createAlias: jest.fn(),
  deleteAlias: jest.fn(),
  findAliasById: jest.fn(),
  findFlashcardContext: jest.fn(),
  upsertManualMapping: jest.fn(),
  findSubjectTopicCatalog: jest.fn(),
  createCanonicalBatch: jest.fn(),
}));

jest.mock('../learning/learning.repository', () => ({
  findSubjectById: jest.fn(),
}));

describe('EDUX Phase 2: Canonical Topic & School Admin Repository (Flat Model)', () => {
  const schoolA = '11111111-1111-4111-8111-111111111111';
  const schoolB = '22222222-2222-4222-8222-222222222222';
  const subjectId = '33333333-3333-4333-8333-333333333333';
  const topicId = '44444444-4444-4444-8444-444444444444';

  const adminUser = { id: 'admin-1', role: 'school_admin' };
  const lecturerUser = { id: 'lecturer-1', role: 'lecturer' };
  const studentUser = { id: 'student-1', role: 'student' };

  beforeEach(() => {
    jest.clearAllMocks();
    TopicsRepository.findSubject.mockResolvedValue({
      id: subjectId,
      name: 'Programming Fundamentals',
      code: 'PRF192',
      school_id: schoolA,
      is_active: true,
    });
    TopicsRepository.isLecturerAssignedToSubject.mockResolvedValue(true);
  });

  describe('1. Flat Model: No Chapter / No parentId', () => {
    test('rejects creation if parentId is provided', async () => {
      await expect(
        TopicsService.create(
          {
            subjectId,
            name: 'Pointers',
            parentId: '55555555-5555-4555-8555-555555555555',
          },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('INVALID_PARENT_TOPIC');
    });

    test('rejects update if parentId is provided', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: topicId,
        subject_id: subjectId,
        school_id: schoolA,
        name: 'Pointers',
      });

      await expect(
        TopicsService.update(
          topicId,
          { parentId: '55555555-5555-4555-8555-555555555555' },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('INVALID_PARENT_TOPIC');
    });
  });

  describe('2. School Admin Canonical Topic Creation & Conflict Handling', () => {
    test('creates canonical topic with approved status, review_required=false, reviewed_by=admin', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null);
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce(null);
      TopicsRepository.createCanonical.mockResolvedValueOnce({
        id: topicId,
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Dynamic Memory Allocation',
        code: 'DMA_01',
        description: 'malloc and free in C',
        parent_id: null,
        status: 'approved',
        review_required: false,
        reviewed_by: adminUser.id,
        is_active: true,
      });

      const result = await TopicsService.create(
        {
          subjectId,
          name: 'Dynamic Memory Allocation',
          code: 'DMA_01',
          description: 'malloc and free in C',
        },
        adminUser,
        schoolA
      );

      expect(result.status).toBe('approved');
      expect(result.review_required).toBe(false);
      expect(result.parent_id).toBeNull();
      expect(TopicsRepository.createCanonical).toHaveBeenCalledWith({
        schoolId: schoolA,
        subjectId,
        name: 'Dynamic Memory Allocation',
        code: 'DMA_01',
        description: 'malloc and free in C',
        createdBy: adminUser.id,
      });
    });

    test('rejects creation if topic name already exists in same school+subject', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce({
        id: 'existing-id',
        name: 'Pointers',
      });

      await expect(
        TopicsService.create(
          { subjectId, name: 'Pointers', code: 'PTR_01' },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('TOPIC_DUPLICATE_NAME');
    });

    test('rejects creation if topic code already exists in same school+subject', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.findConflictByCode.mockResolvedValueOnce({
        id: 'existing-id',
        code: 'PTR_01',
      });

      await expect(
        TopicsService.create(
          { subjectId, name: 'Pointers Basic', code: 'PTR_01' },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('TOPIC_DUPLICATE_CODE');
    });

    test('rejects creation if topic name conflicts with an existing alias in same school+subject', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce({
        type: 'alias',
        conflict: { id: 'alias-1', alias: 'Con trỏ' },
      });

      await expect(
        TopicsService.create(
          { subjectId, name: 'Con trỏ' },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('ALIAS_CONFLICT');
    });

    test('maps DB unique constraint violation 23505 to appropriate error code', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      const dbErr = new Error('duplicate key value violates unique constraint "uq_topics_flat_name_normalized_v1"');
      dbErr.code = '23505';
      dbErr.constraint = 'uq_topics_flat_name_normalized_v1';
      TopicsRepository.createCanonical.mockRejectedValueOnce(dbErr);

      await expect(
        TopicsService.create({ subjectId, name: 'Pointers' }, adminUser, schoolA)
      ).rejects.toThrow('TOPIC_DUPLICATE_NAME');
    });
  });

  describe('3. Legacy Topic Confirmation (32 baseline records)', () => {
    test('confirms legacy topic: preserves UUID, clears review_required, sets audit fields', async () => {
      const legacyTopic = {
        id: topicId,
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Legacy Pointers',
        code: null,
        status: 'approved',
        review_required: true,
        reviewed_by: null,
        reviewed_at: null,
      };
      TopicsRepository.findById.mockResolvedValueOnce(legacyTopic);
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null);
      TopicsRepository.confirmLegacy.mockResolvedValueOnce({
        ...legacyTopic,
        code: 'PTR_LEGACY',
        review_required: false,
        reviewed_by: adminUser.id,
        review_note: 'Verified syllabus alignment for FA26',
      });

      const confirmed = await TopicsService.confirmLegacy(
        topicId,
        {
          code: 'PTR_LEGACY',
          reviewNote: 'Verified syllabus alignment for FA26',
        },
        adminUser,
        schoolA
      );

      expect(confirmed.id).toBe(topicId); // UUID preserved!
      expect(confirmed.review_required).toBe(false);
      expect(confirmed.reviewed_by).toBe(adminUser.id);
      expect(TopicsRepository.confirmLegacy).toHaveBeenCalledWith(
        topicId,
        {
          code: 'PTR_LEGACY',
          name: undefined,
          description: undefined,
          reviewNote: 'Verified syllabus alignment for FA26',
          reviewedBy: adminUser.id,
        },
        schoolA
      );
    });
  });

  describe('4. Lecturer Proposals and Admin Review Flow', () => {
    test('lecturer creates proposal without code: sets pending_approval, review_required=true, code=null', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.createProposal.mockResolvedValueOnce({
        id: 'prop-1',
        subject_id: subjectId,
        school_id: schoolA,
        name: 'Bitwise Operations',
        code: null,
        status: 'pending_approval',
        review_required: true,
        created_by: lecturerUser.id,
      });

      const prop = await TopicsService.createProposal(
        {
          subjectId,
          name: 'Bitwise Operations',
          reason: 'Needed for Chapter 3 bit manipulation flashcards',
        },
        lecturerUser,
        schoolA
      );

      expect(prop.status).toBe('pending_approval');
      expect(prop.review_required).toBe(true);
      expect(TopicsRepository.createProposal).toHaveBeenCalledWith({
        schoolId: schoolA,
        subjectId,
        name: 'Bitwise Operations',
        code: null,
        description: '',
        createdBy: lecturerUser.id,
        reason: 'Needed for Chapter 3 bit manipulation flashcards',
      });
    });

    test('lecturer creates proposal with code: passes code as separate field', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null);
      TopicsRepository.createProposal.mockResolvedValueOnce({
        id: 'prop-2',
        subject_id: subjectId,
        school_id: schoolA,
        name: 'Geneva Accords 1954',
        code: 'GENEVA_ACCORDS_1954',
        description: 'Lịch sử quan trọng',
        status: 'pending_approval',
        review_required: true,
        created_by: lecturerUser.id,
      });

      const prop = await TopicsService.createProposal(
        {
          subjectId,
          name: 'Geneva Accords 1954',
          code: 'GENEVA_ACCORDS_1954',
          description: 'Lịch sử quan trọng',
          reason: 'Đề cương môn Lịch sử Đảng',
        },
        lecturerUser,
        schoolA
      );

      expect(prop.code).toBe('GENEVA_ACCORDS_1954');
      expect(TopicsRepository.findConflictByCode).toHaveBeenCalledWith(
        schoolA,
        subjectId,
        'GENEVA_ACCORDS_1954'
      );
      expect(TopicsRepository.createProposal).toHaveBeenCalledWith({
        schoolId: schoolA,
        subjectId,
        name: 'Geneva Accords 1954',
        code: 'GENEVA_ACCORDS_1954',
        description: 'Lịch sử quan trọng',
        createdBy: lecturerUser.id,
        reason: 'Đề cương môn Lịch sử Đảng',
      });
    });

    test('rejects proposal if suggested code conflicts with existing topic in same school + subject', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.findConflictByCode.mockResolvedValueOnce({
        id: 'existing-topic-1',
        code: 'GENEVA_ACCORDS_1954',
      });

      await expect(
        TopicsService.createProposal(
          {
            subjectId,
            name: 'Hiệp định Geneva',
            code: 'GENEVA_ACCORDS_1954',
          },
          lecturerUser,
          schoolA
        )
      ).rejects.toThrow('TOPIC_DUPLICATE_CODE');
    });

    test('allows proposal if duplicate code is in another school (Multi-Tenant isolation)', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null); // School B has code, but School A does not
      TopicsRepository.createProposal.mockResolvedValueOnce({
        id: 'prop-multi',
        subject_id: subjectId,
        school_id: schoolA,
        name: 'Topic School A',
        code: 'SAME_CODE',
        status: 'pending_approval',
        review_required: true,
      });

      const res = await TopicsService.createProposal(
        {
          subjectId,
          name: 'Topic School A',
          code: 'SAME_CODE',
        },
        lecturerUser,
        schoolA
      );

      expect(res.status).toBe('pending_approval');
      expect(TopicsRepository.findConflictByCode).toHaveBeenCalledWith(schoolA, subjectId, 'SAME_CODE');
    });

    test('admin approves proposal: saves code, status becomes approved, review_required=false, preserves UUID', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-2',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Geneva Accords 1954',
        code: 'GENEVA_ACCORDS_1954',
        description: 'Lịch sử quan trọng',
        status: 'pending_approval',
        review_required: true,
      });
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null);
      TopicsRepository.reviewProposal.mockResolvedValueOnce({
        id: 'prop-2',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Geneva Accords 1954',
        code: 'GENEVA_ACCORDS_1954',
        description: 'Lịch sử quan trọng',
        status: 'approved',
        review_required: false,
        reviewed_by: adminUser.id,
        review_note: 'Approved official topic code',
      });

      const approved = await TopicsService.reviewProposal(
        'prop-2',
        {
          status: 'approved',
          code: 'GENEVA_ACCORDS_1954',
          name: 'Geneva Accords 1954',
          reviewNote: 'Approved official topic code',
        },
        adminUser,
        schoolA
      );

      expect(approved.id).toBe('prop-2'); // Preserves UUID
      expect(approved.code).toBe('GENEVA_ACCORDS_1954');
      expect(approved.status).toBe('approved');
      expect(approved.review_required).toBe(false);
      expect(TopicsRepository.reviewProposal).toHaveBeenCalledWith(
        'prop-2',
        {
          status: 'approved',
          code: 'GENEVA_ACCORDS_1954',
          name: 'Geneva Accords 1954',
          description: 'Lịch sử quan trọng',
          reviewNote: 'Approved official topic code',
          reviewedBy: adminUser.id,
        },
        schoolA
      );
    });

    test('admin edits code during approval, rejects if edited code conflicts', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-2',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Geneva Accords 1954',
        code: 'GENEVA_OLD',
        status: 'pending_approval',
        review_required: true,
      });
      TopicsRepository.findConflictByCode.mockResolvedValueOnce({
        id: 'other-topic',
        code: 'EXISTING_CODE',
      });

      await expect(
        TopicsService.reviewProposal(
          'prop-2',
          {
            status: 'approved',
            code: 'EXISTING_CODE',
          },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('TOPIC_DUPLICATE_CODE');
    });

    test('admin approves proposal with legacy [Mã gợi ý: XXX] in description: extracts code and cleans description', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-legacy-prefix',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Hiệp định Giơnevơ 1954',
        code: null,
        description: '[Mã gợi ý: GENEVA_ACCORDS_1954] Văn bản lịch sử ký kết năm 1954',
        status: 'pending_approval',
        review_required: true,
      });
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null);
      TopicsRepository.reviewProposal.mockResolvedValueOnce({
        id: 'prop-legacy-prefix',
        status: 'approved',
        code: 'GENEVA_ACCORDS_1954',
        description: 'Văn bản lịch sử ký kết năm 1954',
        review_required: false,
      });

      const approved = await TopicsService.reviewProposal(
        'prop-legacy-prefix',
        { status: 'approved' },
        adminUser,
        schoolA
      );

      expect(TopicsRepository.findConflictByCode).toHaveBeenCalledWith(
        schoolA,
        subjectId,
        'GENEVA_ACCORDS_1954',
        'prop-legacy-prefix'
      );
      expect(TopicsRepository.reviewProposal).toHaveBeenCalledWith(
        'prop-legacy-prefix',
        {
          status: 'approved',
          code: 'GENEVA_ACCORDS_1954',
          name: 'Hiệp định Giơnevơ 1954',
          description: 'Văn bản lịch sử ký kết năm 1954',
          reviewNote: undefined,
          reviewedBy: adminUser.id,
        },
        schoolA
      );
    });

    test('admin approval requires mandatory valid code: rejects if code missing or empty', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-no-code',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Topic Without Code',
        code: null,
        description: 'Mô tả thông thường không có mã',
        status: 'pending_approval',
        review_required: true,
      });

      await expect(
        TopicsService.reviewProposal(
          'prop-no-code',
          {
            status: 'approved',
            code: '', // Admin leaves code empty
          },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('TOPIC_CODE_REQUIRED');
    });

    test('admin approval rejects if code exceeds 80 characters', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-long-code',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Topic Long Code',
        code: null,
        status: 'pending_approval',
        review_required: true,
      });

      await expect(
        TopicsService.reviewProposal(
          'prop-long-code',
          {
            status: 'approved',
            code: 'A'.repeat(81),
          },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('TOPIC_CODE_TOO_LONG');
    });

    test('lecturer proposal rejects if suggested name conflicts with an existing alias', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce({
        type: 'alias',
        conflict: { id: 'alias-1', alias: 'Bộ nhớ heap' },
      });

      await expect(
        TopicsService.createProposal(
          {
            subjectId,
            name: 'Bộ nhớ heap',
          },
          lecturerUser,
          schoolA
        )
      ).rejects.toThrow('ALIAS_CONFLICT');
    });

    test('lecturer proposal rejects if suggested code conflicts with an existing alias', async () => {
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce(null); // Name is ok
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null); // Code vs topics ok
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce({
        type: 'alias',
        conflict: { id: 'alias-code-1', alias: 'DYNAMIC_MEM' },
      }); // Code vs alias conflict

      await expect(
        TopicsService.createProposal(
          {
            subjectId,
            name: 'Cấp phát bộ nhớ',
            code: 'DYNAMIC_MEM',
          },
          lecturerUser,
          schoolA
        )
      ).rejects.toThrow('ALIAS_CONFLICT');
    });

    test('admin approval rejects if target name conflicts with an existing alias', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-alias-conflict',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Đề xuất ban đầu',
        code: 'PROP_CODE',
        status: 'pending_approval',
        review_required: true,
      });
      TopicsRepository.findConflictByName.mockResolvedValueOnce(null);
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce({
        type: 'alias',
        conflict: { id: 'alias-2', alias: 'Con trỏ' },
      });

      await expect(
        TopicsService.reviewProposal(
          'prop-alias-conflict',
          {
            status: 'approved',
            name: 'Con trỏ',
            code: 'PROP_CODE',
          },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('ALIAS_CONFLICT');
    });

    test('admin approval rejects if target code conflicts with an existing alias', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-code-alias-conflict',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Cấu trúc mảng',
        code: 'ARRAY_STRUCT',
        status: 'pending_approval',
        review_required: true,
      });
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce(null); // Name ok
      TopicsRepository.findConflictByCode.mockResolvedValueOnce(null); // Code vs topic ok
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce({
        type: 'alias',
        conflict: { id: 'alias-3', alias: 'ARRAY_STRUCT' },
      }); // Code vs alias conflict

      await expect(
        TopicsService.reviewProposal(
          'prop-code-alias-conflict',
          {
            status: 'approved',
            name: 'Cấu trúc mảng',
            code: 'ARRAY_STRUCT',
          },
          adminUser,
          schoolA
        )
      ).rejects.toThrow('ALIAS_CONFLICT');
    });

    test('admin rejects proposal: marks status=rejected and is_active=false, ineligible for canonical use', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: 'prop-1',
        school_id: schoolA,
        subject_id: subjectId,
        name: 'Out of scope topic',
        code: 'OOS_CODE',
        status: 'pending_approval',
        review_required: true,
      });
      TopicsRepository.reviewProposal.mockResolvedValueOnce({
        id: 'prop-1',
        code: 'OOS_CODE',
        status: 'rejected',
        is_active: false,
        review_required: false,
        reviewed_by: adminUser.id,
        review_note: 'Not in PRF192 syllabus, belongs to CSD201',
      });

      const rejected = await TopicsService.reviewProposal(
        'prop-1',
        { status: 'rejected', reviewNote: 'Not in PRF192 syllabus, belongs to CSD201' },
        adminUser,
        schoolA
      );

      expect(rejected.status).toBe('rejected');
      expect(rejected.is_active).toBe(false);
      expect(rejected.review_note).toBe('Not in PRF192 syllabus, belongs to CSD201');
      expect(TopicsRepository.reviewProposal).toHaveBeenCalledWith(
        'prop-1',
        {
          status: 'rejected',
          reviewNote: 'Not in PRF192 syllabus, belongs to CSD201',
          reviewedBy: adminUser.id,
        },
        schoolA
      );
    });

    test('Multi-Tenant: School Admin from School B cannot review proposal belonging to School A', async () => {
      TopicsRepository.findById.mockResolvedValueOnce(null); // Filtered out by school_id = schoolB

      await expect(
        TopicsService.reviewProposal(
          'prop-1',
          { status: 'approved' },
          adminUser,
          schoolB
        )
      ).rejects.toThrow('TOPIC_NOT_FOUND');
    });
  });

  describe('5. Alias Management & Conflict Prevention', () => {
    test('adds alias to canonical topic when no conflict exists', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: topicId,
        school_id: schoolA,
        subject_id: subjectId,
      });
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce(null);
      TopicsRepository.createAlias.mockResolvedValueOnce({
        id: 'alias-1',
        topic_id: topicId,
        alias: 'Bộ nhớ động',
      });

      const alias = await TopicsService.addAlias(
        topicId,
        'Bộ nhớ động',
        adminUser,
        schoolA
      );

      expect(alias.alias).toBe('Bộ nhớ động');
      expect(TopicsRepository.createAlias).toHaveBeenCalledWith({
        topicId,
        schoolId: schoolA,
        subjectId,
        alias: 'Bộ nhớ động',
        createdBy: adminUser.id,
      });
    });

    test('rejects adding alias if alias conflicts with another topic name', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: topicId,
        school_id: schoolA,
        subject_id: subjectId,
      });
      TopicsRepository.checkAliasConflict.mockResolvedValueOnce({
        type: 'topic_name',
        conflict: { id: 'other-topic', name: 'Struct' },
      });

      await expect(
        TopicsService.addAlias(topicId, 'Struct', adminUser, schoolA)
      ).rejects.toThrow('ALIAS_CONFLICT');
    });

    test('removes alias successfully', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: topicId,
        school_id: schoolA,
        subject_id: subjectId,
      });
      TopicsRepository.deleteAlias.mockResolvedValueOnce({
        id: 'alias-1',
        topic_id: topicId,
      });

      const res = await TopicsService.removeAlias(
        topicId,
        'alias-1',
        adminUser,
        schoolA
      );

      expect(res.id).toBe('alias-1');
    });
  });

  describe('6. Deactivation & Preservation of Historical References', () => {
    test('soft-deactivates topic without hard-deleting and returns active references count', async () => {
      TopicsRepository.findById.mockResolvedValueOnce({
        id: topicId,
        school_id: schoolA,
        subject_id: subjectId,
        is_active: true,
      });
      TopicsRepository.setStatus.mockResolvedValueOnce({
        id: topicId,
        is_active: false,
      });
      TopicsRepository.getReferenceCounts.mockResolvedValueOnce({
        flashcard_count: 15,
        review_count: 42,
        alias_count: 2,
      });

      const result = await TopicsService.setStatus(
        topicId,
        false,
        adminUser,
        schoolA
      );

      expect(result.is_active).toBe(false);
      expect(result.references.flashcard_count).toBe(15);
      expect(result.references.review_count).toBe(42);
      expect(TopicsRepository.setStatus).toHaveBeenCalledWith(topicId, false, schoolA);
    });
  });

  describe('7. RBAC & Multi-Tenant Enforcement', () => {
    test('School A cannot access or modify topic of School B', async () => {
      TopicsRepository.findById.mockResolvedValueOnce(null);

      await expect(
        TopicsService.getDetail(topicId, adminUser, schoolA)
      ).rejects.toThrow('TOPIC_NOT_FOUND');
    });

    test('Lecturer cannot call admin-only methods like createCanonical', async () => {
      await expect(
        TopicsService.create(
          { subjectId, name: 'Unauthorized Topic' },
          lecturerUser,
          schoolA
        )
      ).rejects.toThrow('FORBIDDEN');
    });

    test('Lecturer cannot call confirmLegacy or reviewProposal', async () => {
      await expect(
        TopicsService.confirmLegacy(topicId, { code: 'ABC' }, lecturerUser, schoolA)
      ).rejects.toThrow('FORBIDDEN');

      await expect(
        TopicsService.reviewProposal(topicId, { status: 'approved' }, lecturerUser, schoolA)
      ).rejects.toThrow('FORBIDDEN');
    });

    test('Student cannot perform any topic management actions', async () => {
      await expect(
        TopicsService.list(subjectId, { includeAll: true }, studentUser, schoolA)
      ).rejects.toThrow('FORBIDDEN');
    });

    test('Lecturer list catalog only receives approved, non-review-required, active topics', async () => {
      TopicsRepository.listBySubject.mockResolvedValueOnce([
        { id: 't1', name: 'Approved Topic', status: 'approved', review_required: false, is_active: true },
      ]);

      const result = await TopicsService.list(subjectId, {}, lecturerUser, schoolA);

      expect(result).toHaveLength(1);
      expect(TopicsRepository.listBySubject).toHaveBeenCalledWith(subjectId, schoolA);
      expect(TopicsRepository.listCatalog).not.toHaveBeenCalled();
    });

    test('Admin with includeAll gets full catalog with review states and pagination', async () => {
      TopicsRepository.listCatalog.mockResolvedValueOnce({
        items: [
          { id: 't1', name: 'Legacy Topic', status: 'approved', review_required: true },
          { id: 't2', name: 'Canonical Topic', status: 'approved', review_required: false },
        ],
        total: 2,
        page: 1,
        limit: 50,
      });

      const result = await TopicsService.list(
        subjectId,
        { includeAll: true },
        adminUser,
        schoolA
      );

      expect(result.items).toHaveLength(2);
      expect(TopicsRepository.listCatalog).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId,
          schoolId: schoolA,
          includeAll: true,
        })
      );
    });
  });

  describe('9. Excel Import & Batch Canonical Topics', () => {
    test('generateExcelTemplate generates workbook with proper columns and sample rows', async () => {
      const workbook = await TopicsService.generateExcelTemplate();
      expect(workbook).toBeDefined();
      const sheet = workbook.getWorksheet('Mau_Import_Topic');
      expect(sheet).toBeDefined();
      expect(sheet.columns).toHaveLength(4);
      expect(sheet.rowCount).toBeGreaterThanOrEqual(4); // 1 header + 3 samples
    });

    test('importBatch creates canonical topics and aliases for school_admin', async () => {
      TopicsRepository.findSubjectTopicCatalog.mockResolvedValueOnce({
        topics: [{ lower_name: 'existing topic', lower_code: 'exist' }],
        aliases: [{ lower_alias: 'old alias' }],
      });

      TopicsRepository.createCanonicalBatch.mockResolvedValueOnce([
        {
          id: 't-new-1',
          name: 'Pointers Basic',
          code: 'PTR',
          aliases: [{ id: 'a1', alias: 'Con trỏ' }],
        },
      ]);

      const result = await TopicsService.importBatch(
        {
          subjectId,
          topics: [
            {
              name: 'Pointers Basic',
              code: 'PTR',
              description: 'Basics of pointers in C',
              aliases: ['Con trỏ', 'Pointers Basic'], // second one matches topic name, will be filtered
            },
            {
              name: 'Existing Topic', // duplicate in DB
              code: 'NEW_CODE',
            },
            {
              name: '', // missing name
              code: 'EMPTY_NAME',
            },
          ],
        },
        adminUser,
        schoolA
      );

      expect(result.success).toBe(true);
      expect(result.importedCount).toBe(1);
      expect(result.skippedCount).toBe(2);
      expect(TopicsRepository.createCanonicalBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          schoolId: schoolA,
          subjectId,
          items: [
            expect.objectContaining({
              name: 'Pointers Basic',
              code: 'PTR',
              aliases: ['Con trỏ'],
            }),
          ],
          createdBy: adminUser.id,
        })
      );
    });

    test('importBatch detects duplicate names inside the import batch', async () => {
      TopicsRepository.findSubjectTopicCatalog.mockResolvedValueOnce({
        topics: [],
        aliases: [],
      });

      TopicsRepository.createCanonicalBatch.mockResolvedValueOnce([
        { id: 't-new-1', name: 'Topic 1', code: 'T1' },
      ]);

      const result = await TopicsService.importBatch(
        {
          subjectId,
          topics: [
            { name: 'Topic 1', code: 'T1' },
            { name: 'Topic 1', code: 'T1_DUP' }, // duplicate name in batch
          ],
        },
        adminUser,
        schoolA
      );

      expect(result.importedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.skippedDetails[0].reason).toContain('trùng lặp với dòng khác');
    });

    test('importBatch rejects non-admin users with 403', async () => {
      await expect(
        TopicsService.importBatch(
          {
            subjectId,
            topics: [{ name: 'Topic A' }],
          },
          lecturerUser,
          schoolA
        )
      ).rejects.toThrow('FORBIDDEN');
    });
  });
});
