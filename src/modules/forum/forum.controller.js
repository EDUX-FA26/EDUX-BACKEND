const Service = require('./forum.service');
const ok = (res, data, message = 'OK', status = 200) => res.status(status).json({ success: true, message, data });

const ForumController = {
  list: async (req, res, next) => { try { return ok(res, await Service.list(req.user, req.query), 'Forum posts'); } catch (e) { return next(e); } },
  get: async (req, res, next) => { try { const data = await Service.get(req.user, req.params.id); return data ? ok(res, data, 'Forum post') : res.status(404).json({ success: false, message: 'Forum post not found' }); } catch (e) { return next(e); } },
  create: async (req, res, next) => { try { return ok(res, await Service.create(req.user, req.body), 'Forum post created', 201); } catch (e) { return next(e); } },
  remove: async (req, res, next) => { try { return ok(res, await Service.remove(req.user, req.params.id), 'Forum post deleted'); } catch (e) { return next(e); } },
  like: async (req, res, next) => { try { return ok(res, await Service.like(req.user, req.params.id), 'Like updated'); } catch (e) { return next(e); } },
  comment: async (req, res, next) => { try { return ok(res, await Service.comment(req.user, req.params.id, req.body), 'Comment added', 201); } catch (e) { return next(e); } },
  removeComment: async (req, res, next) => { try { return ok(res, await Service.removeComment(req.user, req.params.commentId), 'Comment deleted'); } catch (e) { return next(e); } },
};
module.exports = ForumController;
