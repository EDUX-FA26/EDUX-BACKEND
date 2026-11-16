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

  async findSubject(subjectId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND school_id = $2` : '';
    const params = schoolId ? [subjectId, schoolId] : [subjectId];
    const { rows } = await pool.query(
      `SELECT id, name, code, is_active, school_id FROM subjects WHERE id = $1${schoolFilter} LIMIT 1`,
      params
    );
    return rows[0] || null;
  },

  async findById(topicId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND school_id = $2` : '';
    const params = schoolId ? [topicId, schoolId] : [topicId];
    const { rows } = await pool.query(
      `SELECT id, school_id, subject_id, name, code, description, parent_id,
              status, review_required, reviewed_by, reviewed_at, review_note,
              is_active, created_by, created_at, updated_at
       FROM topics WHERE id = $1${schoolFilter} LIMIT 1`,
      params
    );
    return rows[0] || null;
  },

  async findDetail(topicId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND t.school_id = $2` : '';
    const params = schoolId ? [topicId, schoolId] : [topicId];
    const { rows } = await pool.query(
      `SELECT
         t.id, t.school_id, t.subject_id, t.name, t.code, t.description, t.parent_id,
         t.status, t.review_required, t.reviewed_by, t.reviewed_at, t.review_note,
         t.is_active, t.created_by, t.created_at, t.updated_at,
         s.code AS subject_code,
         s.name AS subject_name,
         COUNT(DISTINCT ft.flashcard_id)::int AS flashcard_count,
         COUNT(DISTINCT fr.id)::int AS review_count
       FROM topics t
       JOIN subjects s ON s.id = t.subject_id AND s.school_id = t.school_id
       LEFT JOIN flashcard_topics ft ON ft.topic_id = t.id
       LEFT JOIN flashcard_reviews fr ON fr.flashcard_id = ft.flashcard_id
       WHERE t.id = $1${schoolFilter}
       GROUP BY t.id, s.code, s.name`,
      params
    );

    if (!rows[0]) return null;

    const topic = rows[0];
    const aliasParams = schoolId ? [topicId, schoolId] : [topicId];
    const aliasSchoolFilter = schoolId ? ` AND school_id = $2` : '';
    const { rows: aliases } = await pool.query(
      `SELECT id, topic_id, alias, created_by, created_at
       FROM topic_aliases
       WHERE topic_id = $1${aliasSchoolFilter}
       ORDER BY alias ASC`,
      aliasParams
    );

    return {
      ...topic,
      aliases,
      alias_count: aliases.length,
    };
  },

  async listBySubject(subjectId, schoolId = null) {
    const schoolFilter = schoolId ? ` AND school_id = $2` : '';
    const params = schoolId ? [subjectId, schoolId] : [subjectId];
    const { rows } = await pool.query(
      `SELECT id, subject_id, name, code, description, parent_id, is_active,
              status, review_required, created_at, updated_at
       FROM topics
       WHERE subject_id = $1
         AND is_active = true
         AND status = 'approved'
         AND (review_required = false OR review_required IS NULL)
         ${schoolFilter}
       ORDER BY name ASC`,
      params
    );
    return rows;
  },

  async listCatalog({
    subjectId,
    schoolId,
    includeAll = false,
    status,
    reviewRequired,
    isActive,
    search,
    page = 1,
    limit = 50,
  }) {
    const conditions = ['t.subject_id = $1', 't.school_id = $2'];
    const params = [subjectId, schoolId];
    let paramIndex = 3;

    if (!includeAll) {
      conditions.push(`t.is_active = true`);
      conditions.push(`t.status = 'approved'`);
      conditions.push(`(t.review_required = false OR t.review_required IS NULL)`);
    } else {
      if (status && status !== 'all') {
        conditions.push(`t.status = $${paramIndex++}`);
        params.push(status);
      }
      if (reviewRequired !== undefined) {
        conditions.push(`t.review_required = $${paramIndex++}`);
        params.push(reviewRequired);
      }
      if (isActive !== undefined) {
        conditions.push(`t.is_active = $${paramIndex++}`);
        params.push(isActive);
      }
    }

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(`(
        t.name ILIKE $${paramIndex}
        OR t.code ILIKE $${paramIndex}
        OR EXISTS (
          SELECT 1 FROM topic_aliases ta
          WHERE ta.topic_id = t.id AND ta.alias ILIKE $${paramIndex}
        )
      )`);
      params.push(term);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM topics t
      WHERE ${whereClause}
    `;
    const countRes = await pool.query(countQuery, params);
    const total = countRes.rows[0]?.total || 0;

    const offset = (page - 1) * limit;
    params.push(limit, offset);

    const query = `
      SELECT
        t.id, t.school_id, t.subject_id, t.name, t.code, t.description, t.parent_id,
        t.status, t.review_required, t.reviewed_by, t.reviewed_at, t.review_note,
        t.is_active, t.created_by, t.created_at, t.updated_at,
        COUNT(DISTINCT ta.id)::int AS alias_count,
        COUNT(DISTINCT ft.flashcard_id)::int AS flashcard_count
      FROM topics t
      LEFT JOIN topic_aliases ta ON ta.topic_id = t.id
      LEFT JOIN flashcard_topics ft ON ft.topic_id = t.id
      WHERE ${whereClause}
      GROUP BY t.id
      ORDER BY
        CASE WHEN t.review_required = true THEN 0 ELSE 1 END,
        t.name ASC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    const { rows } = await pool.query(query, params);

    return {
      items: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  async findConflictByName(schoolId, subjectId, name, excludeTopicId = null) {
    const params = [schoolId, subjectId, name.trim()];
    let query = `
      SELECT id, name FROM topics
      WHERE school_id = $1 AND subject_id = $2
        AND lower(btrim(name)) = lower(btrim($3))
    `;
    if (excludeTopicId) {
      params.push(excludeTopicId);
      query += ` AND id <> $4`;
    }
    query += ` LIMIT 1`;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  async findConflictByCode(schoolId, subjectId, code, excludeTopicId = null) {
    if (!code || !code.trim()) return null;
    const params = [schoolId, subjectId, code.trim()];
    let query = `
      SELECT id, code FROM topics
      WHERE school_id = $1 AND subject_id = $2
        AND code IS NOT NULL
        AND lower(btrim(code)) = lower(btrim($3))
    `;
    if (excludeTopicId) {
      params.push(excludeTopicId);
      query += ` AND id <> $4`;
    }
    query += ` LIMIT 1`;
    const { rows } = await pool.query(query, params);
    return rows[0] || null;
  },

  async checkAliasConflict(schoolId, subjectId, aliasStr, excludeTopicId = null) {
    if (!aliasStr || !aliasStr.trim()) return null;
    const trimmed = aliasStr.trim();

    // Check alias duplicate in topic_aliases
    const aliasParams = [schoolId, subjectId, trimmed];
    let aliasQuery = `
      SELECT id, topic_id, alias FROM topic_aliases
      WHERE school_id = $1 AND subject_id = $2
        AND lower(btrim(alias)) = lower(btrim($3))
    `;
    if (excludeTopicId) {
      aliasParams.push(excludeTopicId);
      aliasQuery += ` AND topic_id <> $4`;
    }
    aliasQuery += ` LIMIT 1`;
    const aliasRes = await pool.query(aliasQuery, aliasParams);
    if (aliasRes.rows[0]) {
      return { type: 'alias', conflict: aliasRes.rows[0] };
    }

    // Check conflict with topic name
    const nameParams = [schoolId, subjectId, trimmed];
    let nameQuery = `
      SELECT id, name FROM topics
      WHERE school_id = $1 AND subject_id = $2
        AND lower(btrim(name)) = lower(btrim($3))
    `;
    if (excludeTopicId) {
      nameParams.push(excludeTopicId);
      nameQuery += ` AND id <> $4`;
    }
    nameQuery += ` LIMIT 1`;
    const nameRes = await pool.query(nameQuery, nameParams);
    if (nameRes.rows[0]) {
      return { type: 'topic_name', conflict: nameRes.rows[0] };
    }

    // Check conflict with topic code
    const codeParams = [schoolId, subjectId, trimmed];
    let codeQuery = `
      SELECT id, code FROM topics
      WHERE school_id = $1 AND subject_id = $2
        AND code IS NOT NULL
        AND lower(btrim(code)) = lower(btrim($3))
    `;
    if (excludeTopicId) {
      codeParams.push(excludeTopicId);
      codeQuery += ` AND id <> $4`;
    }
    codeQuery += ` LIMIT 1`;
    const codeRes = await pool.query(codeQuery, codeParams);
    if (codeRes.rows[0]) {
      return { type: 'topic_code', conflict: codeRes.rows[0] };
    }

    return null;
  },

  async createCanonical({ schoolId, subjectId, name, code, description, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO topics (
         school_id, subject_id, name, code, description,
         parent_id, status, review_required, reviewed_by, reviewed_at,
         created_by, is_active
       ) VALUES (
         $1, $2, $3, $4, $5,
         NULL, 'approved', false, $6, NOW(),
         $6, true
       ) RETURNING *`,
      [schoolId, subjectId, name.trim(), code ? code.trim() : null, description || '', createdBy]
    );
    return rows[0];
  },

  async findSubjectTopicCatalog(schoolId, subjectId) {
    const topicsRes = await pool.query(
      `SELECT id, name, code, lower(btrim(name)) AS lower_name, lower(btrim(code)) AS lower_code
       FROM topics
       WHERE school_id = $1 AND subject_id = $2`,
      [schoolId, subjectId]
    );

    const aliasesRes = await pool.query(
      `SELECT id, topic_id, alias, lower(btrim(alias)) AS lower_alias
       FROM topic_aliases
       WHERE school_id = $1 AND subject_id = $2`,
      [schoolId, subjectId]
    );

    return {
      topics: topicsRes.rows,
      aliases: aliasesRes.rows,
    };
  },

  async createCanonicalBatch({ schoolId, subjectId, items, createdBy }) {
    const client = await pool.connect();
    const results = [];
    try {
      await client.query('BEGIN');
      for (const item of items) {
        const { rows } = await client.query(
          `INSERT INTO topics (
             school_id, subject_id, name, code, description,
             parent_id, status, review_required, reviewed_by, reviewed_at,
             created_by, is_active
           ) VALUES (
             $1, $2, $3, $4, $5,
             NULL, 'approved', false, $6, NOW(),
             $6, true
           ) RETURNING *`,
          [schoolId, subjectId, item.name.trim(), item.code ? item.code.trim() : null, item.description || '', createdBy]
        );
        const topic = rows[0];
        topic.aliases = [];

        if (Array.isArray(item.aliases) && item.aliases.length > 0) {
          for (const aliasStr of item.aliases) {
            if (!aliasStr || !aliasStr.trim()) continue;
            const aliasTrimmed = aliasStr.trim();
            const { rows: aliasRows } = await client.query(
              `INSERT INTO topic_aliases (topic_id, school_id, subject_id, alias, created_by)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING *`,
              [topic.id, schoolId, subjectId, aliasTrimmed, createdBy]
            );
            topic.aliases.push(aliasRows[0]);
          }
        }
        results.push(topic);
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async createProposal({ schoolId, subjectId, name, code, description, createdBy, reason }) {
    const { rows } = await pool.query(
      `INSERT INTO topics (
         school_id, subject_id, name, code, description,
         parent_id, status, review_required, review_note,
         created_by, is_active
       ) VALUES (
         $1, $2, $3, $4, $5,
         NULL, 'pending_approval', true, $6,
         $7, true
       ) RETURNING *`,
      [
        schoolId,
        subjectId,
        name.trim(),
        code && code.trim() ? code.trim() : null,
        description || '',
        reason || '',
        createdBy,
      ]
    );
    return rows[0];
  },

  async update(topicId, data, schoolId) {
    const fields = [];
    const values = [];
    let index = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${index++}`);
      values.push(data.name.trim());
    }
    if (data.code !== undefined) {
      fields.push(`code = $${index++}`);
      values.push(data.code ? data.code.trim() : null);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${index++}`);
      values.push(data.description);
    }
    if (data.isActive !== undefined) {
      fields.push(`is_active = $${index++}`);
      values.push(data.isActive);
    }

    if (!fields.length) return null;

    values.push(topicId, schoolId);
    const { rows } = await pool.query(
      `UPDATE topics
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${index++} AND school_id = $${index++}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async confirmLegacy(topicId, { code, name, description, reviewNote, reviewedBy }, schoolId) {
    const fields = [
      `review_required = false`,
      `status = 'approved'`,
      `reviewed_by = $2`,
      `reviewed_at = NOW()`,
      `updated_at = NOW()`,
    ];
    const values = [topicId, reviewedBy];
    let index = 3;

    if (code !== undefined) {
      fields.push(`code = $${index++}`);
      values.push(code ? code.trim() : null);
    }
    if (name !== undefined) {
      fields.push(`name = $${index++}`);
      values.push(name.trim());
    }
    if (description !== undefined) {
      fields.push(`description = $${index++}`);
      values.push(description);
    }
    if (reviewNote !== undefined) {
      fields.push(`review_note = $${index++}`);
      values.push(reviewNote);
    }

    values.push(schoolId);
    const { rows } = await pool.query(
      `UPDATE topics
       SET ${fields.join(', ')}
       WHERE id = $1 AND school_id = $${index}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async reviewProposal(topicId, { status, code, name, description, reviewNote, reviewedBy }, schoolId) {
    const isActiveVal = status === 'approved';
    const fields = [
      `status = $2`,
      `review_required = false`,
      `is_active = $3`,
      `reviewed_by = $4`,
      `reviewed_at = NOW()`,
      `review_note = $5`,
      `updated_at = NOW()`,
    ];
    const values = [topicId, status, isActiveVal, reviewedBy, reviewNote || ''];
    let index = 6;

    if (code !== undefined) {
      fields.push(`code = $${index++}`);
      values.push(code && code.trim() ? code.trim() : null);
    }
    if (name !== undefined) {
      fields.push(`name = $${index++}`);
      values.push(name.trim());
    }
    if (description !== undefined) {
      fields.push(`description = $${index++}`);
      values.push(description);
    }

    values.push(schoolId);
    const { rows } = await pool.query(
      `UPDATE topics
       SET ${fields.join(', ')}
       WHERE id = $1 AND school_id = $${index}
       RETURNING *`,
      values
    );
    return rows[0] || null;
  },

  async setStatus(topicId, isActive, schoolId) {
    const { rows } = await pool.query(
      `UPDATE topics
       SET is_active = $2, updated_at = NOW()
       WHERE id = $1 AND school_id = $3
       RETURNING *`,
      [topicId, isActive, schoolId]
    );
    return rows[0] || null;
  },

  async getReferenceCounts(topicId, schoolId = null) {
    const params = [topicId];
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM flashcard_topics WHERE topic_id = $1) AS flashcard_count,
         (SELECT COUNT(DISTINCT fr.id)::int
          FROM flashcard_topics ft
          JOIN flashcards fc ON fc.id = ft.flashcard_id
          JOIN flashcard_reviews fr ON fr.flashcard_id = fc.id
          WHERE ft.topic_id = $1) AS review_count,
         (SELECT COUNT(*)::int FROM topic_aliases WHERE topic_id = $1) AS alias_count`,
      params
    );
    return rows[0] || { flashcard_count: 0, review_count: 0, alias_count: 0 };
  },

  // ─────────────────────────────────────────────
  // ALIASES
  // ─────────────────────────────────────────────

  async listAliases(topicId, schoolId) {
    const { rows } = await pool.query(
      `SELECT id, topic_id, school_id, subject_id, alias, created_by, created_at
       FROM topic_aliases
       WHERE topic_id = $1 AND school_id = $2
       ORDER BY alias ASC`,
      [topicId, schoolId]
    );
    return rows;
  },

  async createAlias({ topicId, schoolId, subjectId, alias, createdBy }) {
    const { rows } = await pool.query(
      `INSERT INTO topic_aliases (topic_id, school_id, subject_id, alias, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [topicId, schoolId, subjectId, alias.trim(), createdBy]
    );
    return rows[0];
  },

  async deleteAlias(topicId, aliasId, schoolId) {
    const { rows } = await pool.query(
      `DELETE FROM topic_aliases
       WHERE id = $1 AND topic_id = $2 AND school_id = $3
       RETURNING *`,
      [aliasId, topicId, schoolId]
    );
    return rows[0] || null;
  },

  async findAliasById(aliasId, schoolId) {
    const { rows } = await pool.query(
      `SELECT * FROM topic_aliases WHERE id = $1 AND school_id = $2 LIMIT 1`,
      [aliasId, schoolId]
    );
    return rows[0] || null;
  },

  // ─────────────────────────────────────────────
  // FLASHCARD MAPPING (PHASE 2A)
  // ─────────────────────────────────────────────

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
