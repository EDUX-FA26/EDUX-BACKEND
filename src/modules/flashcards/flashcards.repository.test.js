const mockClient = {
  query: jest.fn(),
};

jest.mock('../../config/db.config', () => ({
  pool: {
    query: jest.fn(),
  },
  withTransaction: jest.fn(async (cb) => cb(mockClient)),
}));

const FlashcardsRepository = require('./flashcards.repository');

describe('FlashcardsRepository Unit Verification', () => {
  const schoolId = '11111111-1111-4111-8111-111111111111';
  const deckId = '22222222-2222-4222-8222-222222222222';
  const cardId = '33333333-3333-4333-8333-333333333333';
  const topicId = '44444444-4444-4444-8444-444444444444';
  const userId = '55555555-5555-4555-8555-555555555555';
  const subjectId = '66666666-6666-4666-8666-666666666666';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCard', () => {
    test('binds topic_id and executes setCardTopic without ReferenceError', async () => {
      mockClient.query.mockImplementation((sql, params) => {
        if (sql.includes('INSERT INTO flashcards')) {
          return Promise.resolve({
            rows: [
              {
                id: cardId,
                deck_id: deckId,
                question: 'Biến là gì?',
                options: ['A', 'B'],
                answer: 'A',
                school_id: schoolId,
              },
            ],
          });
        }
        if (sql.includes('flashcard_topics')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('SELECT id, name, code FROM topics WHERE id = $1')) {
          return Promise.resolve({
            rows: [{ id: topicId, name: 'Biến và kiểu dữ liệu', code: 'VAR_TYPES' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const card = await FlashcardsRepository.createCard({
        deck_id: deckId,
        type: 'multiple_choice',
        question: 'Biến là gì?',
        options: ['A', 'B'],
        answer: 'A',
        explanation: 'Giải thích',
        difficulty: 'medium',
        position: 1,
        topic_id: topicId,
        userId,
        subject_id: subjectId,
        school_id: schoolId,
      });

      expect(card).toBeDefined();
      expect(card.id).toBe(cardId);
      expect(card.topic_id).toBe(topicId);
      expect(card.topic_name).toBe('Biến và kiểu dữ liệu');
      expect(card.topic_code).toBe('VAR_TYPES');

      // Verify setCardTopic query was executed
      const setTopicCalls = mockClient.query.mock.calls.filter(([sql]) =>
        sql.includes('INSERT INTO flashcard_topics')
      );
      expect(setTopicCalls.length).toBe(1);
      expect(setTopicCalls[0][1]).toEqual([cardId, topicId, userId, schoolId]);
    });
  });

  describe('updateCard', () => {
    test('updates card and sets topic mapping using school_id', async () => {
      mockClient.query.mockImplementation((sql, params) => {
        if (sql.includes('UPDATE flashcards')) {
          return Promise.resolve({
            rows: [
              {
                id: cardId,
                deck_id: deckId,
                question: 'Câu hỏi mới',
                school_id: schoolId,
              },
            ],
          });
        }
        if (sql.includes('flashcard_topics')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('SELECT id, name, code FROM topics WHERE id = $1')) {
          return Promise.resolve({
            rows: [{ id: topicId, name: 'Topic Mới', code: 'NEW_TOPIC' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const updated = await FlashcardsRepository.updateCard(
        cardId,
        { question: 'Câu hỏi mới' },
        { userId, subject_id: subjectId, topic_id: topicId, school_id: schoolId }
      );

      expect(updated).toBeDefined();
      expect(updated.topic_id).toBe(topicId);
      expect(updated.topic_name).toBe('Topic Mới');
      expect(updated.topic_code).toBe('NEW_TOPIC');
    });
  });

  describe('findOrCreateTopic deprecation', () => {
    test('unconditionally throws FIND_OR_CREATE_TOPIC_DEPRECATED', async () => {
      await expect(
        FlashcardsRepository.findOrCreateTopic('Biến', subjectId, schoolId)
      ).rejects.toThrow('FIND_OR_CREATE_TOPIC_DEPRECATED');
    });
  });
});
