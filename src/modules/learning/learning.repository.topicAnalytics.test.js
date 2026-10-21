jest.mock('../../config/db.config', () => ({ pool: { query: jest.fn() } }));
const { pool } = require('../../config/db.config');
const repo = require('./learning.repository');

describe('topic analytics evidence query', () => {
  beforeEach(() => { pool.query.mockReset(); pool.query.mockResolvedValue({ rows: [] }); });
  test('excludes non-submitted tests, essay cards, inactive data, and non-approved mappings', async () => {
    await repo.findSubmittedMultipleChoiceTopicAnswers('student-1', 'subject-1');
    const [sql, values] = pool.query.mock.calls[0];
    expect(values).toEqual(['student-1', 'subject-1']);
    expect(sql).toContain("ft.status = 'submitted'");
    expect(sql).toContain("fc.type = 'multiple_choice'");
    expect(sql).toContain('fc.is_active = true');
    expect(sql).toContain('fd.is_active = true');
    expect(sql).toContain("fct.review_status = 'approved'");
    expect(sql).toContain('t.is_active = true');
  });
});
