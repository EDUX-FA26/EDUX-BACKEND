
const crypto = require('crypto');

function buildClassificationInput(card, topics) {
  const cardData = {
    question: card.question,
    answer: card.answer,
    explanation: card.explanation,
    options: card.options,
    type: card.type,
    difficulty: card.difficulty
  };

  const topicData = topics.map(topic => ({
    id: topic.id,
    name: topic.name,
    description: topic.description,
    parentId: topic.parent_id
  }));

  return JSON.stringify({ cardData, topicData });
}

function hashClassificationInput(input) {
  return crypto
    .createHash('sha256')
    .update(input)
    .digest('hex');
}

module.exports = {
  buildClassificationInput,
  hashClassificationInput
};
