const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePedagogicalFallbackResult } = require('../src/config/gemini.config');

test('generatePedagogicalFallbackResult: returns has_course_topics = false when course has no topics', () => {
  const result = generatePedagogicalFallbackResult({
    assignmentInfo: 'Xây dựng REST API',
    sourceCode: 'class OrderService {}',
    aiDeclarationRequired: true,
    courseTopics: []
  });

  assert.equal(result.has_course_topics, false, 'has_course_topics must be false when no topics');
  assert.deepEqual(result.course_topics, [], 'course_topics must be an empty array');
  assert.deepEqual(result.recommended_topics, [], 'recommended_topics must be an empty array');
});

test('generatePedagogicalFallbackResult: returns has_course_topics = true and recommended_topics when course has topics', () => {
  const sampleTopics = [
    { id: 't1', name: 'Microservices Architecture', description: 'Kiến trúc dịch vụ vi mô' },
    { id: 't2', name: 'Database Indexing & Query Optimization', description: 'Tối ưu hóa CSDL' }
  ];

  const result = generatePedagogicalFallbackResult({
    assignmentInfo: 'Xây dựng REST API',
    sourceCode: 'class OrderService {}',
    aiDeclarationRequired: true,
    courseTopics: sampleTopics
  });

  assert.equal(result.has_course_topics, true, 'has_course_topics must be true when topics exist');
  assert.equal(result.course_topics.length, 2, 'course_topics must preserve all course topics');
  assert.equal(result.recommended_topics.length > 0, true, 'recommended_topics must contain recommended topics');
  assert.equal(result.recommended_topics[0].name, 'Microservices Architecture');
});
