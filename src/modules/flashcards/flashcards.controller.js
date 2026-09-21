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
        req.user
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
      const deck = await FlashcardsService.getDeckById(req.params.deckId, req.user);
      res.status(200).json({ success: true, data: deck });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async createDeck(req, res, next) {
    try {
      const deck = await FlashcardsService.createDeck(req.body, req.user);
      res.status(201).json({ success: true, data: deck });
    } catch (error) {
      next(error);
    }
  },

  async updateDeck(req, res, next) {
    try {
      const deck = await FlashcardsService.updateDeck(req.params.deckId, req.body, req.user);
      res.status(200).json({ success: true, data: deck });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async deleteDeck(req, res, next) {
    try {
      await FlashcardsService.deleteDeck(req.params.deckId, req.user);
      res.status(200).json({ success: true, message: 'Deck deleted successfully' });
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
      const card = await FlashcardsService.createCard(req.params.deckId, req.body, req.user);
      res.status(201).json({ success: true, data: card });
    } catch (error) {
      if (error.message === 'DECK_NOT_FOUND') return res.status(404).json({ success: false, message: 'Deck not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async getCardById(req, res, next) {
    try {
      const card = await FlashcardsService.getCardById(req.params.id, req.user);
      res.status(200).json({ success: true, data: card });
    } catch (error) {
      if (error.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, message: 'Card not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async updateCard(req, res, next) {
    try {
      const card = await FlashcardsService.updateCard(req.params.id, req.body, req.user);
      res.status(200).json({ success: true, data: card });
    } catch (error) {
      if (error.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, message: 'Card not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },

  async deleteCard(req, res, next) {
    try {
      await FlashcardsService.deleteCard(req.params.id, req.user);
      res.status(200).json({ success: true, message: 'Card deleted successfully' });
    } catch (error) {
      if (error.message === 'CARD_NOT_FOUND') return res.status(404).json({ success: false, message: 'Card not found' });
      if (error.message === 'FORBIDDEN')      return res.status(403).json({ success: false, message: 'Access denied' });
      next(error);
    }
  },
};

module.exports = FlashcardsController;
