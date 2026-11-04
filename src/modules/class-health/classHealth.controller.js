
const { validate: isUuid } = require('uuid');
const ClassHealthService = require('./classHealth.service');

const ClassHealthController = {
    async getSnapshot(req, res, next) {
        try {
            const { id: classId } = req.params;

            // Validate UUID
            if (!isUuid(classId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid class ID',
                });
            }

            const result = await ClassHealthService.getSnapshot(
                classId,
                req.user
            );

            return res.status(200).json({
                success: true,
                data: result,
            });
        } catch (error) {
            if (error.message === 'CLASS_NOT_FOUND') {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found',
                });
            }

            if (error.message === 'FORBIDDEN') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied',
                });
            }

            next(error);
        }
    },


    async sendBulkNotification(req, res, next) {
        try {
            const { id: classId } = req.params;

            if (!isUuid(classId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid class ID',
                });
            }

            const result =
                await ClassHealthService.sendBulkNotification(
                    classId,
                    req.user,
                    req.body
                );

            const requestedInApp =
                result.channel === 'in_app' ||
                result.channel === 'both';

            const requestedEmail =
                result.channel === 'email' ||
                result.channel === 'both';

            const allSucceeded =
                (!requestedInApp || result.inApp.status === 'success') &&
                (!requestedEmail || result.email.status === 'success');

            return res.status(200).json({
                success: true,
                message: allSucceeded
                    ? 'Bulk notification completed successfully'
                    : 'Bulk notification completed with delivery issues',
                data: result,
            });
        } catch (error) {
            if (error.message === 'CLASS_NOT_FOUND') {
                return res.status(404).json({
                    success: false,
                    message: 'Class not found',
                });
            }

            if (error.message === 'EMAIL_RECIPIENT_LIMIT_EXCEEDED') {
                return res.status(400).json({
                    success: false,
                    message: 'Maximum 20 email recipients per request',
                });
            }

            if (error.message === 'FORBIDDEN') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied',
                });
            }

            if (
                error.message === 'INVALID_NOTIFICATION_PAYLOAD' ||
                error.message === 'INVALID_RECIPIENTS'
            ) {
                return res.status(400).json({
                    success: false,
                    message: error.message,
                });
            }

            next(error);
        }
    },

};

module.exports = ClassHealthController;
