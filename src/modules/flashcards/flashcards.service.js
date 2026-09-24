const FlashcardsRepository = require('./flashcards.repository');
const LearningStreakService = require('../learning/learningStreak.service');

class FlashcardsService {

  // ─────────────────────────────────────────────
  // DECK
  // ─────────────────────────────────────────────

  async getDecks(filters, user) {
    return FlashcardsRepository.findDecks({
      ...filters,
      role:   user.role,
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
      deck_id:     deckId,
      type:        data.type || 'essay',
      question:    data.question,
      options:     data.options || [],
      answer:      data.answer,
      explanation: data.explanation,
      difficulty:  data.difficulty,
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
