const { pool } = require('../../config/db.config');

const postSelect = `
  SELECT fp.id, fp.title, fp.content, fp.visibility, fp.post_type, fp.is_anonymous, fp.attachments, fp.view_count, fp.is_pinned, fp.comments_locked,
         fp.subject_id, fp.flashcard_deck_id, fp.created_at, fp.updated_at,
         u.id AS author_id, u.role AS author_role, up.full_name AS author_name,
         s.code AS subject_code, s.name AS subject_name,
         fd.title AS flashcard_title,
         (SELECT COUNT(*)::int FROM forum_posts fp_author WHERE fp_author.author_id = u.id) AS author_post_count,
         (SELECT (COALESCE((SELECT COUNT(*) FROM forum_post_likes fpl_author JOIN forum_posts fp_like ON fp_like.id = fpl_author.post_id WHERE fp_like.author_id = u.id), 0) + COALESCE((SELECT COUNT(*) FROM forum_comments fc_author WHERE fc_author.author_id = u.id), 0))::int) AS author_reaction_score,
         COALESCE((SELECT json_agg(json_build_object('id', c2.id, 'code', c2.class_code) ORDER BY c2.class_code)
                   FROM forum_post_classes fpc2 JOIN classes c2 ON c2.id = fpc2.class_id
                   WHERE fpc2.post_id = fp.id), '[]'::json) AS target_classes,
         COUNT(DISTINCT fpl.user_id)::int AS like_count,
         COUNT(DISTINCT fc.id)::int AS comment_count,
         EXISTS (SELECT 1 FROM forum_post_likes mine WHERE mine.post_id = fp.id AND mine.user_id = $1) AS liked_by_me
  FROM forum_posts fp
  JOIN users u ON u.id = fp.author_id
  LEFT JOIN user_profiles up ON up.user_id = u.id
  LEFT JOIN subjects s ON s.id = fp.subject_id
  LEFT JOIN flashcard_decks fd ON fd.id = fp.flashcard_deck_id
  LEFT JOIN forum_post_likes fpl ON fpl.post_id = fp.id
  LEFT JOIN forum_comments fc ON fc.post_id = fp.id
`;

const ForumRepository = {
  async getUserStats(userId) {
    const { rows } = await pool.query(`
      SELECT u.id, COALESCE(up.full_name, u.email) AS display_name,
             (SELECT COUNT(*)::int FROM forum_posts WHERE author_id = u.id) AS post_count,
             (SELECT (COALESCE(SUM(x.like_count), 0) + (SELECT COUNT(*) FROM forum_comments WHERE author_id = u.id))::int FROM (
               SELECT COUNT(*)::int AS like_count FROM forum_posts fp2
               LEFT JOIN forum_post_likes fpl2 ON fpl2.post_id = fp2.id
               WHERE fp2.author_id = u.id GROUP BY fp2.id
             ) x) AS reaction_score
      FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE u.id = $1`, [userId]);
    return rows[0] || null;
  },

  async findAllowedClassIds({ userId, role, classIds }) {
    if (!classIds.length) return [];
    const { rows } = await pool.query(`SELECT id FROM classes WHERE id = ANY($1::uuid[]) AND ($2 = 'admin' OR lecturer_id = $3)`, [classIds, role, userId]);
    return rows.map((row) => row.id);
  },

  async findAudienceUserIds(postId, authorId) {
    const { rows } = await pool.query(`
      SELECT DISTINCT u.id
      FROM users u
      WHERE u.is_active = true AND u.id <> $2 AND (
        EXISTS (SELECT 1 FROM forum_posts fp WHERE fp.id = $1 AND fp.visibility = 'PUBLIC')
        OR EXISTS (
          SELECT 1 FROM forum_post_classes fpc
          JOIN class_members cm ON cm.class_id = fpc.class_id AND cm.student_id = u.id AND cm.status = 'active'
          WHERE fpc.post_id = $1
        )
        OR EXISTS (
          SELECT 1 FROM forum_post_classes fpc
          JOIN classes c ON c.id = fpc.class_id AND c.lecturer_id = u.id
          WHERE fpc.post_id = $1
        )
      )`, [postId, authorId]);
    return rows.map((row) => row.id);
  },

  async listPosts({ userId, role, page = 1, limit = 10, q = '', author = '', classId = '', type = '', sort = 'latest' }) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));
    const offset = (safePage - 1) * safeLimit;
    const params = [userId, role];
    const conditions = [`(fp.visibility = 'PUBLIC' OR $2 = 'admin' OR EXISTS (
      SELECT 1 FROM forum_post_classes access_fpc
      LEFT JOIN class_members access_cm ON access_cm.class_id = access_fpc.class_id AND access_cm.student_id = $1 AND access_cm.status = 'active'
      LEFT JOIN classes access_c ON access_c.id = access_fpc.class_id
      WHERE access_fpc.post_id = fp.id AND (access_cm.student_id IS NOT NULL OR access_c.lecturer_id = $1)
    ))`];
    if (q) { params.push(`%${q}%`); conditions.push(`(fp.title ILIKE $${params.length} OR fp.content ILIKE $${params.length})`); }
    if (author) { params.push(`%${author}%`); conditions.push(`(COALESCE(up.full_name, '') ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    if (classId) { params.push(classId); conditions.push(`EXISTS (SELECT 1 FROM forum_post_classes filter_fpc WHERE filter_fpc.post_id = fp.id AND filter_fpc.class_id = $${params.length})`); }
    if (type === 'CONFESSION' || type === 'DISCUSSION') { params.push(type); conditions.push(`fp.post_type = $${params.length}`); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM forum_posts fp JOIN users u ON u.id = fp.author_id LEFT JOIN user_profiles up ON up.user_id = u.id ${where}`, params);
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;
    const orderBy = sort === 'popular' ? 'fp.view_count DESC, fp.created_at DESC' : sort === 'comments' ? 'comment_count DESC, fp.created_at DESC' : 'fp.is_pinned DESC, fp.created_at DESC';
    const result = await pool.query(`${postSelect} ${where} GROUP BY fp.id, u.id, up.full_name, s.code, s.name, fd.title ORDER BY ${orderBy} LIMIT $${limitParam} OFFSET $${offsetParam}`, [...params, safeLimit, offset]);
    return { data: result.rows, page: safePage, limit: safeLimit, total: count.rows[0].total, totalPages: Math.max(1, Math.ceil(count.rows[0].total / safeLimit)) };
  },

  async findPostById(id, userId, role) {
    await pool.query('UPDATE forum_posts SET view_count = view_count + 1, updated_at = updated_at WHERE id = $1', [id]);
    const result = await pool.query(`${postSelect} WHERE fp.id = $2 AND (fp.visibility = 'PUBLIC' OR $3 = 'admin' OR EXISTS (SELECT 1 FROM forum_post_classes fpc_access LEFT JOIN class_members cm_access ON cm_access.class_id = fpc_access.class_id AND cm_access.student_id = $1 AND cm_access.status = 'active' LEFT JOIN classes c_access ON c_access.id = fpc_access.class_id WHERE fpc_access.post_id = fp.id AND (cm_access.student_id IS NOT NULL OR c_access.lecturer_id = $1))) GROUP BY fp.id, u.id, up.full_name, s.code, s.name, fd.title`, [userId, id, role]);
    if (!result.rows[0]) return null;
    const comments = await pool.query(`
      SELECT fc.id, fc.parent_id, fc.content, fc.attachments, fc.created_at, fc.updated_at,
             fc.author_id, up.full_name AS author_name, u.role AS author_role
      FROM forum_comments fc JOIN users u ON u.id = fc.author_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE fc.post_id = $1 ORDER BY fc.created_at ASC`, [id]);
    return { ...result.rows[0], comments: comments.rows };
  },

  async createPost({ authorId, title, content, subjectId, flashcardDeckId, visibility = 'PUBLIC', classIds = [], postType = 'DISCUSSION', isAnonymous = false, attachments = [] }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`INSERT INTO forum_posts (author_id, title, content, subject_id, flashcard_deck_id, visibility, post_type, is_anonymous, attachments) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [authorId, title, content, subjectId || null, flashcardDeckId || null, visibility, postType, isAnonymous, JSON.stringify(attachments || [])]);
      for (const classId of classIds) await client.query('INSERT INTO forum_post_classes (post_id, class_id) VALUES ($1, $2)', [rows[0].id, classId]);
      await client.query('COMMIT');
      return rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  },

  async deletePost(id, userId, isAdmin) {
    const result = await pool.query(`DELETE FROM forum_posts WHERE id = $1 AND ($3 = true OR author_id = $2) RETURNING id`, [id, userId, isAdmin]);
    return result.rows[0] || null;
  },

  async toggleLike(postId, userId) {
    const existing = await pool.query('SELECT 1 FROM forum_post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
    if (existing.rowCount) {
      await pool.query('DELETE FROM forum_post_likes WHERE post_id = $1 AND user_id = $2', [postId, userId]);
      return { liked: false };
    }
    await pool.query('INSERT INTO forum_post_likes (post_id, user_id) VALUES ($1,$2)', [postId, userId]);
    return { liked: true };
  },

  async addComment({ postId, userId, parentId, content, attachments = [] }) {
    const { rows } = await pool.query(`INSERT INTO forum_comments (post_id, author_id, parent_id, content, attachments) SELECT $1,$2,$3,$4,$5 WHERE EXISTS (SELECT 1 FROM forum_posts WHERE id = $1 AND comments_locked = false) RETURNING id, post_id, author_id, parent_id, content, attachments, created_at`, [postId, userId, parentId || null, content, JSON.stringify(attachments || [])]);
    return rows[0] || null;
  },

  async deleteComment(id, userId, isAdmin) {
    const { rows } = await pool.query(`DELETE FROM forum_comments WHERE id = $1 AND ($3 = true OR author_id = $2) RETURNING id`, [id, userId, isAdmin]);
    return rows[0] || null;
  },
};

module.exports = ForumRepository;
