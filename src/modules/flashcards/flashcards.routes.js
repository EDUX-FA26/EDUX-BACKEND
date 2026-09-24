const express = require('express');
const router = express.Router();

const ctrl = require('./flashcards.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { validate } = require('../../middlewares/validate.middleware');
const {
  createDeck,
  updateDeck,
  getDecksQuery,
  createCard,
  updateCard,
} = require('./flashcards.validation');

// Toàn bộ routes yêu cầu đăng nhập
router.use(authenticate);

// Middleware phân quyền
const authorizeWrite = (req, res, next) => {
  if (!['admin', 'lecturer'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Forbidden: Only admin or lecturer can perform this action' });
  }
  next();
};

// ─────────────────────────────────────────────
// DECK routes
// ─────────────────────────────────────────────

// GET  /api/flashcards/decks          — Danh sách deck
router.get('/decks', validate(getDecksQuery, 'query'), ctrl.getDecks);

// POST /api/flashcards/decks          — Tạo deck mới (lecturer, admin)
router.post('/decks', authorizeWrite, validate(createDeck), ctrl.createDeck);

// GET  /api/flashcards/decks/:deckId  — Chi tiết deck + toàn bộ cards
router.get('/decks/:deckId', ctrl.getDeckById);

// put /api/flashcards/decks/:deckId — Sửa deck
router.put('/decks/:deckId', authorizeWrite, validate(updateDeck), ctrl.updateDeck);

// DELETE /api/flashcards/decks/:deckId — Xóa deck (soft delete)
router.delete('/decks/:deckId', authorizeWrite, ctrl.deleteDeck);

// POST   /api/flashcards/decks/:deckId/cards — UC66 Tạo card
router.post('/decks/:deckId/cards', authorizeWrite, validate(createCard), ctrl.createCard);

// POST   /api/flashcards/decks/:deckId/complete — Hoàn thành flashcard deck (tăng streak)
router.post('/decks/:deckId/complete', ctrl.completeDeck);

// ─────────────────────────────────────────────
// CARD routes
// ─────────────────────────────────────────────

// GET    /api/flashcards/:id                 — UC67 Xem card
router.get('/:id', ctrl.getCardById);

// put  /api/flashcards/:id                 — UC68 Sửa card
router.put('/:id', authorizeWrite, validate(updateCard), ctrl.updateCard);

// DELETE /api/flashcards/:id                 — UC69 Xóa card
router.delete('/:id', authorizeWrite, ctrl.deleteCard);

module.exports = router;
