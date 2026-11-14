const { pool } = require('../../config/db.config');

const TopicsRepository = {
  async isLecturerAssignedToSubject(lecturerId, subjectId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND school_id = $3` : '';
    const params = schoolId ? [lecturerId, subjectId, schoolId] : [lecturerId, subjectId];
    const { rows } = await pool.query(
      `SELECT 1 FROM classes WHERE lecturer_id = $1 AND subject_id = $2 AND is_active = true${schoolFilter} LIMIT 1`,
      params
    );
    return rows.length > 0;
  },

  async findById(topicId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND school_id = $2` : '';
    const params = schoolId ? [topicId, schoolId] : [topicId];
    const { rows } = await pool.query(
      `SELECT * FROM topics WHERE id = $1${schoolFilter}`,
      params
    );
    return rows[0] || null;
  },

  async listBySubject(subjectId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND school_id = $2` : '';
    const params = schoolId ? [subjectId, schoolId] : [subjectId];
    const { rows } = await pool.query(
      `SELECT id, subject_id, name, description, parent_id, is_active, created_at, updated_at
       FROM topics WHERE subject_id = $1 AND is_active = true${schoolFilter} ORDER BY name`,
      params
    );
    return rows;
  },

  async create({ subjectId, name, description, parentId, createdBy, schoolId }) {
    // topics.school_id NOT NULL
    const { rows } = await pool.query(
      `INSERT INTO topics (subject_id, name, description, parent_id, created_by, school_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [subjectId, name, description || '', parentId || null, createdBy, schoolId || null]
    );
    return rows[0];
  },

  async update(topicId, data, schoolId = null) {
    const fields = []; const values = []; let index = 1;
    for (const [column, value] of Object.entries({ name: data.name, description: data.description, parent_id: data.parentId, is_active: data.isActive })) {
      if (value !== undefined) { fields.push(`${column} = $${index++}`); values.push(value); }
    }
    if (!fields.length) return null;
    values.push(topicId);
    const schoolFilter = schoolId ? ` AND school_id = $${index + 1}` : '';
    if (schoolId) values.push(schoolId);
    const { rows } = await pool.query(
      `UPDATE topics SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${index}${schoolFilter} RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async findFlashcardContext(flashcardId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND fd.school_id = $2` : '';
    const params = schoolId ? [flashcardId, schoolId] : [flashcardId];
    const { rows } = await pool.query(
      `SELECT fc.id, fc.is_active, fd.id AS deck_id, fd.subject_id, fd.created_by, fd.is_active AS deck_is_active
       FROM flashcards fc JOIN flashcard_decks fd ON fd.id = fc.deck_id WHERE fc.id = $1${schoolFilter}`,
      params
    );
    return rows[0] || null;
  },

  async upsertManualMapping({ flashcardId, topicId, reviewStatus, mappedBy }) {
    const { rows } = await pool.query(
      `INSERT INTO flashcard_topics (flashcard_id, topic_id, mapping_source, review_status, mapped_by)
       VALUES ($1, $2, 'manual', $3, $4)
       ON CONFLICT (flashcard_id, topic_id) DO UPDATE SET
         mapping_source = 'manual', review_status = EXCLUDED.review_status,
         mapped_by = EXCLUDED.mapped_by, updated_at = NOW()
       RETURNING *`,
      [flashcardId, topicId, reviewStatus, mappedBy]
    );
    return rows[0];
  },
};

module.exports = TopicsRepository;
