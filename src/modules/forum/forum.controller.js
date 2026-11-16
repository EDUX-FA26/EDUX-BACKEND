const Service = require('./forum.service');
const ok = (res, data, message = 'OK', status = 200) => res.status(status).json({ success: true, message, data });
const scopedUser = (req) => ({ ...req.user, schoolId: req.tenant?.schoolId || null });

const ForumController = {
  schools: async (req, res, next) => { try { return ok(res, await Service.schools(scopedUser(req)), 'Available forum schools'); } catch (e) { return next(e); } },
  stats: async (req, res, next) => { try { const data = await Service.stats(scopedUser(req)); return data ? ok(res, data, 'Forum stats') : res.status(404).json({ success: false, message: 'User not found' }); } catch (e) { return next(e); } },
  list: async (req, res, next) => { try { return ok(res, await Service.list(scopedUser(req), req.query), 'Forum posts'); } catch (e) { return next(e); } },
  get: async (req, res, next) => { try { const data = await Service.get(scopedUser(req), req.params.id); return data ? ok(res, data, 'Forum post') : res.status(404).json({ success: false, message: 'Forum post not found' }); } catch (e) { return next(e); } },
  create: async (req, res, next) => { try { return ok(res, await Service.create(scopedUser(req), req.body), 'Forum post created', 201); } catch (e) { return next(e); } },
  update: async (req, res, next) => { try { return ok(res, await Service.update(scopedUser(req), req.params.id, req.body), 'Forum post updated'); } catch (e) { return next(e); } },
  remove: async (req, res, next) => { try { return ok(res, await Service.remove(scopedUser(req), req.params.id), 'Forum post deleted'); } catch (e) { return next(e); } },
  like: async (req, res, next) => { try { return ok(res, await Service.like(scopedUser(req), req.params.id), 'Like updated'); } catch (e) { return next(e); } },
  comment: async (req, res, next) => { try { return ok(res, await Service.comment(scopedUser(req), req.params.id, req.body), 'Comment added', 201); } catch (e) { return next(e); } },
  removeComment: async (req, res, next) => { try { return ok(res, await Service.removeComment(scopedUser(req), req.params.commentId), 'Comment deleted'); } catch (e) { return next(e); } },
};
module.exports = ForumController;
