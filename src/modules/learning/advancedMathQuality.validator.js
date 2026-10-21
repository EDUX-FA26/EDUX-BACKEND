
const math = require('mathjs');

function fail(code) {
  const error = new Error(code);
  error.status = 502;
  throw error;
}

const SAMPLE_POINTS = [
  -3.1, -2.3, -1.2, -0.7,
  0.25, 0.6, 1.4, 2.1, 3.2, 4.4
];

const ALLOWED_NAMES = new Set([
  'x', 'pi', 'e',
  'sin', 'cos', 'tan',
  'exp', 'log', 'sqrt', 'abs'
]);

function compileSafe(expression) {
  if (
    typeof expression !== 'string' ||
    !expression.trim() ||
    expression.length > 160
  ) {
    fail('AI_MATH_INVALID_EXPRESSION');
  }

  const normalized = expression
    .replace(/\bln\s*\(/gi, 'log(')
    .trim();

  if (!/^[0-9a-zA-Z+\-*/^().,\s]+$/.test(normalized)) {
    fail('AI_MATH_INVALID_EXPRESSION');
  }

  const names = normalized.match(/[a-zA-Z]+/g) || [];

  if (names.some(name => !ALLOWED_NAMES.has(name))) {
    fail('AI_MATH_UNSUPPORTED_EXPRESSION');
  }

  try {
    return math.compile(normalized);
  } catch {
    fail('AI_MATH_INVALID_EXPRESSION');
  }
}

function evaluate(compiled, x) {
  try {
    const result = compiled.evaluate({ x });
    return typeof result === 'number' &&
      Number.isFinite(result)
      ? result
      : null;
  } catch {
    return null;
  }
}

function closeEnough(a, b, tolerance = 1e-5) {
  return Math.abs(a - b) <=
    tolerance * (1 + Math.abs(a) + Math.abs(b));
}

// So sánh hai biểu thức tại nhiều điểm hợp lệ.
function equivalentExpressions(first, second) {
  let checked = 0;

  for (const x of SAMPLE_POINTS) {
    const a = evaluate(first, x);
    const b = evaluate(second, x);

    if (a === null || b === null) continue;

    checked++;

    if (!closeEnough(a, b)) {
      return false;
    }
  }

  if (checked < 5) {
    fail('AI_MATH_INSUFFICIENT_VERIFICATION');
  }

  return true;
}

function compileDerivative(expression) {
  try {
    const normalized = expression
      .replace(/\bln\s*\(/gi, 'log(');

    // Kiểm tra biểu thức đầu vào trước.
    compileSafe(normalized);

    return math.derivative(normalized, 'x').compile();
  } catch (error) {
    if (error.message?.startsWith('AI_MATH_')) {
      throw error;
    }

    fail('AI_MATH_DERIVATIVE_FAILED');
  }
}

function cleanAntiderivative(expression) {
  // Loại hằng số tích phân + C hoặc - C
  return String(expression)
    .replace(/\s*[+-]\s*C\s*$/i, '')
    .trim();
}

function checkDerivativeOrIntegral(item, check) {
  const original = compileSafe(check.expression);

  const expected = check.kind === 'derivative'
    ? compileDerivative(check.expression)
    : original;

  const correctKeys = [];

  for (const option of item.options) {
    const text = check.kind === 'antiderivative'
      ? cleanAntiderivative(option.text)
      : option.text;

    const candidate = check.kind === 'derivative'
      ? compileSafe(text)
      : compileDerivative(text);

    if (equivalentExpressions(expected, candidate)) {
      correctKeys.push(option.key);
    }
  }

  return correctKeys;
}

function readFiniteValue(expression) {
  const compiled = compileSafe(expression);
  const value = evaluate(compiled, 0);

  if (value === null) {
    fail('AI_MATH_INVALID_LIMIT_OPTION');
  }

  return value;
}

function checkFiniteLimit(item, check) {
  if (
    typeof check.at !== 'number' ||
    !Number.isFinite(check.at) ||
    Math.abs(check.at) > 1000
  ) {
    fail('AI_MATH_UNSUPPORTED_LIMIT');
  }

  const side = check.side || 'both';

  if (!['both', 'left', 'right'].includes(side)) {
    fail('AI_MATH_UNSUPPORTED_LIMIT');
  }

  const expression = compileSafe(check.expression);

  const directions = side === 'both'
    ? [-1, 1]
    : side === 'left' ? [-1] : [1];

  const scale = Math.max(1, Math.abs(check.at));
  const correctKeys = [];

  for (const option of item.options) {
    // Bản MVP chỉ xác minh giới hạn hữu hạn.
    const target = readFiniteValue(option.text);
    let matches = true;

    for (const direction of directions) {
      const samples = [1e-3, 1e-4, 1e-5, 1e-6]
        .map(h => evaluate(
          expression,
          check.at + direction * h * scale
        ));

      if (samples.some(value => value === null)) {
        fail('AI_MATH_LIMIT_NOT_VERIFIABLE');
      }

      const last = samples[samples.length - 1];
      const previous = samples[samples.length - 2];

      // Kiểm tra xu hướng hội tụ và đáp án.
      const tolerance = 0.0005 *
        (1 + Math.abs(target));

      if (
        Math.abs(last - previous) > tolerance ||
        Math.abs(last - target) > tolerance
      ) {
        matches = false;
      }
    }

    if (matches) correctKeys.push(option.key);
  }

  return correctKeys;
}

function detectKind(question) {
  const text = String(question).toLowerCase();

  if (text.includes('đạo hàm')) {
    return 'derivative';
  }

  if (
    text.includes('nguyên hàm') ||
    text.includes('tích phân bất định')
  ) {
    return 'antiderivative';
  }

  if (
    text.includes('giới hạn') ||
    /\blim\b/.test(text)
  ) {
    return 'limit';
  }

  return null;
}

function checkAdvancedMathQuestion(item) {
  const detected = detectKind(item.question);

  // Không thuộc Toán cao cấp được hỗ trợ.
  if (!detected && !item.mathCheck) {
    return;
  }

  const check = item.mathCheck;

  if (
    !check ||
    check.kind !== detected ||
    typeof check.expression !== 'string' ||
    !Array.isArray(item.options) ||
    item.options.length !== 4
  ) {
    fail('AI_MATH_METADATA_REQUIRED');
  }

  let correctKeys;

  if (
    check.kind === 'derivative' ||
    check.kind === 'antiderivative'
  ) {
    correctKeys = checkDerivativeOrIntegral(item, check);

  } else if (check.kind === 'limit') {
    correctKeys = checkFiniteLimit(item, check);

  } else {
    fail('AI_MATH_UNSUPPORTED_TYPE');
  }

  if (correctKeys.length !== 1) {
    fail('AI_MULTIPLE_OR_NO_CORRECT_OPTIONS');
  }

  if (correctKeys[0] !== item.answer) {
    fail('AI_WRONG_CORRECT_OPTION');
  }
}

module.exports = {
  checkAdvancedMathQuestion
};
