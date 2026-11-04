const Repo = require('./forum.repository');
const NotificationsRepository = require('../notifications/notifications.repository');

const ForumService = {
  list(user, query) { return Repo.listPosts({ userId: user.id, ...query }); },
  get(user, id) { return Repo.findPostById(id, user.id); },
  async create(user, body) {
    if (!['lecturer', 'admin'].includes(user.role)) throw Object.assign(new Error('Only lecturers or admins can create forum posts'), { status: 403 });
    const post = await Repo.createPost({ authorId: user.id, ...body });
    // Public forum posts notify every other active EDUX account. Notification
    // failure must not roll back a successfully-created forum post.
    try {
      const userIds = await NotificationsRepository.findActiveUserIdsExcept(user.id);
      await NotificationsRepository.bulkCreate(userIds.map((userId) => ({
        userId,
        title: 'Bài đăng mới trên diễn đàn',
        message: `${user.full_name || user.email || 'Một giảng viên'} đã đăng: ${body.title}`,
        type: 'FORUM_POST',
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
