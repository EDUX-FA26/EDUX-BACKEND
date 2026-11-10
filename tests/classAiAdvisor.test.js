require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const { pool } = require('../src/config/db.config');
const ClassAiAdvisorService = require('../src/modules/classes/classAiAdvisor.service');
const ClassAiAdvisorRepository = require('../src/modules/classes/classAiAdvisor.repository');
const ClassesService = require('../src/modules/classes/classes.service');

const app = express();
app.use(express.json());
app.use('/api/classes', require('../src/modules/classes/classes.routes'));
app.use((error, req, res, next) => res.status(error.status || error.statusCode || 500).json({ success: false, message: error.message }));

const token = (role, id = '00000000-0000-4000-8000-000000000001') =>
  `Bearer ${jwt.sign({ userId: id, id, role }, process.env.JWT_SECRET)}`;

test('AI Class Advisor: routes enforce authentication and lecturer/admin authorization', async () => {
  const classId = '58c73f29-367f-4bb2-aed3-7799ef1e0be4';

  // 1. Unauthenticated -> 401
  const unauthGet = await request(app).get(`/api/classes/${classId}/ai-advisor`);
  assert.equal(unauthGet.status, 401);

  const unauthRefresh = await request(app).post(`/api/classes/${classId}/ai-advisor/refresh`);
  assert.equal(unauthRefresh.status, 401);

  // 2. Student role -> 403 Forbidden
  const studentGet = await request(app)
    .get(`/api/classes/${classId}/ai-advisor`)
    .set('Authorization', token('student'));
  assert.equal(studentGet.status, 403);

  const studentRefresh = await request(app)
    .post(`/api/classes/${classId}/ai-advisor/refresh`)
    .set('Authorization', token('student'));
  assert.equal(studentRefresh.status, 403);
});

test('AI Class Advisor: GET /api/classes/:classId/ai-advisor returns valid payload structure with latest flag and history', async () => {
  const classId = '58c73f29-367f-4bb2-aed3-7799ef1e0be4';

  const res = await request(app)
    .get(`/api/classes/${classId}/ai-advisor`)
    .set('Authorization', token('admin'));

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.has_data, true);
  assert.ok(Array.isArray(res.body.advisories));
  assert.ok(res.body.advisories.length >= 1);

  // Mặc định: advisories[0] là is_latest = true
  const latest = res.body.advisories[0];
  assert.equal(latest.is_latest, true);
  assert.equal(res.body.latest_advisory_id, latest.id);
  assert.ok(latest.assignment_title);
  assert.ok(latest.class_overview);
  assert.ok(typeof latest.class_overview.submission_rate_text === 'string');
  assert.ok(typeof latest.class_overview.avg_ai_transparency === 'string');
  assert.ok(Array.isArray(latest.common_error_clusters));
  assert.ok(typeof latest.next_slot_recommendation === 'string');

  // Các bản ghi lịch sử tiếp theo nếu có phải có is_latest = false
  if (res.body.advisories.length > 1) {
    const previous = res.body.advisories[1];
    assert.equal(previous.is_latest, false);
  }
});

test('AI Class Advisor: POST /api/classes/:classId/ai-advisor/refresh updates latest advisory', async () => {
  const classId = '58c73f29-367f-4bb2-aed3-7799ef1e0be4';

  const res = await request(app)
    .post(`/api/classes/${classId}/ai-advisor/refresh`)
    .set('Authorization', token('admin'));

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.has_data, true);
  assert.ok(Array.isArray(res.body.advisories));
  assert.equal(res.body.advisories[0].is_latest, true);
});

test('AI Class Advisor: Database isolation between different classes', async () => {
  // Lấy dữ liệu cho 2 lớp khác nhau
  const classA = '58c73f29-367f-4bb2-aed3-7799ef1e0be4';
  const classB = 'd787f53b-970b-472c-930a-71059be2432b';

  const resA = await request(app)
    .get(`/api/classes/${classA}/ai-advisor`)
    .set('Authorization', token('admin'));

  const resB = await request(app)
    .get(`/api/classes/${classB}/ai-advisor`)
    .set('Authorization', token('admin'));

  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);

  // Bản ghi của classA và classB phải độc lập
  const idsA = new Set(resA.body.advisories.map((a) => a.id));
  const idsB = new Set(resB.body.advisories.map((b) => b.id));

  for (const id of idsA) {
    assert.ok(!idsB.has(id), 'Advisories between classes must be strictly isolated');
  }

  await pool.end();
});
