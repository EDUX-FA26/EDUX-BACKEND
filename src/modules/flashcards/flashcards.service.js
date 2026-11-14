const ExcelJS = require('exceljs');
const FlashcardsRepository = require('./flashcards.repository');

class FlashcardsService {

  // ─────────────────────────────────────────────
  // DECK
  // ─────────────────────────────────────────────

  async getDecks(filters, user, tenant) {
    const role = tenant?.role || user?.role;
    const schoolId = tenant?.schoolId;
    return FlashcardsRepository.findDecks({
      ...filters,
      role,
      userId: user.id,
      schoolId,
    });
  }

  async getDeckById(deckId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    await this._checkViewAccess(deck, user, tenant);
    return deck;
  }

  async createDeck(data, user, tenant) {
    const schoolId = tenant?.schoolId;
    // Verify subject belongs to the current school
    if (data.subject_id) {
      const subject = await FlashcardsRepository.findSubjectById(data.subject_id, schoolId);
      if (!subject) throw new Error('SUBJECT_NOT_FOUND');
    }
    // Verify class belongs to the current school if provided
    if (data.class_id) {
      const cls = await FlashcardsRepository.findClassById(data.class_id, schoolId);
      if (!cls) throw new Error('CLASS_NOT_FOUND');
    }

    return FlashcardsRepository.createDeck({
      ...data,
      created_by: user.id,
      school_id: schoolId,
    });
  }

  async updateDeck(deckId, data, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    if (data.subject_id) {
      const subject = await FlashcardsRepository.findSubjectById(data.subject_id, schoolId);
      if (!subject) throw new Error('SUBJECT_NOT_FOUND');
    }
    if (data.class_id) {
      const cls = await FlashcardsRepository.findClassById(data.class_id, schoolId);
      if (!cls) throw new Error('CLASS_NOT_FOUND');
    }

    const updated = await FlashcardsRepository.updateDeck(deckId, data, schoolId);
    return updated;
  }

  async deleteDeck(deckId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    return FlashcardsRepository.deleteDeck(deckId, schoolId);
  }

  async publishDeck(deckId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    if (!deck.cards || deck.cards.length === 0) {
      throw new Error('DECK_EMPTY');
    }

    if (deck.is_public) {
      throw new Error('ALREADY_PUBLISHED');
    }

    return FlashcardsRepository.publishDeck(deckId, schoolId);
  }

  async publishDeckForForum(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    if (user.role !== 'admin' && deck.created_by !== user.id) throw new Error('FORBIDDEN');
    return FlashcardsRepository.publishDeckForOwner(deckId, user.id);
  }

  /**
   * Ghi nhận user hoàn thành phiên học flashcard.
   * LƯU Ý: Học flashcard không làm tăng chuỗi streak
   * (chỉ khi làm bài kiểm tra flashcard test đạt từ 50% câu đúng trở lên mới tăng chuỗi).
   */
  async completeDeck(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    await this._checkViewAccess(deck, user, tenant);

    return {
      success: true,
      message: 'Flashcard study session completed',
    };
  }

  // ───────────────────────────────────────────
  // CLASS ACCESS
  // ───────────────────────────────────────────

  async getClassAccess(deckId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) throw new Error('FORBIDDEN');

    return FlashcardsRepository.getClassAccess(deckId, schoolId);
  }

  async setClassAccess(deckId, classIds, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) throw new Error('FORBIDDEN');

    if (classIds.length > 0 && (!deck.cards || deck.cards.length === 0)) {
      throw new Error('DECK_EMPTY');
    }

    // Verify all classIds belong to the same school
    if (classIds.length > 0) {
      const validClasses = await FlashcardsRepository.verifyClassesInSchool(classIds, schoolId);
      if (validClasses.length !== classIds.length) {
        throw new Error('CLASS_NOT_FOUND');
      }
    }

    const grantedClassIds = await FlashcardsRepository.setClassAccess(deckId, classIds, schoolId);

    const shouldBePublic = classIds.length > 0;
    await FlashcardsRepository.updateDeck(deckId, { is_public: shouldBePublic }, schoolId);

    return { deck_id: deckId, granted_class_ids: grantedClassIds, is_public: shouldBePublic };
  }

  // ─────────────────────────────────────────────
  // CARD
  // ─────────────────────────────────────────────

  async createCard(deckId, data, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const position = data.position ?? (await FlashcardsRepository.getNextPosition(deckId, schoolId));

    const topicName = data.topicName !== undefined ? data.topicName : (data.topic_name || null);
    const topicId = data.topicId !== undefined ? data.topicId : (data.topic_id || null);

    return FlashcardsRepository.createCard({
      deck_id: deckId,
      type: data.type || 'multiple_choice',
      question: data.question,
      options: data.options || [],
      answer: data.answer,
      explanation: data.explanation,
      difficulty: data.difficulty,
      position,
      topic_name: topicName,
      topic_id: topicId,
      userId: user.id,
      subject_id: deck.subject_id,
      school_id: schoolId,
    });
  }

  async getCardById(cardId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const card = await FlashcardsRepository.findCardById(cardId, schoolId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    const deck = await FlashcardsRepository.findDeckById(card.deck_id, schoolId);
    await this._checkViewAccess(deck, user, tenant);

    return card;
  }

  async updateCard(cardId, data, user, tenant) {
    const schoolId = tenant?.schoolId;
    const card = await FlashcardsRepository.findCardById(cardId, schoolId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && card.deck_owner_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const topicName = data.topicName !== undefined ? data.topicName : data.topic_name;
    const topicId = data.topicId !== undefined ? data.topicId : data.topic_id;

    const updated = await FlashcardsRepository.updateCard(
      cardId,
      data,
      {
        userId: user.id,
        subject_id: card.subject_id,
        topic_name: topicName,
        topic_id: topicId,
        school_id: schoolId,
      }
    );
    return updated;
  }

  async deleteCard(cardId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const card = await FlashcardsRepository.findCardById(cardId, schoolId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && card.deck_owner_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    return FlashcardsRepository.deleteCard(cardId, schoolId);
  }

  // ─────────────────────────────────────────────
  // REVIEW
  // ─────────────────────────────────────────────

  async submitReview(cardId, result, user, tenant) {
    const schoolId = tenant?.schoolId;
    const card = await FlashcardsRepository.findCardById(cardId, schoolId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    const deck = await FlashcardsRepository.findDeckById(card.deck_id, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    await this._checkViewAccess(deck, user, tenant);

    const review = await FlashcardsRepository.createReview({
      user_id: user.id,
      flashcard_id: cardId,
      result,
      school_id: schoolId,
    });

    const currentSchedule = await FlashcardsRepository.findSchedule(user.id, cardId, schoolId);
    const nextSchedule = this._computeNextSchedule(currentSchedule, result);
    const schedule = await FlashcardsRepository.upsertSchedule({
      user_id: user.id,
      flashcard_id: cardId,
      ...nextSchedule,
      school_id: schoolId,
    });

    return { review, schedule };
  }

  async getDeckReviewStats(deckId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    await this._checkViewAccess(deck, user, tenant);

    return FlashcardsRepository.getDeckReviewStats(deckId, user.id, schoolId);
  }

  async getStudyQueue(deckId, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    await this._checkViewAccess(deck, user, tenant);

    const cards = await FlashcardsRepository.getStudyQueue(deckId, user.id, schoolId);

    const stats = cards.reduce(
      (acc, c) => { acc[c.study_status]++; return acc; },
      { due: 0, new: 0, not_due: 0 }
    );

    return {
      deck_id: deckId,
      cards,
      stats: { total: cards.length, ...stats },
    };
  }

  // ─────────────────────────────────────────────
  // EXCEL IMPORT & TEMPLATE
  // ─────────────────────────────────────────────

  async generateExcelTemplate() {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Flashcards_Template');

    worksheet.columns = [
      { header: 'Câu hỏi (*)', key: 'question', width: 40 },
      { header: 'Lựa chọn A (*)', key: 'option_a', width: 25 },
      { header: 'Lựa chọn B (*)', key: 'option_b', width: 25 },
      { header: 'Lựa chọn C', key: 'option_c', width: 25 },
      { header: 'Lựa chọn D', key: 'option_d', width: 25 },
      { header: 'Đáp án đúng (*)', key: 'answer', width: 25 },
      { header: 'Giải thích', key: 'explanation', width: 35 },
      { header: 'Độ khó (easy/medium/hard)', key: 'difficulty', width: 25 },
      { header: 'Chủ đề (Topic)', key: 'topic', width: 30 },
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' },
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 30;

    const samples = [
      {
        question: 'Ngôn ngữ nào sau đây chạy trực tiếp trên trình duyệt web?',
        option_a: 'JavaScript',
        option_b: 'Python',
        option_c: 'Java',
        option_d: 'C++',
        answer: 'A',
        explanation: 'JavaScript là ngôn ngữ kịch bản chạy trong môi trường trình duyệt web.',
        difficulty: 'easy',
        topic: 'Lập trình Web cơ bản',
      },
      {
        question: 'Giao thức nào cung cấp kết nối truyền tải dữ liệu an toàn được mã hóa qua SSL/TLS?',
        option_a: 'HTTP',
        option_b: 'FTP',
        option_c: 'HTTPS',
        option_d: 'Telnet',
        answer: 'HTTPS',
        explanation: 'HTTPS (Hypertext Transfer Protocol Secure) sử dụng TLS/SSL để mã hóa dữ liệu.',
        difficulty: 'medium',
        topic: 'Mạng máy tính & Bảo mật',
      },
    ];

    samples.forEach((sample) => worksheet.addRow(sample));
    return workbook;
  }

  async importCardsFromExcel(deckId, fileBuffer, user, tenant, { defaultTopicName } = {}) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('EMPTY_WORKBOOK');

    const rawCards = [];
    const errors = [];
    let totalProcessedRows = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Header

      const rowValues = Array.isArray(row.values) ? row.values.slice(1) : [];
      const hasAnyValue = rowValues.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasAnyValue) return;

      totalProcessedRows++;

      const getCellText = (colIndex) => {
        const val = row.getCell(colIndex).value;
        if (val === null || val === undefined) return '';
        if (typeof val === 'object' && val.text) return String(val.text).trim();
        return String(val).trim();
      };

      const question = getCellText(1);
      const optA = getCellText(2);
      const optB = getCellText(3);
      const optC = getCellText(4);
      const optD = getCellText(5);
      const rawAns = getCellText(6);
      const explanation = getCellText(7);
      const rawDiff = getCellText(8).toLowerCase();
      const topicName = getCellText(9) || defaultTopicName || null;

      const rowErrors = [];
      if (!question) rowErrors.push('Thiếu câu hỏi');
      if (!optA || !optB) rowErrors.push('Cần ít nhất 2 lựa chọn (A và B)');
      if (!rawAns) rowErrors.push('Thiếu đáp án đúng');

      let difficulty = 'medium';
      if (['easy', 'medium', 'hard'].includes(rawDiff)) {
        difficulty = rawDiff;
      }

      const options = [];
      if (optA) options.push({ key: 'A', text: optA });
      if (optB) options.push({ key: 'B', text: optB });
      if (optC) options.push({ key: 'C', text: optC });
      if (optD) options.push({ key: 'D', text: optD });

      let resolvedAnswer = rawAns;
      const upperAns = rawAns.toUpperCase();
      if (['A', 'B', 'C', 'D'].includes(upperAns)) {
        const found = options.find((o) => o.key === upperAns);
        if (found) {
          resolvedAnswer = found.text;
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: rowNumber, errors: rowErrors });
        return;
      }

      rawCards.push({
        question,
        options,
        answer: resolvedAnswer,
        explanation,
        difficulty,
        topic_name: topicName,
      });
    });

    if (rawCards.length === 0) {
      return {
        success: false,
        message: 'Không tìm thấy dòng dữ liệu hợp lệ nào để nhập.',
        total_rows: totalProcessedRows,
        imported_count: 0,
        errors,
        cards: [],
      };
    }

    let nextPos = await FlashcardsRepository.getNextPosition(deckId, schoolId);
    const cardsToInsert = rawCards.map((c) => ({
      deck_id: deckId,
      type: 'multiple_choice',
      question: c.question,
      options: c.options,
      answer: c.answer,
      explanation: c.explanation,
      difficulty: c.difficulty,
      position: nextPos++,
      topic_name: c.topic_name,
      school_id: schoolId,
    }));

    const inserted = await FlashcardsRepository.createCardsBatch(cardsToInsert, {
      subject_id: deck.subject_id,
      userId: user.id,
      school_id: schoolId,
    });

    return {
      success: true,
      message: `Đã nhập thành công ${inserted.length}/${totalProcessedRows} thẻ từ file Excel`,
      total_rows: totalProcessedRows,
      imported_count: inserted.length,
      errors,
      cards: inserted,
    };
  }

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

  _computeNextSchedule(current, grade) {
    let ef       = parseFloat(current?.ease_factor   ?? 2.5);
    let interval = parseInt(current?.interval_days   ?? 0,  10);
    let reps     = parseInt(current?.repetitions     ?? 0,  10);

    let newInterval, newReps, newEf;

    switch (grade) {
      case 'again':
        newInterval = 1;
        newReps     = 0;
        newEf       = Math.max(1.3, ef - 0.20);
        break;

      case 'hard':
        newInterval = interval > 0 ? Math.max(1, Math.round(interval * 1.2)) : 1;
        newReps     = reps + 1;
        newEf       = Math.max(1.3, ef - 0.15);
        break;

      case 'good':
        if      (reps === 0) newInterval = 1;
        else if (reps === 1) newInterval = 6;
        else                 newInterval = Math.max(1, Math.round(interval * ef));
        newReps = reps + 1;
        newEf   = ef;
        break;

      case 'easy':
        if      (reps === 0) newInterval = 4;
        else if (reps === 1) newInterval = 8;
        else                 newInterval = Math.max(1, Math.round(interval * ef * 1.3));
        newReps = reps + 1;
        newEf   = Math.min(2.5, ef + 0.15);
        break;

      default:
        newInterval = 1; newReps = 0; newEf = ef;
    }

    const due = new Date();
    due.setUTCDate(due.getUTCDate() + newInterval);
    const dueDate = due.toISOString().slice(0, 10);

    return {
      ease_factor:   parseFloat(newEf.toFixed(2)),
      interval_days: newInterval,
      repetitions:   newReps,
      due_date:      dueDate,
    };
  }

  /**
   * Kiểm tra quyền xem deck theo vai trò trường học:
   * - School Admin: toàn quyền xem các deck thuộc trường
   * - Lecturer: deck của mình hoặc deck public thuộc trường
   * - Student: deck của mình, deck public thuộc trường, hoặc deck được chia sẻ cho lớp sinh viên tham gia
   */
  async _checkViewAccess(deck, user, tenant) {
    const role = tenant?.role || user?.role;
    if (role === 'school_admin' || role === 'admin') return;

    if (role === 'lecturer') {
      if (deck.created_by === user.id || deck.is_public) return;
      throw new Error('FORBIDDEN');
    }

    // Student
    if (deck.created_by === user.id) return;
    if (deck.is_public) return;

    const schoolId = tenant?.schoolId;
    if (schoolId) {
      const hasClassAccess = await FlashcardsRepository.checkStudentDeckAccess(deck.id, user.id, schoolId);
      if (hasClassAccess) return;
    }

    throw new Error('FORBIDDEN');
  }
}

module.exports = new FlashcardsService();
