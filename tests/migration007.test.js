const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const { pool } = require('../src/config/db.config');
const { requireSchoolContext } = require('../src/middlewares/requireSchoolContext');
const adminRepository = require('../src/modules/admin/admin.repository');
const adminService = require('../src/modules/admin/admin.service');
const schoolClassesRepository = require('../src/modules/admin/admin.school-classes.repository');
const legacyAdminRepository = require('../src/modules/admin/admin.repository');
const notificationsRepository = require('../src/modules/notifications/notifications.repository');
const { createPlatformRouter } = require('../src/modules/platform/platform.routes');

const schoolId = 'f5acccd6-7ccf-4b4a-92c6-588c18691cde';
const userId = 'd458ad9a-bc91-4cd4-bf15-48ff2ada1618';
const classId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000002';

test('school context rejects missing identity, missing selection, and non-members', async () => {
  const originalQuery = pool.query;
  const app = express();
  app.use((req, res, next) => {
    if (req.get('X-Test-User')) {
      req.user = { id: req.get('X-Test-User') };
    }
    next();
  });
  app.use(requireSchoolContext);
  app.get('/', (req, res) => res.json({ tenant: req.tenant }));

  try {
    const unauthenticated = await request(app).get('/');
    assert.equal(unauthenticated.status, 401);

    const missingSchool = await request(app)
      .get('/')
      .set('X-Test-User', userId);
    assert.equal(missingSchool.status, 400);

    pool.query = async () => ({ rows: [], rowCount: 0 });
    const notMember = await request(app)
      .get('/')
      .set('X-Test-User', userId)
      .set('X-School-Id', schoolId);
    assert.equal(notMember.status, 403);

    pool.query = async () => ({
      rows: [{
        school_id: schoolId,
        user_id: userId,
        role: 'student',
        school_code: 'DEMO',
        school_name: 'Demo',
        school_slug: 'demo',
      }],
      rowCount: 1,
    });
    const member = await request(app)
      .get('/')
      .set('X-Test-User', userId)
      .set('X-School-Id', schoolId);
    assert.equal(member.status, 200);
    assert.deepEqual(member.body.tenant, {
      schoolId,
      userId,
      role: 'student',
      schoolCode: 'DEMO',
      schoolName: 'Demo',
      schoolSlug: 'demo',
    });
  } finally {
    pool.query = originalQuery;
  }
});

test('class slot updates are school-scoped, transactional, and retain old sessions', async () => {
  const originalConnect = pool.connect;
  const originalBuilder = legacyAdminRepository.buildClassSessionsSchedule;
  const statements = [];
  const client = {
    async query(sql) {
      const statement = String(sql);
      statements.push(statement);
      if (statement.includes('FROM public.schools')) {
        return { rows: [{ id: schoolId }], rowCount: 1 };
      }
      if (statement.includes('FROM public.school_memberships sm')) {
        return { rows: [{ user_id: userId }], rowCount: 1 };
      }
      if (statement.includes('FROM public.classes c')) {
        return {
          rows: [{ id: classId, schedule_text: 'old', is_locked: false }],
          rowCount: 1,
        };
      }
      if (statement.includes('FROM public.sessions')) {
        if (statement.includes('SELECT id')) {
          return { rows: [{ id: 'existing-session' }], rowCount: 1 };
        }
        return { rows: [{ id: 'existing-session', slot_number: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };

  try {
    pool.connect = async () => client;
    legacyAdminRepository.buildClassSessionsSchedule = () => ({
      scheduleText: 'updated',
      sessions: [{
        session_no: 1,
        title: 'Updated session',
        note: 'Retain dependent history',
        learning_date: '2026-09-10T02:30:00.000Z',
        slot_time: '09:30-11:45',
      }],
    });

    await schoolClassesRepository.updateSchoolClassSlots({
      schoolId,
      actorUserId: userId,
      classId,
      payload: { total_slots: 1 },
    });

    assert.ok(statements.some(sql => sql.includes('FOR UPDATE OF c, s')));
    assert.ok(statements.some(sql => sql.includes('WHERE school_id = $1')));
    assert.ok(statements.some(sql => sql.includes('UPDATE public.sessions')));
    assert.ok(!statements.some(sql => /\bDELETE\s+FROM\s+public\.sessions/i.test(sql)));
    assert.ok(statements.includes('COMMIT'));
  } finally {
    pool.connect = originalConnect;
    legacyAdminRepository.buildClassSessionsSchedule = originalBuilder;
  }
});

test('class removal is a school-scoped soft remove', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      const statement = String(sql);
      statements.push(statement);
      if (
        statement.includes('FROM public.schools') ||
        statement.includes('FROM public.school_memberships sm')
      ) {
        return { rows: [{ id: schoolId }], rowCount: 1 };
      }
      if (statement.includes('UPDATE public.class_members')) {
        return { rows: [{ id: 'class-member' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };

  try {
    pool.connect = async () => client;
    const removed = await schoolClassesRepository.removeSchoolClassStudent({
      schoolId,
      actorUserId: userId,
      classId,
      studentId,
    });

    assert.equal(removed.status, 'dropped');
    assert.ok(statements.some(sql => sql.includes("SET status = 'dropped'")));
    assert.ok(statements.some(sql => sql.includes('WHERE school_id = $1')));
    assert.ok(!statements.some(sql => /\bDELETE\s+FROM\s+public\.class_members/i.test(sql)));
  } finally {
    pool.connect = originalConnect;
  }
});

test('adding a class member requires an active student membership and prevents duplicates', async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      const statement = String(sql);
      statements.push(statement);
      if (statement.includes('FROM public.schools')) {
        return { rows: [{ id: schoolId }], rowCount: 1 };
      }
      if (
        statement.includes('FROM public.school_memberships sm') &&
        statement.includes("sm.role = 'school_admin'")
      ) {
        return { rows: [{ user_id: userId }], rowCount: 1 };
      }
      if (
        statement.includes('FROM public.school_memberships sm') &&
        statement.includes("sm.role = 'student'")
      ) {
        return {
          rows: [{
            id: studentId,
            email: 'student@example.test',
            full_name: 'Student',
            student_code: 'S-1',
          }],
          rowCount: 1,
        };
      }
      if (statement.includes('FROM public.classes')) {
        return {
          rows: [{ id: classId, max_students: 1, is_active: true }],
          rowCount: 1,
        };
      }
      if (
        statement.includes('FROM public.class_members') &&
        statement.includes('SELECT id, status')
      ) {
        return { rows: [{ id: 'existing-member', status: 'active' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };

  try {
    pool.connect = async () => client;
    await assert.rejects(
      schoolClassesRepository.addSchoolClassStudent({
        schoolId,
        actorUserId: userId,
        classId,
        payload: { student_id: studentId },
      }),
      error => error.status === 409
    );

    assert.ok(statements.some(sql => sql.includes("sm.role = 'student'")));
    assert.ok(statements.some(sql => sql.includes("sm.status = 'active'")));
    assert.ok(statements.some(sql => sql.includes('WHERE school_id = $1')));
    assert.ok(!statements.some(sql => /INSERT INTO public\.class_members/i.test(sql)));
  } finally {
    pool.connect = originalConnect;
  }
});

test('school broadcasts target active memberships and persist the school scope', async () => {
  const originalFind = adminRepository.findUserIdsBySchoolTarget;
  const originalBulkCreate = notificationsRepository.bulkCreate;
  let receivedNotifications;

  try {
    adminRepository.findUserIdsBySchoolTarget = async (targetSchoolId, target) => {
      assert.equal(targetSchoolId, schoolId);
      assert.equal(target, 'student');
      return [studentId];
    };
    notificationsRepository.bulkCreate = async notifications => {
      receivedNotifications = notifications;
      return [];
    };

    const result = await adminService.broadcastNotification({
      title: 'Notice',
      message: 'For current school only',
      target: 'student',
    }, {
      schoolId,
      userId,
      role: 'school_admin',
    });

    assert.equal(result.count, 0);
    assert.equal(receivedNotifications.length, 1);
    assert.equal(receivedNotifications[0].notification_scope, 'school');
    assert.equal(receivedNotifications[0].school_id, schoolId);

    await assert.rejects(
      adminService.broadcastNotification(
        { title: 'Notice', message: 'Denied', target: 'all' },
        { schoolId, userId, role: 'student' }
      ),
      error => error.status === 403
    );
  } finally {
    adminRepository.findUserIdsBySchoolTarget = originalFind;
    notificationsRepository.bulkCreate = originalBulkCreate;
  }
});

test('a legacy admin role alone cannot access the platform broadcast endpoint', async () => {
  const originalQuery = pool.query;
  const app = express();
  app.use(express.json());
  app.use('/api/platform', createPlatformRouter({
    authenticate(req, res, next) {
      req.user = { id: userId, role: 'admin' };
      next();
    },
  }));

  try {
    pool.query = async () => ({ rows: [], rowCount: 0 });
    const response = await request(app)
      .post('/api/platform/notifications/broadcast')
      .send({
        title: 'Platform notice',
        message: 'Should not be accepted',
        target: 'all',
      });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'PLATFORM_ACCESS_DENIED');
  } finally {
    pool.query = originalQuery;
  }
});

test('notification reads include only the selected school scope', async () => {
  const originalQuery = pool.query;
  const statements = [];

  try {
    pool.query = async (sql, params) => {
      statements.push({ sql: String(sql), params });
      if (String(sql).includes('COUNT(*)')) {
        return { rows: [{ count: '1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };

    await notificationsRepository.findByUserId({
      userId,
      schoolId,
      page: 1,
      limit: 20,
    });

    assert.equal(statements.length, 2);
    for (const statement of statements) {
      assert.match(statement.sql, /notification_scope = 'school' AND school_id = \$2/);
      assert.deepEqual(statement.params.slice(0, 2), [userId, schoolId]);
    }
  } finally {
    pool.query = originalQuery;
  }
});
