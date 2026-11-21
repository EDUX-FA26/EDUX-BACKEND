
const SubmissionRepository =
    require('./studyPlannerSubmission.repository');

const ContentRepository =
    require('./studyPlannerContent.repository');

const LearningRepository =
    require('./learning.repository');

function makeError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

const StudyPlannerSubmissionService = {
    // Sinh viên mở bài ôn tập.
    async getDay(planDayId, studentId, schoolId = null) {
        const day = await ContentRepository.findDayForStudent(
            planDayId,
            studentId
        );

        if (!day) {
            throw makeError('PLAN_DAY_NOT_FOUND', 404);
        }

        const hasAccess =
            await LearningRepository.isStudentActiveInSubject(
                studentId,
                day.subjectId,
                schoolId
            );

        if (!hasAccess) {
            throw makeError('SUBJECT_ACCESS_FORBIDDEN', 403);
        }

        const submission =
            await SubmissionRepository.findSubmission(
                planDayId,
                studentId
            );

        // 1. Ngày đã hoàn thành (đã nộp bài): giữ nguyên kết quả, điểm số và câu hỏi lịch sử
        if (submission) {
            const questions = await ContentRepository.findPublicDayQuestions(planDayId);
            return {
                planDayId,
                day: day.day,
                topicId: day.topicId,
                topicName: day.topicName,
                activity: day.activity,
                contentStatus: day.contentStatus,
                targetQuestions: day.targetQuestions,
                questionCount: questions.length,
                submitted: true,
                questions,
            };
        }

        // 2. Ngày chưa làm: kiểm tra xem Topic có còn hoạt động và hợp lệ không
        const isTopicActive = await LearningRepository.isTopicActiveInSubject(
            day.topicId,
            day.subjectId,
            schoolId
        );

        if (!isTopicActive) {
            if (day.contentStatus !== 'unavailable') {
                await ContentRepository.markDayUnavailable(planDayId, studentId);
                day.contentStatus = 'unavailable';
            }
            return {
                planDayId,
                day: day.day,
                topicId: day.topicId,
                topicName: day.topicName,
                activity: day.activity,
                contentStatus: 'unavailable',
                targetQuestions: day.targetQuestions,
                questionCount: 0,
                submitted: false,
                questions: [],
            };
        }

        const questions = day.contentStatus === 'ready'
            ? await ContentRepository.findPublicDayQuestions(
                planDayId
            )
            : [];

        return {
            planDayId,
            day: day.day,
            topicId: day.topicId,
            topicName: day.topicName,
            activity: day.activity,
            contentStatus: day.contentStatus,
            targetQuestions: day.targetQuestions,
            questionCount: questions.length,
            submitted: false,
            questions,
        };
    },

    // Sinh viên nộp bài.
    async submitDay(planDayId, studentId, answers, schoolId = null) {
        const day = await ContentRepository.findDayForStudent(
            planDayId,
            studentId
        );

        if (!day) {
            throw makeError('PLAN_DAY_NOT_FOUND', 404);
        }

        const hasAccess =
            await LearningRepository.isStudentActiveInSubject(
                studentId,
                day.subjectId,
                schoolId
            );

        if (!hasAccess) {
            throw makeError('SUBJECT_ACCESS_FORBIDDEN', 403);
        }

        const submissionResult = await SubmissionRepository.submitDay(
            planDayId,
            studentId,
            answers,
            schoolId
        );

        // Đánh dấu topic review tương ứng (nếu có) là 'consumed' vì sinh viên đã hoàn thành ngày ôn tập
        try {
            await LearningRepository.markReviewTopicsConsumed(
                studentId,
                day.topicId,
                schoolId
            );
        } catch (err) {
            console.warn('[StudyPlannerSubmissionService] markReviewTopicsConsumed error:', err.message);
        }

        return submissionResult;
    },


    async getResult(planDayId, studentId, schoolId = null) {
        const day = await ContentRepository.findDayForStudent(
            planDayId,
            studentId
        );

        if (!day) {
            throw makeError('PLAN_DAY_NOT_FOUND', 404);
        }

        const hasAccess =
            await LearningRepository.isStudentActiveInSubject(
                studentId,
                day.subjectId,
                schoolId
            );

        if (!hasAccess) {
            throw makeError('SUBJECT_ACCESS_FORBIDDEN', 403);
        }

        const result =
            await SubmissionRepository.findSubmissionResult(
                planDayId,
                studentId
            );

        if (!result) {
            throw makeError('SUBMISSION_NOT_FOUND', 404);
        }

        return result;
    },

};

module.exports = StudyPlannerSubmissionService;
