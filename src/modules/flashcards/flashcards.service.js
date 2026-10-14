const ExcelJS = require('exceljs');
const FlashcardsRepository = require('./flashcards.repository');
const LearningStreakService = require('../learning/learningStreak.service');

class FlashcardsService {

  // ─────────────────────────────────────────────
  // DECK
  // ─────────────────────────────────────────────

  async getDecks(filters, user) {
    return FlashcardsRepository.findDecks({
      ...filters,
      role: user.role,
      userId: user.id,
    });
  }

  async getDeckById(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    // Kiểm tra quyền xem
    this._checkViewAccess(deck, user);
    return deck;
  }

  async createDeck(data, user) {
    return FlashcardsRepository.createDeck({
      ...data,
      created_by: user.id,
    });
  }

  async updateDeck(deckId, data, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    // Chỉ người tạo hoặc admin được sửa
    if (user.role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const updated = await FlashcardsRepository.updateDeck(deckId, data);
    return updated;
  }

  async deleteDeck(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    if (user.role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    return FlashcardsRepository.deleteDeck(deckId);
  }

  async publishDeck(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    // Chỉ người tạo hoặc admin mới có quyền publish
    if (user.role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    // Không thể publish deck rỗng (chưa có card nào)
    if (!deck.cards || deck.cards.length === 0) {
      throw new Error('DECK_EMPTY');
    }

    // Deck đã được publish rồi
    if (deck.is_public) {
      throw new Error('ALREADY_PUBLISHED');
    }

    return FlashcardsRepository.publishDeck(deckId);
  }

  /**
   * Ghi nhận user hoàn thành deck → cập nhật learning streak theo môn học.
   * Delegate hoàn toàn sang LearningStreakService để giữ logic streak ở 1 nơi.
   */
  async completeDeck(deckId, user) {
    return LearningStreakService.recordFlashcardDeckCompletion({
      userId: user.id,
      deckId,
    });
  }

  // ───────────────────────────────────────────
  // CLASS ACCESS
  // ───────────────────────────────────────────

  /**
   * Lấy danh sách lớp đang được phép xem 1 deck.
   */
  async getClassAccess(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    // Chỉ chủ deck hoặc admin mới xem được danh sách access
    if (user.role !== 'admin' && deck.created_by !== user.id) throw new Error('FORBIDDEN');

    return FlashcardsRepository.getClassAccess(deckId);
  }

  /**
   * Cập nhật (replace) danh sách lớp được phép xem deck.
   * Khi có ít nhất 1 lớp trong danh sách → deck được coi là “published” (is_public = true)
   * Khi danh sách rỗng → revoke tất cả, is_public = false
   */
  async setClassAccess(deckId, classIds, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    if (user.role !== 'admin' && deck.created_by !== user.id) throw new Error('FORBIDDEN');

    // Deck phải có ít nhất 1 thẻ mới có thể chia sẻ
    if (classIds.length > 0 && (!deck.cards || deck.cards.length === 0)) {
      throw new Error('DECK_EMPTY');
    }

    // Ghi access mới
    const grantedClassIds = await FlashcardsRepository.setClassAccess(deckId, classIds);

    // Cập nhật is_public trên deck: true nếu có ít nhất 1 lớp, false nếu không có lớp nào
    const shouldBePublic = classIds.length > 0;
    await FlashcardsRepository.updateDeck(deckId, { is_public: shouldBePublic });

    return { deck_id: deckId, granted_class_ids: grantedClassIds, is_public: shouldBePublic };
  }

  // ─────────────────────────────────────────────
  // CARD
  // ─────────────────────────────────────────────

  async createCard(deckId, data, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    if (user.role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    // Tự động tính position nếu không truyền
    const position = data.position ?? (await FlashcardsRepository.getNextPosition(deckId));

    return FlashcardsRepository.createCard({
      deck_id: deckId,
      type: data.type || 'multiple_choice',
      question: data.question,
      options: data.options || [],
      answer: data.answer,
      explanation: data.explanation,
      difficulty: data.difficulty,
      position,
    });
  }

  async getCardById(cardId, user) {
    const card = await FlashcardsRepository.findCardById(cardId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    // Lấy deck để kiểm tra quyền xem
    const deck = await FlashcardsRepository.findDeckById(card.deck_id);
    this._checkViewAccess(deck, user);

    return card;
  }

  async updateCard(cardId, data, user) {
    const card = await FlashcardsRepository.findCardById(cardId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    // Chỉ owner deck hoặc admin được sửa card
    if (user.role !== 'admin' && card.deck_owner_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const updated = await FlashcardsRepository.updateCard(cardId, data);
    return updated;
  }

  async deleteCard(cardId, user) {
    const card = await FlashcardsRepository.findCardById(cardId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    if (user.role !== 'admin' && card.deck_owner_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    return FlashcardsRepository.deleteCard(cardId);
  }

  // ─────────────────────────────────────────────
  // REVIEW
  // ─────────────────────────────────────────────

  /**
   * Ghi kết quả học 1 card + cập nhật SRS schedule.
   * grade: 'again' | 'hard' | 'good' | 'easy'
   */
  async submitReview(cardId, result, user) {
    const card = await FlashcardsRepository.findCardById(cardId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    // Kiểm tra quyền xem deck chứa card
    const deck = await FlashcardsRepository.findDeckById(card.deck_id);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    this._checkViewAccess(deck, user);

    // Ghi lịch sử review
    const review = await FlashcardsRepository.createReview({
      user_id:      user.id,
      flashcard_id: cardId,
      result,
    });

    // Tính toán và lưu SRS schedule tiếp theo
    const currentSchedule = await FlashcardsRepository.findSchedule(user.id, cardId);
    const nextSchedule    = this._computeNextSchedule(currentSchedule, result);
    const schedule        = await FlashcardsRepository.upsertSchedule({
      user_id:      user.id,
      flashcard_id: cardId,
      ...nextSchedule,
    });

    return { review, schedule };
  }

  /**
   * Lấy thống kê tiến độ học của user trên 1 deck.
   */
  async getDeckReviewStats(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    this._checkViewAccess(deck, user);

    return FlashcardsRepository.getDeckReviewStats(deckId, user.id);
  }

  /**
   * Lấy hàng đợi học theo SRS:
   * due → new → not_due
   */
  async getStudyQueue(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    this._checkViewAccess(deck, user);

    const cards = await FlashcardsRepository.getStudyQueue(deckId, user.id);

    // Thống kê nhanh cho UI
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

  /**
   * Tạo file Excel mẫu (.xlsx) để người dùng tải về điền dữ liệu flashcards
   */
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
    ];

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }, // Indigo color
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.height = 30;

    // Sample data rows
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
      },
      {
        question: 'Trong lập trình hướng đối tượng (OOP), tính chất nào cho phép một lớp kế thừa các thuộc tính và phương thức của lớp khác?',
        option_a: 'Tính đóng gói (Encapsulation)',
        option_b: 'Tính kế thừa (Inheritance)',
        option_c: 'Tính đa hình (Polymorphism)',
        option_d: 'Tính trừu tượng (Abstraction)',
        answer: 'B',
        explanation: 'Tính kế thừa cho phép lớp con tái sử dụng và mở rộng các thành phần của lớp cha.',
        difficulty: 'medium',
      },
    ];

    samples.forEach((sample) => {
      worksheet.addRow(sample);
    });

    // Style data rows
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = { vertical: 'middle', wrapText: true };
      }
    });

    return workbook;
  }

  /**
   * Đọc file Excel (.xlsx, .xls) và thêm cards vào deck
   */
  async importCardsFromExcel(deckId, fileBuffer, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    if (user.role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('EMPTY_WORKBOOK');
    }

    const getCellValue = (row, colIndex) => {
      const cell = row.getCell(colIndex);
      if (!cell || cell.value === null || cell.value === undefined) return '';
      if (typeof cell.value === 'object') {
        if (cell.value.text) return String(cell.value.text).trim();
        if (cell.value.result !== undefined) return String(cell.value.result).trim();
        if (Array.isArray(cell.value.richText)) {
          return cell.value.richText.map(t => t.text).join('').trim();
        }
      }
      return String(cell.value).trim();
    };

    const validCards = [];
    const errors = [];
    let totalProcessedRows = 0;

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const question = getCellValue(row, 1);
      const optA = getCellValue(row, 2);
      const optB = getCellValue(row, 3);
      const optC = getCellValue(row, 4);
      const optD = getCellValue(row, 5);
      const rawAnswer = getCellValue(row, 6);
      const explanation = getCellValue(row, 7);
      const rawDifficulty = getCellValue(row, 8).toLowerCase();

      // Bỏ qua dòng trống hoàn toàn
      if (!question && !optA && !optB && !optC && !optD && !rawAnswer) {
        continue;
      }

      totalProcessedRows++;

      // Kiểm tra câu hỏi
      if (!question) {
        errors.push({ row: rowNumber, message: 'Thiếu nội dung câu hỏi' });
        continue;
      }

      // Thu thập các lựa chọn không rỗng
      const options = [optA, optB, optC, optD].filter(Boolean);
      if (options.length < 2) {
        errors.push({ row: rowNumber, message: 'Cần có ít nhất 2 lựa chọn đáp án (A và B)' });
        continue;
      }

      // Kiểm tra đáp án
      if (!rawAnswer) {
        errors.push({ row: rowNumber, message: 'Thiếu đáp án đúng' });
        continue;
      }

      let answer = '';
      const upperAns = rawAnswer.toUpperCase();
      if (upperAns === 'A' && optA) answer = optA;
      else if (upperAns === 'B' && optB) answer = optB;
      else if (upperAns === 'C' && optC) answer = optC;
      else if (upperAns === 'D' && optD) answer = optD;
      else {
        // Tìm xem có khớp với text của lựa chọn nào không
        const matched = options.find((opt) => opt.toLowerCase() === rawAnswer.toLowerCase());
        if (matched) {
          answer = matched;
        } else {
          errors.push({
            row: rowNumber,
            message: `Đáp án "${rawAnswer}" không khớp với các lựa chọn (A, B, C, D hoặc nội dung lựa chọn)`,
          });
          continue;
        }
      }

      // Độ khó
      const difficulty = ['easy', 'medium', 'hard'].includes(rawDifficulty) ? rawDifficulty : 'medium';

      validCards.push({
        question,
        options,
        answer,
        explanation,
        difficulty,
      });
    }

    if (validCards.length === 0) {
      return {
        success: false,
        message: errors.length > 0
          ? 'Không tìm thấy thẻ hợp lệ nào trong file do có lỗi dữ liệu'
          : 'File Excel không có dữ liệu câu hỏi',
        total_rows: totalProcessedRows,
        imported_count: 0,
        errors,
        cards: [],
      };
    }

    let nextPos = await FlashcardsRepository.getNextPosition(deckId);
    const cardsToInsert = validCards.map((c) => ({
      deck_id: deckId,
      type: 'multiple_choice',
      question: c.question,
      options: c.options,
      answer: c.answer,
      explanation: c.explanation,
      difficulty: c.difficulty,
      position: nextPos++,
    }));

    const inserted = await FlashcardsRepository.createCardsBatch(cardsToInsert);

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

  /**
   * Thuật toán SM-2 đơn giản hóa.
   * Input  : current schedule (null nếu card chưa từng học), grade của user
   * Output : { ease_factor, interval_days, repetitions, due_date }
   *
   * Grade mapping:
   *  again → reset (interval=1, reps=0, EF-=0.20)
   *  hard  → interval ×1.2, EF-=0.15
   *  good  → interval ×EF (standard SM-2)
   *  easy  → interval ×EF×1.3, EF+=0.15
   */
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
        newEf   = ef;                          // giữ nguyên EF
        break;

      case 'easy':
        if      (reps === 0) newInterval = 4;
        else if (reps === 1) newInterval = 8;
        else                 newInterval = Math.max(1, Math.round(interval * ef * 1.3));
        newReps = reps + 1;
        newEf   = Math.min(2.5, ef + 0.15);   // cấp tại 2.5
        break;

      default:
        newInterval = 1; newReps = 0; newEf = ef;
    }

    // Tính ngày đến hạn tiếp theo (UTC)
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
  /**
   * Kiểm tra quyền xem deck:
   * - Admin: luôn xem được
   * - Lecturer: deck public hoặc deck của mình
   * - Student: deck public (class_id matching được xử lý ở query filter)
   */
  _checkViewAccess(deck, user) {
    if (user.role === 'admin') return;
    if (deck.is_public) return;
    if (deck.created_by === user.id) return;
    throw new Error('FORBIDDEN');
  }
}

module.exports = new FlashcardsService();
