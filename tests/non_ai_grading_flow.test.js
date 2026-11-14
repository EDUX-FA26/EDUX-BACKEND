const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAiSpecificCriterion,
  filterAndRescaleRubricsForNonAi,
  buildDynamicGradingSystemInstruction,
  applyScoringGuardrails,
  generatePedagogicalFallbackResult,
} = require('../src/config/gemini.config');

test('isAiSpecificCriterion: correctly identifies AI-specific criteria vs pure technical criteria', () => {
  // AI-specific criteria
  assert.equal(isAiSpecificCriterion({ criterion_key: 'AI_INTERACTION' }), true);
  assert.equal(isAiSpecificCriterion({ criterion_key: 'METACOGNITIVE_REFLECTION' }), true);
  assert.equal(isAiSpecificCriterion({ criterion_key: 'AI_USAGE' }), true);
  assert.equal(isAiSpecificCriterion({ criterion_key: 'AI_AUDIT_LOG' }), true);
  assert.equal(isAiSpecificCriterion({ criterion_name: 'AI Interaction & Prompt Engineering' }), true);
  assert.equal(isAiSpecificCriterion({ criterion_name: 'Khai báo AI Audit Log' }), true);
  assert.equal(isAiSpecificCriterion({ criterion_name: 'Critical Evaluation of AI' }), true);

  // Technical criteria should NOT be marked as AI-specific
  assert.equal(isAiSpecificCriterion({ criterion_key: 'PROBLEM_ABSTRACTION', criterion_name: 'Problem Abstraction & Solution Design' }), false);
  assert.equal(isAiSpecificCriterion({ criterion_key: 'IMPLEMENTATION_QUALITY', criterion_name: 'Implementation & Code Quality' }), false);
  assert.equal(isAiSpecificCriterion({ criterion_key: 'CRITICAL_EVALUATION', criterion_name: 'Critical Evaluation & Verification' }), false);
  assert.equal(isAiSpecificCriterion({ criterion_key: 'DECOMPOSITION', criterion_name: 'Phân rã bài toán' }), false);
  assert.equal(isAiSpecificCriterion({ criterion_key: 'PATTERN_RECOGNITION', criterion_name: 'Kiến trúc & Mẫu thiết kế' }), false);
});

test('filterAndRescaleRubricsForNonAi: removes AI criteria and rescales technical rubrics to 100% and 10.0 max score', () => {
  const originalRubrics = [
    { criterion_key: 'PROBLEM_ABSTRACTION', criterion_name: 'Problem Abstraction & Solution Design', weight_percent: 20, is_enabled: true },
    { criterion_key: 'IMPLEMENTATION_QUALITY', criterion_name: 'Implementation & Code Quality', weight_percent: 30, is_enabled: true },
    { criterion_key: 'CRITICAL_EVALUATION', criterion_name: 'Critical Evaluation & Verification', weight_percent: 25, is_enabled: true },
    { criterion_key: 'AI_INTERACTION', criterion_name: 'AI Interaction & Prompt Engineering', weight_percent: 15, is_enabled: true },
    { criterion_key: 'METACOGNITIVE_REFLECTION', criterion_name: 'Metacognitive Reflection & Transparency', weight_percent: 10, is_enabled: true },
  ];

  const rescaled = filterAndRescaleRubricsForNonAi(originalRubrics);

  // AI criteria removed
  assert.equal(rescaled.length, 3);
  assert.ok(!rescaled.some((r) => r.criterion_key === 'AI_INTERACTION'));
  assert.ok(!rescaled.some((r) => r.criterion_key === 'METACOGNITIVE_REFLECTION'));

  // Sum of weights is exactly 100%
  const totalWeight = rescaled.reduce((acc, r) => acc + r.weight_percent, 0);
  assert.equal(Math.round(totalWeight), 100);

  // Sum of max_score is exactly 10.0
  const totalMaxScore = rescaled.reduce((acc, r) => acc + r.max_score, 0);
  assert.equal(Number(totalMaxScore.toFixed(1)), 10.0);
});

test('buildDynamicGradingSystemInstruction: strictly forbids deducting points for missing AI logs when aiDeclarationRequired = false', () => {
  const rubrics = [
    { index: 1, criterion_key: 'PROBLEM_ABSTRACTION', criteria_name: 'Problem Abstraction', weight_percent: 30, max_score: 3.0 },
    { index: 2, criterion_key: 'IMPLEMENTATION_QUALITY', criteria_name: 'Implementation Quality', weight_percent: 40, max_score: 4.0 },
    { index: 3, criterion_key: 'CRITICAL_EVALUATION', criteria_name: 'Critical Evaluation', weight_percent: 30, max_score: 3.0 },
  ];

  const instruction = buildDynamicGradingSystemInstruction(rubrics, false);

  assert.ok(instruction.includes('KHÔNG YÊU CẦU KHAI BÁO AI AUDIT LOG'));
  assert.ok(instruction.includes('TUYỆT ĐỐI KHÔNG ĐƯỢC NHẮC ĐẾN, KHÔNG ĐƯỢC TRỪ ĐIỂM'));
  assert.ok(instruction.includes('chất lượng code thực tế'));
});

test('applyScoringGuardrails: ensures clean audit_integrity without penalties when aiDeclarationRequired = false', () => {
  const rubrics = [
    { criterion_key: 'PROBLEM_ABSTRACTION', criteria_name: 'Problem Abstraction', weight_percent: 30, max_score: 3.0 },
    { criterion_key: 'IMPLEMENTATION_QUALITY', criteria_name: 'Implementation Quality', weight_percent: 40, max_score: 4.0 },
    { criterion_key: 'CRITICAL_EVALUATION', criteria_name: 'Critical Evaluation', weight_percent: 30, max_score: 3.0 },
  ];

  const mockAiResult = {
    grading_breakdown: [
      { criterion_key: 'PROBLEM_ABSTRACTION', awarded_score: 2.7, comment: 'Thiết kế tốt' },
      { criterion_key: 'IMPLEMENTATION_QUALITY', awarded_score: 3.5, comment: 'Code sạch sẽ' },
      { criterion_key: 'CRITICAL_EVALUATION', awarded_score: 2.6, comment: 'Kiểm thử đầy đủ' },
    ],
  };

  const guarded = applyScoringGuardrails(mockAiResult, rubrics, false);

  assert.equal(guarded.total_score_10, 8.8);
  assert.equal(guarded.audit_integrity.penalty_applied, false);
  assert.equal(guarded.audit_integrity.risk_level, 'LOW_RISK');
  assert.ok(guarded.audit_integrity.penalty_reason.includes('Bài tập không yêu cầu khai báo AI Audit Log'));
  assert.ok(guarded.overall_verdict.includes('tiêu chí Rubric chuyên môn'));
});

test('generatePedagogicalFallbackResult: generates pure technical fallback result when aiDeclarationRequired = false', () => {
  const fallback = generatePedagogicalFallbackResult({
    assignmentInfo: 'Xây dựng đơn hàng Spring Boot',
    sourceCode: 'class OrderService {}',
    aiDeclarationRequired: false,
  });

  assert.equal(fallback.grading_breakdown.length, 3);
  assert.equal(fallback.audit_integrity.penalty_applied, false);
  assert.equal(fallback.risk_level, 'low');
  assert.ok(fallback.viva_questions.length > 0);
  assert.ok(fallback.viva_questions.every((q) => !q.question.toLowerCase().includes('khai báo ai')));
});

