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
      type: data.type || 'essay',
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
   * Ghi kết quả học 1 card.
   * - Mọi user đã đăng nhập đều có thể review (kể cả lecturer, admin).
   * - Card phải tồn tại và deck chứa nó phải có quyền xem.
   */
  async submitReview(cardId, result, user) {
    const card = await FlashcardsRepository.findCardById(cardId);
    if (!card || !card.is_active) throw new Error('CARD_NOT_FOUND');

    // Kiểm tra quyền xem deck chứa card
    const deck = await FlashcardsRepository.findDeckById(card.deck_id);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    this._checkViewAccess(deck, user);

    return FlashcardsRepository.createReview({
      user_id:      user.id,
      flashcard_id: cardId,
      result,
    });
  }

  /**
   * Lấy thống kê tiến độ học của user trên 1 deck.
   * - User chỉ xem được stats của deck mình có quyền truy cập.
   */
  async getDeckReviewStats(deckId, user) {
    const deck = await FlashcardsRepository.findDeckById(deckId);
    if (!deck || !deck.is_active) throw new Error('DECK_NOT_FOUND');
    this._checkViewAccess(deck, user);

    return FlashcardsRepository.getDeckReviewStats(deckId, user.id);
  }

  // ─────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────

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
