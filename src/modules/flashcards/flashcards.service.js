const FlashcardsRepository = require('./flashcards.repository');

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
