require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// 1. Verify AssignmentRepository column order & mapping
test('AssignmentRepository.create: columns and values alignment', () => {
  const repoContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/assignments/assignment.repository.js'),
    'utf-8'
  );

  // Check columns list includes school_id
  assert.match(
    repoContent,
    /id,\s*uuid,\s*school_id,\s*class_id,\s*slot_id,\s*session_id/i,
    'Columns list must include school_id right after uuid'
  );

  // Check 19 placeholders ($1 to $19)
  assert.match(
    repoContent,
    /\$1,\s*\$2,\s*\$3,\s*\$4,\s*\$5,\s*\$6,\s*\$7,\s*\$8,\s*\$9,\s*\$10,\s*\$11,\s*\$12,\s*\$13,\s*\$14,\s*\$15,\s*\$16,\s*\$17,\s*\$18,\s*\$19/i,
    'Values placeholders must have exactly 19 elements'
  );

  // Check data.school_id is mapped as the third element (matching $3)
  assert.match(
    repoContent,
    /const\s+values\s*=\s*\[\s*data\.id,\s*data\.uuid,\s*data\.school_id,\s*data\.class_id/i,
    'data.school_id must be mapped to $3'
  );
});

// 2. Verify AssignmentRepository.findMany tenant parameter
test('AssignmentRepository.findMany: accepts tenant parameter', () => {
  const repoContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/assignments/assignment.repository.js'),
    'utf-8'
  );

  assert.match(
    repoContent,
    /async\s+findMany\s*\([^)]*,\s*tenant\s*\)/i,
    'findMany must accept tenant parameter'
  );
  assert.doesNotMatch(
    repoContent,
    /async\s+findMany\s*\([^)]*,\s*user\s*\)/i,
    'findMany must not have user parameter'
  );
});

// 3. Verify AssignmentRepository.deleteAssignmentWithRelations school scoping
test('AssignmentRepository.deleteAssignmentWithRelations: scopes by schoolId', () => {
  const repoContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/assignments/assignment.repository.js'),
    'utf-8'
  );

  assert.match(
    repoContent,
    /deleteAssignmentWithRelations\s*\(\s*id,\s*schoolId/i,
    'deleteAssignmentWithRelations must accept schoolId'
  );
  assert.match(
    repoContent,
    /DELETE\s+FROM\s+assignments\s+WHERE\s+id\s*=\s*\$1\s+AND\s+school_id\s*=\s*\$2/i,
    'DELETE assignments must enforce school_id'
  );
  assert.match(
    repoContent,
    /DELETE\s+FROM\s+submissions\s+WHERE\s+assignment_id\s*=\s*\$1\s+AND\s+school_id\s*=\s*\$2/i,
    'DELETE submissions must enforce school_id'
  );
});

// 4. Verify AssignmentService fixes
test('AssignmentService: update, delete, getById use tenant context correctly', () => {
  const serviceContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/assignments/assignment.service.js'),
    'utf-8'
  );

  // updateAssignment calls update(id, actualTenant.schoolId, updatePayload)
  assert.match(
    serviceContent,
    /AssignmentRepository\.update\(\s*id\s*,\s*actualTenant\.schoolId\s*,\s*updatePayload\s*\)/i,
    'updateAssignment must pass id, actualTenant.schoolId, updatePayload'
  );

  // deleteAssignment signature and call
  assert.match(
    serviceContent,
    /async\s+deleteAssignment\s*\(\s*id\s*,\s*tenant\s*,/i,
    'deleteAssignment must accept tenant'
  );
  assert.match(
    serviceContent,
    /AssignmentRepository\.deleteAssignmentWithRelations\(\s*id\s*,\s*tenant\.schoolId\s*,/i,
    'deleteAssignment must pass tenant.schoolId to deleteAssignmentWithRelations'
  );

  // getAssignmentById checks tenant.role
  assert.match(
    serviceContent,
    /if\s*\(\s*tenant\.role\s*===\s*['"]student['"]\s*\)/i,
    'getAssignmentById must check tenant.role === student'
  );
  assert.doesNotMatch(
    serviceContent,
    /if\s*\(\s*user\.role\s*===\s*['"]student['"]\s*\)/i,
    'getAssignmentById must not reference user'
  );
});

// 5. Verify AssignmentController.deleteAssignment passes req.tenant
test('AssignmentController.deleteAssignment: passes req.tenant', () => {
  const controllerContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/assignments/assignment.controller.js'),
    'utf-8'
  );

  assert.match(
    controllerContent,
    /AssignmentService\.deleteAssignment\(\s*id\s*,\s*req\.tenant\s*,\s*\{\s*force\s*\}\s*\)/i,
    'deleteAssignment must pass req.tenant'
  );
});

// 6. Verify Frontend assignment.service.js duplicate delete removal
test('FE AssignmentService: has single deleteAssignment method with schoolScoped: true', () => {
  const feContent = fs.readFileSync(
    path.join(__dirname, '../../FE/src/services/assignment.service.js'),
    'utf-8'
  );

  const deleteMatches = feContent.match(/async\s+deleteAssignment\s*\(/g);
  assert.equal(deleteMatches.length, 1, 'FE must contain exactly 1 deleteAssignment method');

  assert.match(
    feContent,
    /deleteAssignment\(assignmentId,\s*force\s*=\s*false\)\s*\{[\s\S]*?schoolScoped:\s*true/i,
    'deleteAssignment must include schoolScoped: true'
  );
});

// 7. Verify Slot route in app.js has full 3-layer middleware
test('app.js: slotsRouter enforces authenticate -> requireSchoolContext -> authorizeSchoolRoles', () => {
  const appContent = fs.readFileSync(
    path.join(__dirname, '../src/app.js'),
    'utf-8'
  );

  assert.match(
    appContent,
    /slotsRouter\.use\(\s*authenticate\s*,\s*requireSchoolContext\s*,\s*authorizeSchoolRoles\(['"]school_admin['"],\s*['"]lecturer['"],\s*['"]student['"]\)\s*\)/i,
    'slotsRouter must have authenticate, requireSchoolContext, authorizeSchoolRoles'
  );
});

// 8. Verify Classes getSlotById tenant filtering
test('ClassesService & ClassesRepository: getSlotById enforces school isolation', () => {
  const serviceContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/classes/classes.service.js'),
    'utf-8'
  );
  const repoContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/classes/classes.repository.js'),
    'utf-8'
  );

  assert.match(
    serviceContent,
    /ClassesRepository\.getSlotById\(\s*slotId\s*,\s*tenant\?\.schoolId\s*\)/i,
    'ClassesService.getSlotById must pass tenant?.schoolId'
  );

  assert.match(
    repoContent,
    /getSlotById\s*\(\s*slotId\s*,\s*schoolId\s*\)/i,
    'ClassesRepository.getSlotById must accept schoolId'
  );
  assert.match(
    repoContent,
    /s\.school_id\s*=\s*\$2/i,
    'ClassesRepository.getSlotById query must filter s.school_id = $2'
  );
  assert.match(
    repoContent,
    /a\.school_id\s*=\s*s\.school_id/i,
    'ClassesRepository.getSlotById assignments subquery must match a.school_id = s.school_id'
  );
});

// 9. Verify ClassAiAdvisor school_id propagation
test('ClassAiAdvisor: controller, service, repo propagate schoolId', () => {
  const controllerContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/classes/classAiAdvisor.controller.js'),
    'utf-8'
  );
  const serviceContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/classes/classAiAdvisor.service.js'),
    'utf-8'
  );
  const repoContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/classes/classAiAdvisor.repository.js'),
    'utf-8'
  );

  assert.match(
    controllerContent,
    /ClassAiAdvisorService\.getAiAdvisor\(\s*classId\s*,\s*req\.tenant\s*\)/i,
    'Controller getAiAdvisor must pass req.tenant'
  );
  assert.match(
    controllerContent,
    /ClassAiAdvisorService\.refreshAiAdvisor\(\s*classId\s*,\s*req\.tenant\s*\)/i,
    'Controller refreshAiAdvisor must pass req.tenant'
  );

  assert.match(
    serviceContent,
    /const\s+schoolId\s*=\s*tenant\?\.schoolId/i,
    'Service must extract schoolId from tenant'
  );
  assert.match(
    serviceContent,
    /generateAndSaveAdvisory\(\s*classId\s*,\s*assignment\s*,\s*schoolId\s*\)/i,
    'Service generateAndSaveAdvisory must accept schoolId'
  );

  assert.match(
    repoContent,
    /upsertAdvisory\s*\(\s*\{[\s\S]*?school_id[\s\S]*?\}\s*\)/i,
    'Repository upsertAdvisory must accept school_id'
  );
  assert.match(
    repoContent,
    /INSERT\s+INTO\s+class_ai_advisories\s*\([^)]*school_id/i,
    'Repository upsertAdvisory INSERT must include school_id column'
  );
});

// 10. Verify GradingService background job propagates tenant.schoolId
test('GradingService: background generateAndSaveAdvisory passes tenant.schoolId', () => {
  const gradingContent = fs.readFileSync(
    path.join(__dirname, '../src/modules/grading/grading.service.js'),
    'utf-8'
  );

  const occurrences = [...gradingContent.matchAll(/ClassAiAdvisorService\.generateAndSaveAdvisory\(([\s\S]*?)\)/g)];
  assert.equal(occurrences.length, 2, 'GradingService must have 2 occurrences of generateAndSaveAdvisory');

  for (const occ of occurrences) {
    assert.match(
      occ[1],
      /tenant\.schoolId/i,
      'generateAndSaveAdvisory must pass tenant.schoolId'
    );
  }
});

// 11. Mock test: AssignmentRepository.create passes school_id at index 2 ($3)
test('AssignmentRepository.create mock execution: values array matches SQL columns', async () => {
  const AssignmentRepository = require('../src/modules/assignments/assignment.repository');
  let capturedQuery = null;
  let capturedValues = null;

  const mockClient = {
    query: async (query, values) => {
      capturedQuery = query;
      capturedValues = values;
      return { rows: [{ id: values[0], school_id: values[2] }] };
    }
  };

  const payload = {
    id: 'test-assign-id',
    uuid: 'test-uuid',
    school_id: 'test-school-123',
    class_id: 'test-class-456',
    slot_id: 'test-slot-789',
    title: 'Test Assignment',
    description: 'Test Desc',
    instructions: 'Test Inst',
    deadline: new Date(),
    max_score: 100,
    weight: 20,
    ai_declaration_required: true,
    min_ai_interactions: 1,
    max_ai_interactions: 10,
    allow_late_submission: false,
    publish_status: 'draft',
    created_by: 'test-user-id'
  };

  const res = await AssignmentRepository.create(payload, mockClient);
  assert.equal(res.school_id, 'test-school-123');
  assert.equal(capturedValues.length, 19);
  assert.equal(capturedValues[2], 'test-school-123');
  assert.equal(capturedValues[3], 'test-class-456');
  assert.equal(capturedValues[4], 'test-slot-789');
  assert.equal(capturedValues[5], 'test-slot-789');
});

// 12. Verify assignment_rubric_configs table exists in database
test('assignment_rubric_configs: table exists in DB', async () => {
  const { pool } = require('../src/config/db.config');
  const check = await pool.query("SELECT to_regclass('public.assignment_rubric_configs')");
  assert.ok(check.rows[0].to_regclass, 'assignment_rubric_configs table must exist');
});


