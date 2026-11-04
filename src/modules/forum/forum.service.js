const Repo = require('./forum.repository');
const NotificationsRepository = require('../notifications/notifications.repository');

const ForumService = {
  stats(user) { return Repo.getUserStats(user.id); },
  list(user, query) { return Repo.listPosts({ userId: user.id, role: user.role, ...query }); },
  get(user, id) { return Repo.findPostById(id, user.id, user.role); },
  async create(user, body) {
    if (!['lecturer', 'admin', 'student'].includes(user.role)) throw Object.assign(new Error('You are not allowed to create forum posts'), { status: 403 });
    const visibility = user.role === 'student' ? 'PUBLIC' : (body.visibility === 'CLASS_ONLY' ? 'CLASS_ONLY' : 'PUBLIC');
    const postType = body.postType === 'CONFESSION' ? 'CONFESSION' : 'DISCUSSION';
    const classIds = Array.isArray(body.classIds) ? [...new Set(body.classIds)] : [];
    if (visibility === 'CLASS_ONLY' && !classIds.length) throw Object.assign(new Error('At least one class is required for class-only posts'), { status: 400 });
    const allowedClassIds = await Repo.findAllowedClassIds({ userId: user.id, role: user.role, classIds });
    if (allowedClassIds.length !== classIds.length) throw Object.assign(new Error('You can only share posts with classes you teach'), { status: 403 });
    const post = await Repo.createPost({ ...body, authorId: user.id, visibility, postType, isAnonymous: Boolean(body.isAnonymous), classIds: allowedClassIds });
    // Notify the public audience or only members/lecturers of selected classes.
    // failure must not roll back a successfully-created forum post.
    try {
      const userIds = await Repo.findAudienceUserIds(post.id, user.id);
      await NotificationsRepository.bulkCreate(userIds.map((userId) => ({
        userId,
        title: 'Bài đăng mới trên diễn đàn',
        message: `${user.full_name || user.email || 'Một giảng viên'} đã đăng: ${body.title}`,
        // Keep the existing notifications.type constraint; the related entity
        // still identifies this notification as a forum post.
        type: 'system_announcement',
        related_entity_type: 'forum_post',
        related_entity_id: post.id,
      })));
    } catch (notificationError) {
      console.error('Forum post notification failed:', notificationError.message);
    }
    return post;
  },
  async remove(user, id) {
    const result = await Repo.deletePost(id, user.id, user.role === 'admin');
    if (!result) throw Object.assign(new Error('Forum post not found or access denied'), { status: 404 });
    return result;
  },
  async like(user, id) {
    const result = await Repo.toggleLike(id, user.id);
    return result;
  },
  async comment(user, id, body) {
    const result = await Repo.addComment({ postId: id, userId: user.id, ...body });
    if (!result) throw Object.assign(new Error('Post not found or comments are locked'), { status: 400 });
    return result;
  },
  async removeComment(user, id) {
    const result = await Repo.deleteComment(id, user.id, user.role === 'admin');
    if (!result) throw Object.assign(new Error('Comment not found or access denied'), { status: 404 });
    return result;
  },
};

module.exports = ForumService;
