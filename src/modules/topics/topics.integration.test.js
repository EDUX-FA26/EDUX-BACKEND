const ctrl = require('./topics.controller');
const TopicsService = require('./topics.service');

jest.mock('./topics.service');

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

describe('Topics Controller & Route Actions Unit Verification (No Socket Needed)', () => {
  const schoolId = '11111111-1111-4111-8111-111111111111';
  const subjectId = '33333333-3333-4333-8333-333333333333';
  const topicId = '44444444-4444-4444-8444-444444444444';
  const aliasId = '55555555-5555-4555-8555-555555555555';

  const adminUser = { id: 'user-admin-1', role: 'school_admin' };
  const lecturerUser = { id: 'user-lecturer-1', role: 'lecturer' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    test('School Admin lists topics with includeAll=true', async () => {
      const req = {
        query: { subjectId, includeAll: 'true' },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.list.mockResolvedValueOnce({
        items: [{ id: topicId, name: 'Pointers', status: 'approved', review_required: true }],
        total: 1,
      });

      await ctrl.list(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toHaveLength(1);
      expect(TopicsService.list).toHaveBeenCalledWith(
        subjectId,
        req.query,
        expect.objectContaining({ role: 'school_admin' }),
        schoolId
      );
    });
  });

  describe('create (Canonical Topic)', () => {
    test('School Admin creates canonical topic', async () => {
      const req = {
        body: { subjectId, name: 'Recursion', code: 'REC_01' },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.create.mockResolvedValueOnce({
        id: topicId,
        name: 'Recursion',
        code: 'REC_01',
        status: 'approved',
        review_required: false,
      });

      await ctrl.create(req, res, next);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Recursion');
    });

    test('Duplicate name returns 409 with TOPIC_DUPLICATE_NAME code', async () => {
      const req = {
        body: { subjectId, name: 'Pointers' },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      const err = new Error('TOPIC_DUPLICATE_NAME');
      err.status = 409;
      TopicsService.create.mockRejectedValueOnce(err);

      await ctrl.create(req, res, next);

      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe('TOPIC_DUPLICATE_NAME');
    });
  });

  describe('confirmLegacy', () => {
    test('School Admin confirms legacy topic', async () => {
      const req = {
        params: { topicId },
        body: { code: 'PTR_LEGACY', reviewNote: 'Confirmed by School Admin' },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.confirmLegacy.mockResolvedValueOnce({
        id: topicId,
        review_required: false,
        code: 'PTR_LEGACY',
      });

      await ctrl.confirmLegacy(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.review_required).toBe(false);
    });
  });

  describe('reviewProposal', () => {
    test('School Admin approves proposal', async () => {
      const req = {
        params: { topicId },
        body: { status: 'approved', reviewNote: 'Looks good' },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.reviewProposal.mockResolvedValueOnce({
        id: topicId,
        status: 'approved',
        review_required: false,
      });

      await ctrl.reviewProposal(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Duyệt đề xuất thành công');
    });

    test('School Admin rejects proposal', async () => {
      const req = {
        params: { topicId },
        body: { status: 'rejected', reviewNote: 'Invalid scope' },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.reviewProposal.mockResolvedValueOnce({
        id: topicId,
        status: 'rejected',
        review_required: false,
      });

      await ctrl.reviewProposal(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('Từ chối đề xuất thành công');
    });
  });

  describe('createProposal', () => {
    test('Lecturer creates topic proposal', async () => {
      const req = {
        body: { subjectId, name: 'Bitwise', reason: 'Chapter 2' },
        user: lecturerUser,
        tenant: { schoolId, role: 'lecturer' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.createProposal.mockResolvedValueOnce({
        id: 'prop-1',
        status: 'pending_approval',
        review_required: true,
      });

      await ctrl.createProposal(req, res, next);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('chờ School Admin phê duyệt');
    });
  });

  describe('alias endpoints', () => {
    test('addAlias creates alias and returns 201', async () => {
      const req = {
        params: { topicId },
        body: { alias: 'Bộ nhớ động' },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.addAlias.mockResolvedValueOnce({
        id: aliasId,
        alias: 'Bộ nhớ động',
      });

      await ctrl.addAlias(req, res, next);

      expect(res.statusCode).toBe(201);
      expect(res.body.data.alias).toBe('Bộ nhớ động');
    });

    test('removeAlias deletes alias and returns 200', async () => {
      const req = {
        params: { topicId, aliasId },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.removeAlias.mockResolvedValueOnce({ id: aliasId });

      await ctrl.removeAlias(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('setStatus', () => {
    test('School Admin deactivates topic and receives referenced counts', async () => {
      const req = {
        params: { topicId },
        body: { isActive: false },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.setStatus.mockResolvedValueOnce({
        id: topicId,
        is_active: false,
        references: { flashcard_count: 3 },
      });

      await ctrl.setStatus(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.is_active).toBe(false);
      expect(res.body.data.references.flashcard_count).toBe(3);
    });
  });

  describe('Excel Import & Batch Endpoints', () => {
    test('downloadTemplate sets headers and streams workbook', async () => {
      const mockWorkbook = {
        xlsx: {
          write: jest.fn().mockResolvedValue(true),
        },
      };
      TopicsService.generateExcelTemplate.mockResolvedValueOnce(mockWorkbook);

      const req = {
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = {
        headers: {},
        setHeader(k, v) {
          this.headers[k] = v;
        },
        end: jest.fn(),
      };
      const next = jest.fn();

      await ctrl.downloadTemplate(req, res, next);

      expect(res.headers['Content-Type']).toContain('spreadsheetml');
      expect(mockWorkbook.xlsx.write).toHaveBeenCalledWith(res);
      expect(res.end).toHaveBeenCalled();
    });

    test('importExcel requires file', async () => {
      const req = {
        body: { subjectId },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      await ctrl.importExcel(req, res, next);

      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('FILE_REQUIRED');
    });

    test('importExcel parses and returns result', async () => {
      const req = {
        file: { buffer: Buffer.from('test') },
        body: { subjectId },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.importExcelFile.mockResolvedValueOnce({
        success: true,
        total: 2,
        importedCount: 2,
        skippedCount: 0,
        importedTopics: [{ id: 't1', name: 'Topic 1' }],
      });

      await ctrl.importExcel(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.importedCount).toBe(2);
    });

    test('importBatch calls TopicsService.importBatch and returns 200', async () => {
      const req = {
        body: {
          subjectId,
          topics: [{ name: 'Topic Batch' }],
        },
        user: adminUser,
        tenant: { schoolId, role: 'school_admin' },
      };
      const res = createMockRes();
      const next = jest.fn();

      TopicsService.importBatch.mockResolvedValueOnce({
        success: true,
        total: 1,
        importedCount: 1,
        skippedCount: 0,
      });

      await ctrl.importBatch(req, res, next);

      expect(res.statusCode).toBe(200);
      expect(res.body.importedCount).toBe(1);
    });
  });
});

