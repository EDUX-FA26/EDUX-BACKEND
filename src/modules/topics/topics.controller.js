const TopicsService = require('./topics.service');
const TopicClassificationService = require('./topicClassification.service');
const TopicClassificationReviewService = require('./topicClassificationReview.service');
const TopicSimilarService = require('./topicSimilar.service');

function sendError(error, res, next) {
  if (
    error.message === 'TOPIC_NOT_FOUND' ||
    error.message === 'SUBJECT_NOT_FOUND' ||
    error.message === 'FLASHCARD_NOT_FOUND' ||
    error.message === 'ALIAS_NOT_FOUND'
  ) {
    return res.status(404).json({ success: false, code: error.message, message: error.message });
  }

  if (error.message === 'FORBIDDEN') {
    return res.status(403).json({ success: false, code: 'FORBIDDEN', message: 'Access denied' });
  }

  if (error.message === 'TOPIC_DUPLICATE_NAME') {
    return res.status(409).json({
      success: false,
      code: 'TOPIC_DUPLICATE_NAME',
      message: 'Tên Topic đã tồn tại trong môn học này',
    });
  }

  if (error.message === 'TOPIC_DUPLICATE_CODE') {
    return res.status(409).json({
      success: false,
      code: 'TOPIC_DUPLICATE_CODE',
      message: 'Mã Topic đã tồn tại trong môn học này',
    });
  }

  if (error.message === 'ALIAS_CONFLICT') {
    return res.status(409).json({
      success: false,
      code: 'ALIAS_CONFLICT',
      message: 'Alias bị trùng lặp hoặc xung đột với tên/mã Topic trong môn học',
    });
  }

  if (error.message === 'TOPIC_HAS_REFERENCES') {
    return res.status(400).json({
      success: false,
      code: 'TOPIC_HAS_REFERENCES',
      message: 'Topic đang được liên kết với dữ liệu học tập',
    });
  }

  if (error.message === 'TOPIC_CODE_REQUIRED') {
    return res.status(400).json({
      success: false,
      code: 'TOPIC_CODE_REQUIRED',
      message: 'Mã Topic (Code) là bắt buộc khi phê duyệt Topic chuẩn',
    });
  }

  if (error.message === 'TOPIC_CODE_TOO_LONG') {
    return res.status(400).json({
      success: false,
      code: 'TOPIC_CODE_TOO_LONG',
      message: 'Mã Topic tối đa 80 ký tự',
    });
  }

  if (error.message === 'TOPIC_NAME_REQUIRED') {
    return res.status(400).json({
      success: false,
      code: 'TOPIC_NAME_REQUIRED',
      message: 'Tên Topic không được để trống khi phê duyệt',
    });
  }

  if (
    error.message === 'INVALID_PARENT_TOPIC' ||
    error.message === 'TOPIC_FLASHCARD_SUBJECT_MISMATCH'
  ) {
    return res.status(400).json({ success: false, code: error.message, message: error.message });
  }

  if (error.status && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({
      success: false,
      code: error.code || error.message,
      message: error.message,
    });
  }

  return next(error);
}

module.exports = {
  list: async (req, res, next) => {
    try {
      const data = await TopicsService.list(
        req.query.subjectId,
        req.query,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({ success: true, data });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  getDetail: async (req, res, next) => {
    try {
      const data = await TopicsService.getDetail(
        req.params.topicId,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({ success: true, data });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  create: async (req, res, next) => {
    try {
      const data = await TopicsService.create(
        req.body,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.status(201).json({ success: true, data, message: 'Tạo Topic thành công' });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  downloadTemplate: async (req, res, next) => {
    try {
      const workbook = await TopicsService.generateExcelTemplate();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="canonical_topics_template.xlsx"'
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (e) {
      next(e);
    }
  },

  importExcel: async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          code: 'FILE_REQUIRED',
          message: 'Vui lòng tải lên file Excel (.xlsx, .csv)',
        });
      }
      const subjectId = req.body?.subjectId;
      if (!subjectId) {
        return res.status(400).json({
          success: false,
          code: 'SUBJECT_ID_REQUIRED',
          message: 'subjectId là bắt buộc',
        });
      }

      const preview =
        req.body?.preview === 'true' ||
        req.query?.preview === 'true' ||
        req.body?.preview === true;

      const result = await TopicsService.importExcelFile(
        subjectId,
        req.file.buffer,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null,
        { preview }
      );
      res.status(200).json(result);
    } catch (e) {
      sendError(e, res, next);
    }
  },

  importBatch: async (req, res, next) => {
    try {
      const result = await TopicsService.importBatch(
        req.body,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.status(200).json(result);
    } catch (e) {
      sendError(e, res, next);
    }
  },

  update: async (req, res, next) => {
    try {
      const data = await TopicsService.update(
        req.params.topicId,
        req.body,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({ success: true, data, message: 'Cập nhật Topic thành công' });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  confirmLegacy: async (req, res, next) => {
    try {
      const data = await TopicsService.confirmLegacy(
        req.params.topicId,
        req.body,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({ success: true, data, message: 'Xác nhận Topic legacy thành công' });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  reviewProposal: async (req, res, next) => {
    try {
      const data = await TopicsService.reviewProposal(
        req.params.topicId,
        req.body,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({
        success: true,
        data,
        message: req.body.status === 'approved' ? 'Duyệt đề xuất thành công' : 'Từ chối đề xuất thành công',
      });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  createProposal: async (req, res, next) => {
    try {
      const data = await TopicsService.createProposal(
        req.body,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.status(201).json({
        success: true,
        data,
        message: 'Gửi đề xuất Topic thành công, chờ School Admin phê duyệt',
      });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  setStatus: async (req, res, next) => {
    try {
      const data = await TopicsService.setStatus(
        req.params.topicId,
        req.body.isActive,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({
        success: true,
        data,
        message: req.body.isActive ? 'Kích hoạt lại Topic thành công' : 'Đã ngừng sử dụng Topic',
      });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  listAliases: async (req, res, next) => {
    try {
      const data = await TopicsService.listAliases(
        req.params.topicId,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({ success: true, data });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  addAlias: async (req, res, next) => {
    try {
      const data = await TopicsService.addAlias(
        req.params.topicId,
        req.body.alias,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.status(201).json({ success: true, data, message: 'Thêm Alias thành công' });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  removeAlias: async (req, res, next) => {
    try {
      const data = await TopicsService.removeAlias(
        req.params.topicId,
        req.params.aliasId,
        { ...req.user, role: req.tenant?.role || req.user.role },
        req.tenant?.schoolId || null
      );
      res.json({ success: true, data, message: 'Xóa Alias thành công' });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  mapFlashcard: async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        data: await TopicsService.mapFlashcard(
          req.params.topicId,
          req.params.flashcardId,
          req.body.reviewStatus,
          { ...req.user, role: req.tenant?.role || req.user.role },
          req.tenant?.schoolId || null
        ),
      });
    } catch (e) {
      sendError(e, res, next);
    }
  },

  reviewClassification: async (req, res, next) => {
    try {
      const result = await TopicClassificationReviewService.review(
        req.params.flashcardId,
        req.body,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'AI classification reviewed successfully',
        data: result,
      });
    } catch (error) {
      if (error.status && error.status >= 400 && error.status < 500) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      return next(error);
    }
  },

  generateSimilar: async (req, res, next) => {
    try {
      const result = await TopicSimilarService.generate(
        req.body.flashcardId,
        req.body.count ?? 3,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'Similar flashcards generated successfully',
        data: result,
      });
    } catch (error) {
      if (
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 600
      ) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }

      return next(error);
    }
  },

  classifyFlashcard: async (req, res, next) => {
    try {
      const result = await TopicClassificationService.classify(
        req.body.flashcardId,
        req.user
      );

      return res.status(200).json({
        success: true,
        message: 'Flashcard classification completed',
        data: result,
      });
    } catch (error) {
      const allowedErrors = new Set([
        'FLASHCARD_NOT_FOUND',
        'FORBIDDEN',
        'NO_TOPICS_AVAILABLE',
        'TOO_MANY_TOPICS',
        'CLASSIFICATION_INPUT_TOO_LARGE',
        'AI_INVALID_RESPONSE',
        'AI_INVALID_TOPIC',
        'AI_CLASSIFICATION_FAILED',
        'AI_SUGGESTION_REJECTED',
        'AI_SUGGESTION_ALREADY_REVIEWED',
      ]);

      if (allowedErrors.has(error.message)) {
        return res.status(error.status || 400).json({
          success: false,
          message: error.message,
        });
      }

      return next(error);
    }
  },
};
