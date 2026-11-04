const { pool } = require('../../config/db.config');

const postSelect = `
  SELECT fp.id, fp.title, fp.content, fp.visibility, fp.is_pinned, fp.comments_locked,
         fp.subject_id, fp.flashcard_deck_id, fp.created_at, fp.updated_at,
         u.id AS author_id, u.role AS author_role, up.full_name AS author_name,
         s.code AS subject_code, s.name AS subject_name,
         fd.title AS flashcard_title,
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
  async listPosts({ userId, page = 1, limit = 10, q = '' }) {
    const offset = (Number(page) - 1) * Number(limit);
    const params = [userId];
    const conditions = [`fp.visibility = 'PUBLIC'`];
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(fp.title ILIKE $${params.length} OR fp.content ILIKE $${params.length})`);
    }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM forum_posts fp ${where}`, params);
    const dataParams = [...params, Number(limit), offset];
    const result = await pool.query(`${postSelect} ${where} GROUP BY fp.id, u.id, up.full_name, s.code, s.name, fd.title ORDER BY fp.is_pinned DESC, fp.created_at DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams);
    return { data: result.rows, total: count.rows[0].total };
  },

  async findPostById(id, userId) {
    const result = await pool.query(`${postSelect} WHERE fp.id = $2 GROUP BY fp.id, u.id, up.full_name, s.code, s.name, fd.title`, [userId, id]);
    if (!result.rows[0]) return null;
    const comments = await pool.query(`
      SELECT fc.id, fc.parent_id, fc.content, fc.created_at, fc.updated_at,
             fc.author_id, up.full_name AS author_name, u.role AS author_role
      FROM forum_comments fc JOIN users u ON u.id = fc.author_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE fc.post_id = $1 ORDER BY fc.created_at ASC`, [id]);
    return { ...result.rows[0], comments: comments.rows };
  },

  async createPost({ authorId, title, content, subjectId, flashcardDeckId }) {
    const { rows } = await pool.query(`INSERT INTO forum_posts (author_id, title, content, subject_id, flashcard_deck_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [authorId, title, content, subjectId || null, flashcardDeckId || null]);
    return rows[0];
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

  async addComment({ postId, userId, parentId, content }) {
    const { rows } = await pool.query(`INSERT INTO forum_comments (post_id, author_id, parent_id, content) SELECT $1,$2,$3,$4 WHERE EXISTS (SELECT 1 FROM forum_posts WHERE id = $1 AND comments_locked = false) RETURNING id, post_id, author_id, parent_id, content, created_at`, [postId, userId, parentId || null, content]);
    return rows[0] || null;
  },

  async deleteComment(id, userId, isAdmin) {
    const { rows } = await pool.query(`DELETE FROM forum_comments WHERE id = $1 AND ($3 = true OR author_id = $2) RETURNING id`, [id, userId, isAdmin]);
    return rows[0] || null;
  },
};

module.exports = ForumRepository;
