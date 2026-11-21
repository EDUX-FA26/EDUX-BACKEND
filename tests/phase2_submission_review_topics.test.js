const test = require('node:test');
const assert = require('node:assert/strict');
const { generatePedagogicalFallbackResult } = require('../src/config/gemini.config');

test('Phase 2 Fallback: Recommended topics contains canonical topic id and metadata', () => {
  const sampleTopics = [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Đảng lãnh đạo kháng chiến', code: 'RES_WAR', description: 'Giai đoạn kháng chiến' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Đường lối đổi mới', code: 'DOI_MOI', description: 'Đại hội VI' }
  ];

  const result = generatePedagogicalFallbackResult({
    assignmentInfo: 'Bài tiểu luận lịch sử',
    sourceCode: 'Mã nguồn hoặc nội dung bài nộp',
    aiDeclarationRequired: true,
    courseTopics: sampleTopics
  });

  assert.equal(result.has_course_topics, true);
  assert.equal(result.recommended_topics.length, 2);
  assert.equal(result.recommended_topics[0].topic_id, '11111111-1111-1111-1111-111111111111');
  assert.equal(result.recommended_topics[0].name, 'Đảng lãnh đạo kháng chiến');
  assert.equal(result.recommended_topics[0].priority, 'high');
});

test('Phase 2 Fallback: Empty course topics results in empty recommended topics', () => {
  const result = generatePedagogicalFallbackResult({
    assignmentInfo: 'Bài tập phần mềm',
    sourceCode: 'console.log("hello")',
    aiDeclarationRequired: false,
    courseTopics: []
  });

  assert.equal(result.has_course_topics, false);
  assert.deepEqual(result.recommended_topics, []);
});

test('Phase 2 Repository: saveSubmissionReviewTopics executes insert without parameter $12 type collision', async () => {
  const GradingRepository = require('../src/modules/grading/grading.repository');
  const { pool } = require('../src/config/db.config');

  const executedQueries = [];
  const originalQuery = pool.query;
  pool.query = async (sql, params) => {
    executedQueries.push({ sql, params });
    if (sql.includes('SELECT id, status, reviewed_at FROM submission_review_topics')) {
      return { rows: [] }; // No existing row -> triggers insertQuery
    }
    if (sql.includes('INSERT INTO submission_review_topics')) {
      return { rows: [{ id: 'new-row-uuid', status: params[11], topic_id: params[7] }] };
    }
    return { rows: [] };
  };

  try {
    const saved = await GradingRepository.saveSubmissionReviewTopics({
      school_id: 'school-uuid',
      submission_id: 'sub-uuid',
      student_id: 'student-uuid',
      class_id: 'class-uuid',
      subject_id: 'subject-uuid',
      source: 'lecturer',
      status: 'approved',
      reviewerId: 'reviewer-uuid',
      topics: [
        { topic_id: 'topic-1-uuid', priority: 'high', reason: 'Cần ôn kiến thức' }
      ]
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, 'new-row-uuid');

    const insertCall = executedQueries.find(q => q.sql.includes('INSERT INTO submission_review_topics'));
    assert.ok(insertCall, 'Insert query must be executed');
    // Ensure $12 is status and $14 is reviewed_at, and no CASE WHEN $12 = 'approved' ambiguity
    assert.equal(insertCall.params.length, 14);
    assert.equal(insertCall.params[11], 'approved');
    assert.ok(insertCall.params[13] instanceof Date);
    assert.ok(!insertCall.sql.includes('$12 = \'approved\''), 'SQL must not deduce $12 inconsistently');
  } finally {
    pool.query = originalQuery;
  }
});
