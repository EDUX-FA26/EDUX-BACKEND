const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret';
const semestersService = require('../src/modules/semesters/semesters.service');
const subjectsService = require('../src/modules/subjects/subjects.service');
const searchService = require('../src/modules/search/search.service');

const app = express();
app.use(express.json());
app.use('/api/semesters', require('../src/modules/semesters/semesters.routes'));
app.use('/api/subjects', require('../src/modules/subjects/subjects.routes'));
app.use('/api/search', require('../src/modules/search/search.routes'));
app.use((error, req, res, next) => res.status(error.status || 500).json({ success: false, message: error.message }));

const token = role => `Bearer ${jwt.sign({ userId: '00000000-0000-4000-8000-000000000001', role }, process.env.JWT_SECRET)}`;

test('semester routes enforce admin role and validate create payload', async () => {
  assert.equal((await request(app).post('/api/semesters').send({})).status, 401);
  assert.equal((await request(app).post('/api/semesters').set('Authorization', token('student')).send({})).status, 403);
  const invalid = await request(app).post('/api/semesters').set('Authorization', token('admin')).send({
    code: '2026-FALL', name: 'Fall', academic_year: '2026',
    start_date: '2026-12-01T00:00:00Z', end_date: '2026-09-01T00:00:00Z',
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.success, false);
});

test('semester list uses parsed pagination and exposes status transition', async () => {
  const originalList = semestersService.list;
  const originalTransition = semestersService.transition;
  try {
    semestersService.list = async filters => {
      assert.equal(filters.page, 2);
      assert.equal(filters.limit, 5);
      return { data: [], total: 0 };
    };
    semestersService.transition = async (id, action) => ({ id, action });
    const list = await request(app).get('/api/semesters?page=2&limit=5').set('Authorization', token('admin'));
    assert.equal(list.status, 200);
    assert.equal(list.body.pagination.page, 2);
    const lock = await request(app)
      .post('/api/semesters/00000000-0000-4000-8000-000000000002/lock')
      .set('Authorization', token('admin'));
    assert.equal(lock.status, 200);
    assert.equal(lock.body.data.action, 'lock');
  } finally {
    semestersService.list = originalList;
    semestersService.transition = originalTransition;
  }
});

test('subjects are admin-only and reject unknown fields', async () => {
  assert.equal((await request(app).get('/api/subjects').set('Authorization', token('lecturer'))).status, 403);
  const invalid = await request(app).post('/api/subjects').set('Authorization', token('admin'))
    .send({ code: 'DB', name: 'Database', unexpected: true });
  assert.equal(invalid.status, 400);
  const originalCreate = subjectsService.create;
  try {
    subjectsService.create = async data => data;
    const result = await request(app).post('/api/subjects').set('Authorization', token('admin'))
      .send({ code: 'DB', name: 'Database', credits: 3 });
    assert.equal(result.status, 201);
    assert.equal(result.body.data.code, 'DB');
  } finally { subjectsService.create = originalCreate; }
});

test('search requires a query and passes role, type, and pagination to service', async () => {
  assert.equal((await request(app).get('/api/search?q=database')).status, 401);
  assert.equal((await request(app).get('/api/search').set('Authorization', token('student'))).status, 400);
  assert.equal((await request(app).get('/api/search?q=x&type=unknown').set('Authorization', token('student'))).status, 400);
  const originalSearch = searchService.search;
  try {
    searchService.search = async (filters, user) => {
      assert.deepEqual(filters, { q: 'database', type: 'assignment', page: 3, limit: 20 });
      assert.equal(user.role, 'student');
      return { data: [], total: 0 };
    };
    const result = await request(app).get('/api/search?q=database&type=assignment&page=3')
      .set('Authorization', token('student'));
    assert.equal(result.status, 200);
    assert.equal(result.body.pagination.page, 3);
  } finally { searchService.search = originalSearch; }
});
