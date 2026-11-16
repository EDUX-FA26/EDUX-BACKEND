const FlashcardsService = require('./flashcards.service');

const FlashcardsController = {

  // ─────────────────────────────────────────────
  // DECK
  // ─────────────────────────────────────────────

  async getDecks(req, res, next) {
    try {
      const { page = 1, limit = 10, subject_id, class_id, is_public } = req.query;
      const result = await FlashcardsService.getDecks(
        { page, limit, subject_id, class_id, is_public: is_public === 'true' ? true : is_public === 'false' ? false : undefined },
        req.user,
        req.tenant
      );

      res.status(200).json({
        success: true,
        data: result.data,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          totalPages: Math.ceil(result.total / Number(limit)) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async getDeckById(req, res, next) {
    try {
      const deck = await FlashcardsService.getDeckById(req.params.deckId, req.user, req.tenant);
      res.status(200).json({ success: true, data: deck });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async createDeck(req, res, next) {
    try {
      const deck = await FlashcardsService.createDeck(req.body, req.user, req.tenant);
      res.status(201).json({ success: true, data: deck });
    } catch (error) {
      if (error.message === 'SUBJECT_NOT_FOUND') return res.status(404).json({ success: false, message: 'Subject not found in this school' });
      if (error.message === 'CLASS_NOT_FOUND') return res.status(404).json({ success: false, message: 'Class not found in this school' });
      next(error);
    }
  },

  async updateDeck(req, res, next) {
    try {
      const deck = await FlashcardsService.updateDeck(req.params.deckId, req.body, req.user, req.tenant);
      res.status(200).json({ success: true, data: deck });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async deleteDeck(req, res, next) {
    try {
      await FlashcardsService.deleteDeck(req.params.deckId, req.user, req.tenant);
      res.status(200).json({ success: true, message: 'Deck deleted successfully' });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async publishDeck(req, res, next) {
    try {
      const deck = await FlashcardsService.publishDeck(req.params.deckId, req.user, req.tenant);
      res.status(200).json({ success: true, message: 'Deck published successfully', data: deck });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND')   return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')         return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'DECK_EMPTY')        return res.status(422).json({ success: false, message: 'Cannot publish an empty deck. Add at least one card first.' });
      if (error.message === 'ALREADY_PUBLISHED') return res.status(409).json({ success: false, message: 'Deck is already published' });
      next(error);
    }
  },

  // GET  /api/flashcards/decks/:deckId/class-access
  async getClassAccess(req, res, next) {
    try {
      const access = await FlashcardsService.getClassAccess(req.params.deckId, req.user, req.tenant);
      res.status(200).json({ success: true, data: access });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // PUT  /api/flashcards/decks/:deckId/class-access
  async setClassAccess(req, res, next) {
    try {
      const { class_ids } = req.body;
      if (!Array.isArray(class_ids)) {
        return res.status(400).json({ success: false, message: 'class_ids phải là mảng UUID' });
      }
      const result = await FlashcardsService.setClassAccess(req.params.deckId, class_ids, req.user, req.tenant);
      res.status(200).json({ success: true, message: 'Cập nhật quyền truy cập thành công', data: result });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'DECK_EMPTY')     return res.status(422).json({ success: false, message: 'Bộ thẻ chưa có thẻ nào. Thêm thẻ trước khi chia sẻ.' });
      next(error);
    }
  },

  async completeDeck(req, res, next) {
    try {
      const result = await FlashcardsService.completeDeck(req.params.deckId, req.user, req.tenant);
      res.status(200).json({ success: true, message: 'Deck completed', data: result });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // ─────────────────────────────────────────────
  // CARD
  // ─────────────────────────────────────────────

  async createCard(req, res, next) {
    try {
      const card = await FlashcardsService.createCard(req.params.deckId, req.body, req.user, req.tenant);
      res.status(201).json({ success: true, data: card });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'TOPIC_REQUIRED') return res.status(400).json({ success: false, message: 'Vui lòng chọn Canonical Topic hợp lệ cho thẻ' });
      if (error.message === 'TOPIC_NOT_FOUND') return res.status(404).json({ success: false, message: 'Topic không tồn tại trong trường' });
      if (error.message === 'TOPIC_SUBJECT_MISMATCH') return res.status(409).json({ success: false, message: 'Topic không thuộc môn học của bộ thẻ' });
      if (error.message === 'TOPIC_NOT_ELIGIBLE') return res.status(409).json({ success: false, message: 'Topic chưa được duyệt, đang tạm dừng hoặc không phải Topic chuẩn (Flat Model)' });
      next(error);
    }
  },

  async getTopicSuggestions(req, res, next) {
    try {
      const data = await FlashcardsService.getTopicSuggestions(
        req.params.deckId,
        req.body,
        req.user,
        req.tenant
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async getCardById(req, res, next) {
    try {
      const card = await FlashcardsService.getCardById(req.params.cardId, req.user, req.tenant);
      res.status(200).json({ success: true, data: card });
    } catch (error) {
      if (error.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, message: 'Card not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async updateCard(req, res, next) {
    try {
      const card = await FlashcardsService.updateCard(req.params.cardId, req.body, req.user, req.tenant);
      res.status(200).json({ success: true, data: card });
    } catch (error) {
      if (error.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, message: 'Card not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'CANNOT_CHANGE_TOPIC_WITH_REVIEWS' || error.message === 'CANNOT_MODIFY_REVIEWED_CARD') {
        return res.status(400).json({
          success: false,
          message: 'Thẻ đã có lịch sử ôn tập. Không thể thay đổi nội dung (câu hỏi, đáp án, lựa chọn) hoặc Topic để bảo toàn dữ liệu học tập.',
        });
      }
      if (error.message === 'TOPIC_NOT_FOUND') return res.status(404).json({ success: false, message: 'Topic không tồn tại trong trường' });
      if (error.message === 'TOPIC_SUBJECT_MISMATCH') return res.status(409).json({ success: false, message: 'Topic không thuộc môn học của bộ thẻ' });
      if (error.message === 'TOPIC_NOT_ELIGIBLE') return res.status(409).json({ success: false, message: 'Topic chưa được duyệt, đang tạm dừng hoặc không phải Topic chuẩn' });
      next(error);
    }
  },

  async deleteCard(req, res, next) {
    try {
      await FlashcardsService.deleteCard(req.params.cardId, req.user, req.tenant);
      res.status(200).json({ success: true, message: 'Card deleted successfully' });
    } catch (error) {
      if (error.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, message: 'Card not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // ─────────────────────────────────────────────
  // REVIEW
  // ─────────────────────────────────────────────

  async submitReview(req, res, next) {
    try {
      const review = await FlashcardsService.submitReview(
        req.params.cardId,
        req.body.result,
        req.user,
        req.tenant
      );
      res.status(201).json({ success: true, data: review });
    } catch (error) {
      if (error.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, message: 'Card not found' });
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async getDeckReviewStats(req, res, next) {
    try {
      const stats = await FlashcardsService.getDeckReviewStats(
        req.params.deckId,
        req.user,
        req.tenant
      );
      res.status(200).json({ success: true, data: stats });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async getStudyQueue(req, res, next) {
    try {
      const result = await FlashcardsService.getStudyQueue(
        req.params.deckId,
        req.user,
        req.tenant
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  // GET /api/flashcards/template/excel
  async downloadExcelTemplate(req, res, next) {
    try {
      const workbook = await FlashcardsService.generateExcelTemplate();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="flashcard_template.xlsx"'
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      next(error);
    }
  },

  // POST /api/flashcards/decks/:deckId/import/preview
  async previewImport(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn file Excel để tải lên' });
      }
      const data = await FlashcardsService.previewCardsFromExcel(
        req.params.deckId,
        req.file.buffer,
        req.user,
        req.tenant
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'EMPTY_WORKBOOK') return res.status(400).json({ success: false, message: 'File Excel không có sheet nào' });
      if (error.message === 'FILE_TOO_LARGE') return res.status(400).json({ success: false, message: 'Dung lượng file vượt quá giới hạn (tối đa 10MB)' });
      if (error.message === 'ROW_LIMIT_EXCEEDED') return res.status(400).json({ success: false, message: 'Số dòng vượt quá giới hạn (tối đa 500 dòng)' });
      if (error.message === 'EMPTY_CONTENT') return res.status(400).json({ success: false, message: 'File Excel không có dữ liệu câu hỏi hợp lệ' });
      next(error);
    }
  },

  // POST /api/flashcards/decks/:deckId/import/confirm
  async confirmImport(req, res, next) {
    try {
      const data = await FlashcardsService.confirmCardsImport(
        req.params.deckId,
        req.body,
        req.user,
        req.tenant
      );
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.code === 'CONFIRM_IN_PROGRESS' || error.message?.startsWith('CONFIRM_IN_PROGRESS')) {
        return res.status(409).json({ success: false, message: 'Yêu cầu import đang được xử lý, vui lòng chờ trong giây lát.' });
      }
      if (error.message === 'PREVIEW_NOT_FOUND' || error.message === 'PREVIEW_EXPIRED') {
        return res.status(410).json({ success: false, message: 'Phiên preview đã hết hạn hoặc không tồn tại. Vui lòng tải lên lại.' });
      }
      if (
        error.message === 'PREVIEW_DECK_MISMATCH' ||
        error.message === 'PREVIEW_SCHOOL_MISMATCH' ||
        error.message === 'PREVIEW_USER_MISMATCH' ||
        error.message === 'PREVIEW_ACCESS_DENIED'
      ) {
        return res.status(403).json({ success: false, message: 'Phiên preview không hợp lệ hoặc bạn không có quyền truy cập.' });
      }
      if (error.code === 'DUPLICATE_ROW_NUMBER' || error.message?.startsWith('DUPLICATE_ROW_NUMBER')) {
        return res.status(422).json({ success: false, message: 'Danh sách xác nhận có dòng bị gửi trùng lặp (duplicate rowNumber).' });
      }
      if (error.code === 'INVALID_ROW_NUMBER' || error.message?.startsWith('INVALID_ROW_NUMBER') || error.code === 'INVALID_ROW_FORMAT' || error.message?.startsWith('INVALID_ROW_FORMAT')) {
        return res.status(422).json({ success: false, message: 'Dòng câu hỏi không tồn tại hoặc không hợp lệ trong phiên xem trước.' });
      }
      if (error.code === 'ROW_TOPIC_MISSING' || error.message?.startsWith('ROW_TOPIC_MISSING')) {
        return res.status(422).json({ success: false, message: 'Tất cả các dòng import đều phải được gắn Canonical Topic.' });
      }
      if (error.message === 'TOPIC_NOT_FOUND') return res.status(404).json({ success: false, message: 'Topic không tồn tại trong môn học của trường' });
      if (error.message === 'TOPIC_SUBJECT_MISMATCH') return res.status(409).json({ success: false, message: 'Topic không thuộc môn học của bộ thẻ' });
      if (error.message === 'TOPIC_NOT_ELIGIBLE') return res.status(409).json({ success: false, message: 'Một hoặc nhiều Topic chưa được duyệt hoặc đã ngừng hoạt động' });
      next(error);
    }
  },

  // POST /api/flashcards/decks/:deckId/cards/import-excel
  async importCardsFromExcel(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Vui lòng chọn file Excel để tải lên' });
      }

      if (req.query?.preview === 'true') {
        const data = await FlashcardsService.previewCardsFromExcel(
          req.params.deckId,
          req.file.buffer,
          req.user,
          req.tenant
        );
        return res.status(200).json({ success: true, data });
      }

      const defaultTopicName = req.body?.topicName || req.body?.defaultTopicName || null;

      const result = await FlashcardsService.importCardsFromExcel(
        req.params.deckId,
        req.file.buffer,
        req.user,
        req.tenant,
        { defaultTopicName }
      );

      res.status(result.success ? 200 : 422).json(result);
    } catch (error) {
      if (error.code === 'DIRECT_IMPORT_DEPRECATED' || error.message?.startsWith('DIRECT_IMPORT_DEPRECATED')) {
        return res.status(400).json({
          success: false,
          message: 'Luồng import trực tiếp đã ngừng hỗ trợ. Vui lòng sử dụng tính năng Preview và Confirm để gán Canonical Topic.',
        });
      }
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN') return res.status(403).json({ success: false, message: 'Access denied' });
      if (error.message === 'EMPTY_WORKBOOK') return res.status(400).json({ success: false, message: 'File Excel không có sheet nào' });
      if (error.message === 'FILE_TOO_LARGE') return res.status(400).json({ success: false, message: 'Dung lượng file vượt quá giới hạn (tối đa 10MB)' });
      if (error.message === 'ROW_LIMIT_EXCEEDED') return res.status(400).json({ success: false, message: 'Số dòng vượt quá giới hạn (tối đa 500 dòng)' });
      if (error.message === 'EMPTY_CONTENT') return res.status(400).json({ success: false, message: 'File Excel không có dữ liệu câu hỏi hợp lệ' });
      next(error);
    }
  },

  async importCards(req, res, next) {
    return this.importCardsFromExcel(req, res, next);
  },
};

module.exports = FlashcardsController;
