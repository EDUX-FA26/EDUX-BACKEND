const Repo = require('./forum.repository');
const NotificationsRepository = require('../notifications/notifications.repository');
const FlashcardsService = require('../flashcards/flashcards.service');

const ForumService = {
  schools(user) { return Repo.listAvailableSchools(user.id, user.role); },
  stats(user) { return Repo.getUserStats(user.id); },
  async list(user, query) {
    const schoolId = await Repo.findUserSchoolId(user.id);
    const selectedSchoolId = user.role === 'admin' && query.schoolId ? query.schoolId : schoolId;
    return Repo.listPosts({ ...query, userId: user.id, role: user.role, schoolId: selectedSchoolId });
  },
  async get(user, id) {
    const schoolId = await Repo.findUserSchoolId(user.id);
    return Repo.findPostById(id, user.id, user.role, schoolId);
  },
  async create(user, body) {
    if (!['lecturer', 'admin', 'student'].includes(user.role)) throw Object.assign(new Error('You are not allowed to create forum posts'), { status: 403 });
    const schoolId = await Repo.findUserSchoolId(user.id);
    if (!schoolId && user.role !== 'admin') throw Object.assign(new Error('Your account is not assigned to a school'), { status: 403 });
    if (body.flashcardDeckId && user.role !== 'lecturer') {
      throw Object.assign(new Error('Only lecturers can publish Flashcard posts'), { status: 403 });
    }
    const visibility = body.visibility === 'CLASS_ONLY' ? 'CLASS_ONLY' : 'PUBLIC';
    const postType = body.postType === 'CONFESSION' ? 'CONFESSION' : 'DISCUSSION';
    const classIds = Array.isArray(body.classIds) ? [...new Set(body.classIds)] : [];
    if (visibility === 'CLASS_ONLY' && !classIds.length) throw Object.assign(new Error('At least one class is required for class-only posts'), { status: 400 });
    const allowedClassIds = await Repo.findAllowedClassIds({ userId: user.id, role: user.role, classIds });
    if (allowedClassIds.length !== classIds.length) throw Object.assign(new Error('You can only share posts with classes you are enrolled in'), { status: 403 });
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 5).filter((item) => item && item.name && item.dataUrl && String(item.dataUrl).length <= 3_000_000) : [];
    const tags = Array.isArray(body.tags) ? [...new Set(body.tags.map((tag) => String(tag).trim().replace(/^#/, '').slice(0, 40)).filter(Boolean))].slice(0, 10) : [];
    if (body.flashcardDeckId) await FlashcardsService.publishDeckForForum(body.flashcardDeckId, user);
    const post = await Repo.createPost({ ...body, authorId: user.id, schoolId, visibility, postType, isAnonymous: Boolean(body.isAnonymous), attachments, tags, classIds: allowedClassIds });
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
    const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 5).filter((item) => item && item.name && item.dataUrl && String(item.dataUrl).length <= 3_000_000) : [];
    const result = await Repo.addComment({ postId: id, userId: user.id, ...body, attachments });
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
