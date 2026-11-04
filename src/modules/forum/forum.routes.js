const router = require('express').Router();
const controller = require('./forum.controller');
const { authenticate } = require('../../middlewares/auth.middleware');

router.use(authenticate);
router.get('/stats/me', controller.stats);
router.get('/posts', controller.list);
router.get('/posts/:id', controller.get);
router.post('/posts', controller.create);
router.delete('/posts/:id', controller.remove);
router.post('/posts/:id/like', controller.like);
router.post('/posts/:id/comments', controller.comment);
router.delete('/comments/:commentId', controller.removeComment);

module.exports = router;
