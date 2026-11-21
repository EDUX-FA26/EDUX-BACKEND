const crypto = require('crypto');
const ExcelJS = require('exceljs');
const FlashcardsRepository = require('./flashcards.repository');
const TopicMatchingService = require('../topics/topicMatching.service');

const memoryPreviewStore = new Map();
const memoryIdempotencyStore = new Map();
const activeConfirmLocks = new Set();

let redisClient = null;
try {
  const { redis } = require('../../config/redis.config');
  redisClient = redis;
} catch (e) {}

async function acquireConfirmLock(lockKey, ttlSeconds = 60) {
  if (activeConfirmLocks.has(lockKey)) {
    return false;
  }
  activeConfirmLocks.add(lockKey);

  try {
    if (redisClient && redisClient.isOpen) {
      const setSuccess = await redisClient.set(`flashcard_lock:${lockKey}`, '1', {
        NX: true,
        EX: ttlSeconds,
      });
      if (!setSuccess) {
        activeConfirmLocks.delete(lockKey);
        return false;
      }
    }
  } catch (e) {}

  return true;
}

async function releaseConfirmLock(lockKey) {
  activeConfirmLocks.delete(lockKey);
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.del(`flashcard_lock:${lockKey}`);
    }
  } catch (e) {}
}

async function getIdempotencyResult(idempotencyKey) {
  if (!idempotencyKey) return null;
  try {
    if (redisClient && redisClient.isOpen) {
      const cached = await redisClient.get(`flashcard_import_idempotency:${idempotencyKey}`);
      if (cached) return JSON.parse(cached);
    }
  } catch (e) {}
  const entry = memoryIdempotencyStore.get(idempotencyKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryIdempotencyStore.delete(idempotencyKey);
    return null;
  }
  return entry.result;
}

async function savePreview(previewId, data, ttlSeconds = 1800) {
  memoryPreviewStore.set(previewId, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.setEx(`flashcard_import_preview:${previewId}`, ttlSeconds, JSON.stringify(data));
    }
  } catch (e) {}
}

async function getPreview(previewId) {
  try {
    if (redisClient && redisClient.isOpen) {
      const cached = await redisClient.get(`flashcard_import_preview:${previewId}`);
      if (cached) return JSON.parse(cached);
    }
  } catch (e) {}
  const entry = memoryPreviewStore.get(previewId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryPreviewStore.delete(previewId);
    return null;
  }
  return entry.data;
}

async function markPreviewCommitted(previewId, resultData = null, idempotencyKey = null) {
  const entry = memoryPreviewStore.get(previewId);
  if (entry) {
    entry.data.committed = true;
    if (resultData) entry.data.committedResult = resultData;
  }
  if (idempotencyKey && resultData) {
    memoryIdempotencyStore.set(idempotencyKey, {
      result: resultData,
      expiresAt: Date.now() + 86400 * 1000,
    });
  }
  try {
    if (redisClient && redisClient.isOpen) {
      const cached = await redisClient.get(`flashcard_import_preview:${previewId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        parsed.committed = true;
        if (resultData) parsed.committedResult = resultData;
        await redisClient.setEx(`flashcard_import_preview:${previewId}`, 86400, JSON.stringify(parsed));
      }
      if (idempotencyKey && resultData) {
        await redisClient.setEx(`flashcard_import_idempotency:${idempotencyKey}`, 86400, JSON.stringify(resultData));
      }
    }
  } catch (e) {}
}

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

    const topicId = data.topicId || data.topic_id;
    if (!topicId) {
      const error = new Error('TOPIC_REQUIRED');
      error.status = 400;
      throw error;
    }

    const topic = await FlashcardsRepository.findCanonicalTopicById(topicId, schoolId, deck.subject_id);
    if (!topic) {
      const error = new Error('TOPIC_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    if (
      topic.status !== 'approved' ||
      topic.review_required === true ||
      topic.is_active === false ||
      topic.parent_id !== null
    ) {
      const error = new Error('TOPIC_NOT_ELIGIBLE');
      error.status = 409;
      throw error;
    }

    const position = data.position ?? (await FlashcardsRepository.getNextPosition(deckId, schoolId));

    return FlashcardsRepository.createCard({
      deck_id: deckId,
      type: data.type || 'multiple_choice',
      question: data.question,
      options: data.options || [],
      answer: data.answer,
      explanation: data.explanation || '',
      difficulty: data.difficulty,
      position,
      topic_id: topic.id,
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

    const topicId = data.topicId !== undefined ? data.topicId : data.topic_id;

    const reviewCount = await FlashcardsRepository.getCardReviewCount(cardId, schoolId);
    if (reviewCount > 0) {
      const isTopicChanged = topicId !== undefined && topicId !== card.topic_id;
      const isQuestionChanged = data.question !== undefined && data.question.trim() !== (card.question || '').trim();
      const isAnswerChanged = data.answer !== undefined && data.answer.trim() !== (card.answer || '').trim();
      const isTypeChanged = data.type !== undefined && data.type !== card.type;

      let isOptionsChanged = false;
      if (data.options !== undefined) {
        const normExisting = Array.isArray(card.options) ? card.options.map((o) => (typeof o === 'object' && o.text ? String(o.text).trim() : String(o).trim())) : [];
        const normNew = Array.isArray(data.options) ? data.options.map((o) => (typeof o === 'object' && o.text ? String(o.text).trim() : String(o).trim())) : [];
        if (normExisting.length !== normNew.length || normExisting.some((opt, i) => opt !== normNew[i])) {
          isOptionsChanged = true;
        }
      }

      if (isTopicChanged && !isQuestionChanged && !isAnswerChanged && !isTypeChanged && !isOptionsChanged) {
        const error = new Error('CANNOT_CHANGE_TOPIC_WITH_REVIEWS');
        error.status = 400;
        throw error;
      }

      if (isTopicChanged || isQuestionChanged || isAnswerChanged || isTypeChanged || isOptionsChanged) {
        const error = new Error('CANNOT_MODIFY_REVIEWED_CARD');
        error.status = 400;
        throw error;
      }
    }

    if (topicId !== undefined && topicId !== card.topic_id) {
      if (topicId) {
        const topic = await FlashcardsRepository.findCanonicalTopicById(topicId, schoolId, card.subject_id);
        if (!topic) {
          const error = new Error('TOPIC_NOT_FOUND');
          error.status = 404;
          throw error;
        }

        if (
          topic.status !== 'approved' ||
          topic.review_required === true ||
          topic.is_active === false ||
          topic.parent_id !== null
        ) {
          const error = new Error('TOPIC_NOT_ELIGIBLE');
          error.status = 409;
          throw error;
        }
      }
    }

    const updated = await FlashcardsRepository.updateCard(
      cardId,
      data,
      {
        userId: user.id,
        subject_id: card.subject_id,
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

  async previewCardsFromExcel(deckId, fileBuffer, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const workbook = new ExcelJS.Workbook();
    const isZip = fileBuffer.length > 2 && fileBuffer[0] === 0x50 && fileBuffer[1] === 0x4B;
    if (isZip) {
      await workbook.xlsx.load(fileBuffer);
    } else {
      const { Readable } = require('stream');
      await workbook.csv.read(Readable.from([fileBuffer.toString('utf8')]));
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      const err = new Error('EMPTY_WORKBOOK');
      err.status = 400;
      throw err;
    }

    let colMap = {
      question: 1,
      optA: 2,
      optB: 3,
      optC: 4,
      optD: 5,
      answer: 6,
      explanation: 7,
      difficulty: 8,
      topic: 9,
    };

    const headerRow = worksheet.getRow(1);
    if (headerRow) {
      headerRow.eachCell((cell, colNumber) => {
        const val = String(cell.value || '').toLowerCase().trim();
        if (val.includes('câu hỏi') || val.includes('question')) colMap.question = colNumber;
        else if (val.includes('lựa chọn a') || val === 'a' || val.includes('option a')) colMap.optA = colNumber;
        else if (val.includes('lựa chọn b') || val === 'b' || val.includes('option b')) colMap.optB = colNumber;
        else if (val.includes('lựa chọn c') || val === 'c' || val.includes('option c')) colMap.optC = colNumber;
        else if (val.includes('lựa chọn d') || val === 'd' || val.includes('option d')) colMap.optD = colNumber;
        else if (val.includes('đáp án') || val.includes('answer') || val.includes('correct')) colMap.answer = colNumber;
        else if (val.includes('giải thích') || val.includes('explanation')) colMap.explanation = colNumber;
        else if (val.includes('độ khó') || val.includes('difficulty')) colMap.difficulty = colNumber;
        else if (val.includes('chủ đề') || val.includes('topic')) colMap.topic = colNumber;
      });
    }

    const catalogTopics = await FlashcardsRepository.getApprovedCanonicalTopicsForSubject(
      schoolId,
      deck.subject_id
    );

    const rawParsedRows = [];
    let totalProcessedRows = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const rowValues = Array.isArray(row.values) ? row.values.slice(1) : [];
      const hasAnyValue = rowValues.some((v) => v !== null && v !== undefined && String(v).trim() !== '');
      if (!hasAnyValue) return;

      totalProcessedRows++;

      const getCellText = (colIndex) => {
        if (!colIndex) return '';
        const val = row.getCell(colIndex).value;
        if (val === null || val === undefined) return '';
        if (typeof val === 'object' && val.text) return String(val.text).trim();
        return String(val).trim();
      };

      const question = getCellText(colMap.question);
      const optA = getCellText(colMap.optA);
      const optB = getCellText(colMap.optB);
      const optC = getCellText(colMap.optC);
      const optD = getCellText(colMap.optD);
      const rawAns = getCellText(colMap.answer);
      const explanation = getCellText(colMap.explanation);
      const rawDiff = getCellText(colMap.difficulty).toLowerCase();
      const rawTopic = getCellText(colMap.topic);

      const validationErrors = [];
      if (!question) validationErrors.push('Thiếu nội dung câu hỏi');
      if (!optA || !optB) validationErrors.push('Cần ít nhất 2 lựa chọn (A và B)');
      if (!rawAns) validationErrors.push('Thiếu đáp án đúng');

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
        } else {
          validationErrors.push(`Đáp án '${upperAns}' không tương ứng với lựa chọn nào`);
        }
      } else {
        const matchingOpts = options.filter(
          (o) => o.text.trim().toLowerCase() === rawAns.trim().toLowerCase()
        );
        if (matchingOpts.length === 1) {
          resolvedAnswer = matchingOpts[0].text;
        } else if (matchingOpts.length === 0 && rawAns) {
          validationErrors.push('Đáp án đúng không khớp với bất kỳ lựa chọn nào trong các phương án A-D');
        }
      }

      rawParsedRows.push({
        rowNumber,
        question,
        options,
        answer: resolvedAnswer,
        explanation,
        difficulty,
        rawTopic: rawTopic || '',
        validationErrors,
      });
    });

    const rows = [];
    for (const item of rawParsedRows) {
      const matchResult = await TopicMatchingService.matchTopic({
        rawTopic: item.rawTopic,
        question: item.question,
        answer: item.answer,
        explanation: item.explanation,
        catalogTopics,
        limit: 3,
        useAI: false, // Excel batch preview dùng Tier A + Tier B thuần deterministic / lexical
      });

      rows.push({
        rowNumber: item.rowNumber,
        question: item.question,
        options: item.options,
        answer: item.answer,
        explanation: item.explanation,
        difficulty: item.difficulty,
        rawTopic: item.rawTopic,
        validationErrors: item.validationErrors,
        candidates: matchResult.candidates || [],
        suggestedTopicId: matchResult.suggestedTopicId || null,
        confirmedTopicId: null, // Bắt buộc Lecturer phải xác nhận!
        matchType: matchResult.candidates[0]?.matchType || matchResult.status || 'no_match',
        isAmbiguous: matchResult.isAmbiguous || false,
        matchReason: matchResult.candidates[0]?.reason || matchResult.reason || '',
      });
    }

    if (rows.length === 0) {
      const err = new Error('EMPTY_IMPORT_DATA');
      err.status = 400;
      err.message = 'Không tìm thấy dòng câu hỏi hợp lệ nào trong file Excel';
      throw err;
    }

    const previewId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1800 * 1000).toISOString();

    const previewData = {
      previewId,
      deckId,
      schoolId,
      userId: user.id,
      subjectId: deck.subject_id,
      createdAt: new Date().toISOString(),
      expiresAt,
      rows,
      totalRows: totalProcessedRows,
    };

    await savePreview(previewId, previewData, 1800);

    const validRowsCount = rows.filter((r) => r.validationErrors.length === 0).length;
    const invalidRowsCount = rows.filter((r) => r.validationErrors.length > 0).length;

    return {
      previewId,
      expiresAt,
      totalRows: totalProcessedRows,
      validRowsCount,
      invalidRowsCount,
      rows,
      catalogTopics,
    };
  }

  async getTopicSuggestions(deckId, { rawTopic = '', question = '', answer = '', limit = 3 }, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const catalogTopics = await FlashcardsRepository.getApprovedCanonicalTopicsForSubject(
      schoolId,
      deck.subject_id
    );

    const matchResult = await TopicMatchingService.matchTopic({
      rawTopic,
      question,
      answer,
      catalogTopics,
      limit,
      useAI: true,
    });

    return {
      status: matchResult.status,
      confirmedTopicId: null,
      suggestedTopicId: matchResult.suggestedTopicId,
      isAmbiguous: matchResult.isAmbiguous,
      candidates: matchResult.candidates,
      reason: matchResult.reason,
    };
  }

  async confirmCardsImport(deckId, { previewId, rows, idempotencyKey }, user, tenant) {
    const schoolId = tenant?.schoolId;
    const deck = await FlashcardsRepository.findDeckById(deckId, schoolId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');

    const role = tenant?.role || user?.role;
    if (role !== 'school_admin' && role !== 'admin' && deck.created_by !== user.id) {
      throw new Error('FORBIDDEN');
    }

    const preview = await getPreview(previewId);
    if (!preview) {
      const err = new Error('PREVIEW_EXPIRED');
      err.status = 410;
      err.message = 'Phiên xem trước đã hết hạn hoặc không tồn tại. Vui lòng tải lại file Excel.';
      throw err;
    }

    if (preview.schoolId !== schoolId || preview.userId !== user.id) {
      const err = new Error('PREVIEW_ACCESS_DENIED: Bạn không có quyền truy cập phiên xem trước này');
      err.code = 'PREVIEW_ACCESS_DENIED';
      err.status = 403;
      throw err;
    }

    if (preview.deckId !== deckId) {
      const err = new Error('PREVIEW_DECK_MISMATCH: Phiên xem trước không thuộc bộ thẻ này');
      err.code = 'PREVIEW_DECK_MISMATCH';
      err.status = 403;
      throw err;
    }

    if (idempotencyKey) {
      const cached = await getIdempotencyResult(idempotencyKey);
      if (cached) {
        return {
          success: true,
          alreadyCommitted: true,
          idempotent: true,
          message: 'Dữ liệu đã được import thành công trước đó (Idempotent)',
          ...cached,
        };
      }
    }

    if (preview.committed) {
      const resultData = preview.committedResult || {
        importedCount: preview.rows?.length || 0,
      };
      return {
        success: true,
        alreadyCommitted: true,
        idempotent: true,
        message: 'Dữ liệu đã được import thành công trước đó (Idempotent)',
        ...resultData,
      };
    }

    const lockKey = `confirm:${previewId}`;
    const acquired = await acquireConfirmLock(lockKey, 60);
    if (!acquired) {
      const err = new Error('CONFIRM_IN_PROGRESS: Yêu cầu import đang được xử lý, vui lòng chờ trong giây lát.');
      err.code = 'CONFIRM_IN_PROGRESS';
      err.status = 409;
      throw err;
    }

    try {
      const validPreviewRows = preview.rows.filter(
        (r) => !r.validationErrors || r.validationErrors.length === 0
      );
      const validRowNumbersSet = new Set(validPreviewRows.map((r) => r.rowNumber));

      if (!Array.isArray(rows) || rows.length === 0) {
        const err = new Error('ROW_TOPIC_MISSING: Danh sách xác nhận Topic rỗng');
        err.code = 'ROW_TOPIC_MISSING';
        err.status = 422;
        throw err;
      }

      const seenRowNumbers = new Set();
      const rowConfirmMap = new Map();

      for (const item of rows) {
        if (!item || typeof item.rowNumber !== 'number') {
          const err = new Error('INVALID_ROW_FORMAT: Định dạng dòng xác nhận không hợp lệ');
          err.code = 'INVALID_ROW_FORMAT';
          err.status = 422;
          throw err;
        }

        if (seenRowNumbers.has(item.rowNumber)) {
          const err = new Error(`DUPLICATE_ROW_NUMBER: Dòng ${item.rowNumber} bị gửi trùng lặp trong danh sách xác nhận`);
          err.code = 'DUPLICATE_ROW_NUMBER';
          err.status = 422;
          throw err;
        }
        seenRowNumbers.add(item.rowNumber);

        if (!validRowNumbersSet.has(item.rowNumber)) {
          const err = new Error(`INVALID_ROW_NUMBER: Dòng ${item.rowNumber} không tồn tại hoặc có lỗi trong phiên xem trước`);
          err.code = 'INVALID_ROW_NUMBER';
          err.status = 422;
          throw err;
        }

        if (!item.topicId) {
          const err = new Error(`ROW_TOPIC_MISSING: Dòng ${item.rowNumber} chưa được chọn Topic chuẩn`);
          err.code = 'ROW_TOPIC_MISSING';
          err.status = 422;
          throw err;
        }

        rowConfirmMap.set(item.rowNumber, item.topicId);
      }

      if (seenRowNumbers.size !== validPreviewRows.length) {
        const missingRowNumbers = validPreviewRows
          .filter((r) => !seenRowNumbers.has(r.rowNumber))
          .map((r) => r.rowNumber);
        const err = new Error(`ROW_TOPIC_MISSING: Còn thiếu xác nhận Topic cho các dòng: ${missingRowNumbers.join(', ')}`);
        err.code = 'ROW_TOPIC_MISSING';
        err.status = 422;
        throw err;
      }

      const uniqueTopicIds = Array.from(new Set(Array.from(rowConfirmMap.values())));
      const topicCheckMap = new Map();

      for (const tid of uniqueTopicIds) {
        const t = await FlashcardsRepository.findCanonicalTopicById(tid, schoolId, deck.subject_id);
        if (
          !t ||
          t.status !== 'approved' ||
          t.review_required === true ||
          t.is_active === false ||
          t.parent_id !== null
        ) {
          const err = new Error('TOPIC_NOT_ELIGIBLE');
          err.status = 409;
          throw err;
        }
        topicCheckMap.set(tid, t);
      }

      const validCardsToInsert = [];
      let nextPos = await FlashcardsRepository.getNextPosition(deckId, schoolId);

      for (const r of validPreviewRows) {
        const confirmedTid = rowConfirmMap.get(r.rowNumber);

        validCardsToInsert.push({
          deck_id: deckId,
          type: 'multiple_choice',
          question: r.question,
          options: r.options,
          answer: r.answer,
          explanation: r.explanation || '',
          difficulty: r.difficulty || 'medium',
          position: nextPos++,
          topic_id: confirmedTid,
          school_id: schoolId,
        });
      }

      if (validCardsToInsert.length === 0) {
        const err = new Error('NO_VALID_CARDS');
        err.status = 400;
        err.message = 'Không có câu hỏi hợp lệ nào để import';
        throw err;
      }

      const inserted = await FlashcardsRepository.createCardsBatchWithTopics(validCardsToInsert, {
        subject_id: deck.subject_id,
        userId: user.id,
        school_id: schoolId,
      });

      const resultPayload = {
        importedCount: inserted.length,
        cards: inserted,
      };

      await markPreviewCommitted(previewId, resultPayload, idempotencyKey);

      return {
        success: true,
        message: `Đã nhập thành công ${inserted.length} thẻ Flashcard`,
        ...resultPayload,
      };
    } finally {
      await releaseConfirmLock(lockKey);
    }
  }

  async importCardsFromExcel(deckId, fileBuffer, user, tenant, { preview = false } = {}) {
    if (preview) {
      return this.previewCardsFromExcel(deckId, fileBuffer, user, tenant);
    }
    const err = new Error('DIRECT_IMPORT_DEPRECATED: Luồng import Flashcard yêu cầu xem trước và xác nhận Canonical Topic (Preview & Confirm). Vui lòng dùng endpoint /import/preview và /import/confirm.');
    err.code = 'DIRECT_IMPORT_DEPRECATED';
    err.status = 400;
    throw err;
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
      if (deck.created_by === user.id) return;
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
