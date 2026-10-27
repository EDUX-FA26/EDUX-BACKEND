const express = require('express');
const ctrl = require('./todos.controller');
const v = require('./todos.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { parseRequest, appErrorHandler } = require('../../middlewares/zodRequest.middleware');

const router = express.Router();

router.use(authenticate);

router.post('/', parseRequest({ body: v.createTodo }), ctrl.create);
router.get('/', parseRequest({ query: v.listQuery }), ctrl.list);

// Route tĩnh phải khai báo TRƯỚC '/:id'
router.get('/stats', ctrl.stats);
router.get('/study-plan-suggestions', parseRequest({ query: v.suggestionsQuery }), ctrl.suggestions);
router.post('/from-study-plan', parseRequest({ body: v.fromStudyPlan }), ctrl.createFromStudyPlan);

router.get('/:id', parseRequest({ params: v.idParams }), ctrl.getById);
router.patch('/:id', parseRequest({ params: v.idParams, body: v.updateTodo }), ctrl.update);
router.patch('/:id/status', parseRequest({ params: v.idParams, body: v.changeStatus }), ctrl.changeStatus);
router.delete('/:id', parseRequest({ params: v.idParams }), ctrl.remove);

router.use(appErrorHandler);

module.exports = router;

