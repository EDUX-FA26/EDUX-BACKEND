const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const request = require('supertest');
const jwt = require('jsonwebtoken');

if (!process.env.TEST_DB_PASSWORD) {
  test('module integration tests require TEST_DB_PASSWORD for local PostgreSQL', { skip: true }, () => {});
} else {
  process.env.JWT_SECRET = 'module-integration-test-secret';
  process.env.CLIENT_URL = 'http://localhost:5173';

  const adminPool = new Pool({
    host: '127.0.0.1', port: 5433, user: 'postgres',
    password: process.env.TEST_DB_PASSWORD, database: 'myapp_db', ssl: false,
  });
  const schema = `edux_modules_test_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const db = require('../src/config/db.config');
  let testPool;

  const adminId = randomUUID();
  const lecturerId = randomUUID();
  const studentId = randomUUID();
  const outsiderId = randomUUID();
  const auth = (role, userId) => `Bearer ${jwt.sign({ userId, role }, process.env.JWT_SECRET)}`;
  const adminAuth = auth('admin', adminId);
  const lecturerAuth = auth('lecturer', lecturerId);
  const studentAuth = auth('student', studentId);
  const outsiderAuth = auth('student', outsiderId);

  test('all Semesters, Subjects and Search endpoints against isolated PostgreSQL schema', async () => {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    testPool = new Pool({
      host: '127.0.0.1', port: 5433, user: 'postgres',
      password: process.env.TEST_DB_PASSWORD, database: 'myapp_db', ssl: false,
      options: `-c search_path=${schema}`,
    });
    db.pool.query = testPool.query.bind(testPool);
    db.pool.connect = testPool.connect.bind(testPool);
    try {
      await testPool.query(`
        CREATE TABLE semesters (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(100) UNIQUE NOT NULL,
          name varchar(255) NOT NULL, academic_year varchar(100) NOT NULL,
          start_date timestamptz NOT NULL, end_date timestamptz NOT NULL,
          is_current boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
          is_locked boolean NOT NULL DEFAULT false,
          created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
        );
        CREATE UNIQUE INDEX semesters_one_current_idx ON semesters (is_current) WHERE is_current = true;
        CREATE TABLE departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(255) NOT NULL);
        CREATE TABLE subjects (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code varchar(100) UNIQUE NOT NULL,
          name varchar(255) NOT NULL, description text DEFAULT '',
          department_id uuid REFERENCES departments(id), credits int DEFAULT 0 CHECK (credits >= 0),
          is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
        );
        CREATE TABLE classes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_code varchar(100) NOT NULL,
          semester_id uuid REFERENCES semesters(id), subject_id uuid REFERENCES subjects(id),
          lecturer_id uuid NOT NULL, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now()
        );
        CREATE TABLE class_members (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid REFERENCES classes(id),
          student_id uuid NOT NULL, status varchar(50) DEFAULT 'active'
        );
        CREATE TABLE assignments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid REFERENCES classes(id),
          title varchar(255), description text, publish_status varchar(50), created_at timestamptz DEFAULT now()
        );
        CREATE TABLE class_materials (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid REFERENCES classes(id),
          title varchar(255), description text, file_name varchar(255), created_at timestamptz DEFAULT now()
        );
        CREATE TABLE flashcard_decks (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), class_id uuid REFERENCES classes(id),
          subject_id uuid REFERENCES subjects(id), created_by uuid NOT NULL,
          title varchar(255), description text, is_public boolean DEFAULT false,
          is_active boolean DEFAULT true, created_at timestamptz DEFAULT now()
        );
      `);

      const app = require('../src/app');
      const call = (method, path, bearer, body) => {
        let req = request(app)[method](path).set('Authorization', bearer);
        if (body !== undefined) req = req.send(body);
        return req;
      };

      const semesterInput = (code, name) => ({
        code, name, academic_year: '2026-2027',
        start_date: '2026-09-01T00:00:00Z', end_date: '2027-01-31T00:00:00Z',
      });
      const first = await call('post', '/api/semesters', adminAuth, semesterInput('2026-FALL', 'Fall 2026'));
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const second = await call('post', '/api/semesters', adminAuth, semesterInput('2027-SPRING', 'Spring 2027'));
      assert.equal(second.status, 201, JSON.stringify(second.body));
      const firstId = first.body.data.id;
      const secondId = second.body.data.id;
      assert.equal((await call('get', '/api/semesters', adminAuth)).body.total, 2);
      assert.equal((await call('get', `/api/semesters/${firstId}`, adminAuth)).body.data.code, '2026-FALL');
      assert.equal((await call('patch', `/api/semesters/${firstId}`, adminAuth, { name: 'Autumn 2026' })).body.data.name, 'Autumn 2026');
      assert.equal((await call('post', `/api/semesters/${firstId}/activate`, adminAuth)).body.data.is_current, true);
      assert.equal((await call('post', `/api/semesters/${secondId}/activate`, adminAuth)).body.data.is_current, true);
      assert.equal((await call('get', `/api/semesters/${firstId}`, adminAuth)).body.data.is_current, false);
      assert.equal((await call('post', `/api/semesters/${secondId}/close`, adminAuth)).body.data.is_active, false);
      assert.equal((await call('post', `/api/semesters/${secondId}/lock`, adminAuth)).body.data.is_locked, true);
      assert.equal((await call('patch', `/api/semesters/${secondId}`, adminAuth, { name: 'Cannot edit' })).status, 409);
      assert.equal((await call('post', `/api/semesters/${secondId}/activate`, adminAuth)).status, 409);
      assert.equal((await call('get', '/api/semesters', studentAuth)).status, 403);

      const subject = await call('post', '/api/subjects', adminAuth, { code: 'DB', name: 'Database', credits: 3 });
      assert.equal(subject.status, 201, JSON.stringify(subject.body));
      const subjectId = subject.body.data.id;
      const removeSubject = await call('post', '/api/subjects', adminAuth, { code: 'TMP', name: 'Temporary' });
      assert.equal(removeSubject.status, 201);
      assert.equal((await call('get', '/api/subjects', adminAuth)).body.total, 2);
      assert.equal((await call('get', `/api/subjects/${subjectId}`, adminAuth)).body.data.name, 'Database');
      assert.equal((await call('patch', `/api/subjects/${subjectId}`, adminAuth, { credits: 4 })).body.data.credits, 4);
      assert.equal((await call('delete', `/api/subjects/${removeSubject.body.data.id}`, adminAuth)).body.data.is_active, false);
      assert.equal((await call('get', '/api/subjects', adminAuth)).body.total, 1);
      assert.equal((await call('post', '/api/subjects', lecturerAuth, { code: 'NO', name: 'No access' })).status, 403);

      const classId = randomUUID();
      await testPool.query(
        'INSERT INTO classes (id, class_code, semester_id, subject_id, lecturer_id) VALUES ($1, $2, $3, $4, $5)',
        [classId, 'DATABASE-101', firstId, subjectId, lecturerId]
      );
      await testPool.query('INSERT INTO class_members (class_id, student_id) VALUES ($1, $2)', [classId, studentId]);
      await testPool.query('INSERT INTO assignments (class_id, title, description, publish_status) VALUES ($1, $2, $3, $4), ($1, $5, $3, $6)',
        [classId, 'Database published assignment', 'database', 'published', 'Database draft assignment', 'draft']);
      await testPool.query('INSERT INTO class_materials (class_id, title, description, file_name) VALUES ($1, $2, $3, $4)',
        [classId, 'Database material', 'database', 'database.pdf']);
      await testPool.query('INSERT INTO flashcard_decks (class_id, subject_id, created_by, title, description, is_public) VALUES ($1, $2, $3, $4, $5, true), ($1, $2, $3, $6, $5, false)',
        [classId, subjectId, lecturerId, 'Database public deck', 'database', 'Database private deck']);

      assert.equal((await call('get', '/api/search?q=database', studentAuth)).body.total, 5);
      assert.equal((await call('get', '/api/search?q=database&type=assignment', studentAuth)).body.total, 1);
      assert.equal((await call('get', '/api/search?q=database&type=assignment', lecturerAuth)).body.total, 2);
      assert.equal((await call('get', '/api/search?q=database', outsiderAuth)).body.total, 1);
      assert.equal((await call('get', '/api/search?q=database', adminAuth)).body.total, 6);
      const paged = await call('get', '/api/search?q=database&page=2&limit=2', studentAuth);
      assert.equal(paged.status, 200);
      assert.equal(paged.body.data.length, 2);
      assert.equal(paged.body.pagination.total, 5);
    } finally {
      if (testPool) await testPool.end();
      await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await adminPool.end();
    }
  });
}
