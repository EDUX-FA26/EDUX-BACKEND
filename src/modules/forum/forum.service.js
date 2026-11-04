const Repo = require('./forum.repository');

const ForumService = {
  list(user, query) { return Repo.listPosts({ userId: user.id, ...query }); },
  get(user, id) { return Repo.findPostById(id, user.id); },
  async create(user, body) {
    if (!['lecturer', 'admin'].includes(user.role)) throw Object.assign(new Error('Only lecturers or admins can create forum posts'), { status: 403 });
    return Repo.createPost({ authorId: user.id, ...body });
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
