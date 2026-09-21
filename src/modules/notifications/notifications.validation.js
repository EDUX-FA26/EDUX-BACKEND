const { z } = require('zod');

const notificationsSchemas = {
  // Query params cho GET /api/notifications và GET /api/notifications/unread
  getNotificationsQuery: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).default('1'),
    limit: z.string().regex(/^\d+$/).transform(Number).default('20'),
  }),
};

module.exports = notificationsSchemas;
