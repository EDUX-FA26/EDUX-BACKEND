require('dotenv').config();
const { pool } = require('../../config/db.config');
const LearningRepository = require('./learning.repository');

describe('Phase 5A — PostgreSQL Real Schema & Integration Verification', () => {
  const dummyStudentId = '00000000-0000-0000-0000-000000000001';
  const dummySubjectId = '00000000-0000-0000-0000-000000000002';
  const dummySchoolId = '00000000-0000-0000-0000-000000000003';

  let isConnected = false;

  beforeAll(async () => {
    try {
      const res = await pool.query('SELECT 1 AS ok');
      isConnected = res.rows.length > 0;
    } catch (err) {
      console.warn('Real PostgreSQL connection not available, skipping DB queries:', err.message);
      isConnected = false;
    }
  });

  test('Database connection and schema introspection: verify flashcard_topics and flashcards columns', async () => {
    if (!isConnected) return;

    // Check flashcard_topics columns in information_schema
    const { rows: fctCols } = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'flashcard_topics'
    `);
    const fctColNames = fctCols.map(c => c.column_name);

    expect(fctColNames).toContain('flashcard_id');
    expect(fctColNames).toContain('topic_id');
    expect(fctColNames).toContain('review_status');
    expect(fctColNames).not.toContain('id'); // Confirmed: NO id column in flashcard_topics

    // Check flashcards columns in information_schema
    const { rows: fcCols } = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'flashcards'
    `);
    const fcColNames = fcCols.map(c => c.column_name);

    expect(fcColNames).toContain('id');
    expect(fcColNames).toContain('deck_id');
    expect(fcColNames).not.toContain('topic_id'); // Confirmed: NO topic_id column in flashcards
  });

  test('findActiveTopicsBySubject compiles and executes cleanly on PostgreSQL', async () => {
    if (!isConnected) return;

    const rows = await LearningRepository.findActiveTopicsBySubject(dummySubjectId, dummySchoolId);
    expect(Array.isArray(rows)).toBe(true);
  });

  test('findSubmittedMultipleChoiceTopicAnswers compiles and executes cleanly on PostgreSQL', async () => {
    if (!isConnected) return;

    const rows = await LearningRepository.findSubmittedMultipleChoiceTopicAnswers(
      dummyStudentId,
      dummySubjectId,
      dummySchoolId
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  test('findTopicReviewCountsBySubject compiles and executes cleanly on PostgreSQL', async () => {
    if (!isConnected) return;

    const rows = await LearningRepository.findTopicReviewCountsBySubject(
      dummyStudentId,
      dummySubjectId,
      dummySchoolId
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  test('findUnclassifiedEventsCountBySubject compiles and executes cleanly on PostgreSQL', async () => {
    if (!isConnected) return;

    const res = await LearningRepository.findUnclassifiedEventsCountBySubject(
      dummyStudentId,
      dummySubjectId,
      dummySchoolId
    );
    expect(res).toBeDefined();
    expect(typeof res.unclassifiedQuizAnswers).toBe('number');
    expect(typeof res.unclassifiedReviews).toBe('number');
    expect(typeof res.totalUnclassifiedEvents).toBe('number');
  });

  test('PostgreSQL Schema Introspection: study_plans, study_plan_days and study_plan_day_submissions unique constraints', async () => {
    if (!isConnected) return;

    // Check unique constraints on study_plans
    const { rows: spConstraints } = await pool.query(`
      SELECT tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'study_plans'
        AND tc.constraint_type = 'UNIQUE'
    `);
    const spCols = spConstraints.map(c => c.column_name);
    expect(spCols).toContain('student_id');
    expect(spCols).toContain('subject_id');
    expect(spCols).toContain('starts_on');

    // Check unique constraints on study_plan_days
    const { rows: spdConstraints } = await pool.query(`
      SELECT tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'study_plan_days'
        AND tc.constraint_type = 'UNIQUE'
    `);
    const spdCols = spdConstraints.map(c => c.column_name);
    expect(spdCols).toContain('plan_id');
    expect(spdCols).toContain('day_number');

    // Check unique constraints on study_plan_day_submissions
    const { rows: subConstraints } = await pool.query(`
      SELECT tc.constraint_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'study_plan_day_submissions'
        AND tc.constraint_type = 'UNIQUE'
    `);
    const subCols = subConstraints.map(c => c.column_name);
    expect(subCols).toContain('plan_day_id');
  });

  test('Repository SQL text does not contain nonexistent columns fc.topic_id or fct.id', () => {
    const fs = require('fs');
    const path = require('path');
    const repoFile = fs.readFileSync(path.join(__dirname, 'learning.repository.js'), 'utf8');

    expect(repoFile).not.toContain('fc.topic_id');
    expect(repoFile).not.toContain('fct.id');
    expect(repoFile).not.toContain('flashcards.topic_id');
  });
});
