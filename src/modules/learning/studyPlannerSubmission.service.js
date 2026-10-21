
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
    async getDay(planDayId, studentId) {
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
                day.subjectId
            );

        if (!hasAccess) {
            throw makeError('SUBJECT_ACCESS_FORBIDDEN', 403);
        }

        const questions = day.contentStatus === 'ready'
            ? await ContentRepository.findPublicDayQuestions(
                planDayId
            )
            : [];

        const submission =
            await SubmissionRepository.findSubmission(
                planDayId,
                studentId
            );

        return {
            planDayId,
            day: day.day,
            topicId: day.topicId,
            topicName: day.topicName,
            activity: day.activity,
            contentStatus: day.contentStatus,
            targetQuestions: day.targetQuestions,
            questionCount: questions.length,
            submitted: Boolean(submission),
            questions
        };
    },

    // Sinh viên nộp bài.
    async submitDay(planDayId, studentId, answers) {
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
                day.subjectId
            );

        if (!hasAccess) {
            throw makeError('SUBJECT_ACCESS_FORBIDDEN', 403);
        }

        return SubmissionRepository.submitDay(
            planDayId,
            studentId,
            answers
        );
    },


    async getResult(planDayId, studentId) {
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
                day.subjectId
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
