const {
    makeStudyPlan7Days
} = require('./studyPlanner.core');

const LearningRepository = require('./learning.repository');
const StudyPlannerRepository = require('./studyPlanner.repository');

function getVietnamTodayDate() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const values = Object.fromEntries(
        parts
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    );

    return `${values.year}-${values.month}-${values.day}`;
}

function getStudyDate(startsOnStr, dayNumber) {
    const [y, m, d] = startsOnStr.split('-').map(Number);
    const utcDate = new Date(Date.UTC(y, m - 1, d + (dayNumber - 1)));
    const outY = utcDate.getUTCFullYear();
    const outM = String(utcDate.getUTCMonth() + 1).padStart(2, '0');
    const outD = String(utcDate.getUTCDate()).padStart(2, '0');
    return `${outY}-${outM}-${outD}`;
}

const StudyPlannerService = {
    async createPreview(analytics, studentId = null, schoolId = null) {
        let enrichedAnalytics = analytics;
        let auditTopics = [];

        if (studentId && analytics?.subjectId) {
            try {
                auditTopics = await LearningRepository.findApprovedReviewTopicsByStudent(
                    studentId,
                    analytics.subjectId,
                    schoolId
                );
            } catch (_) {
                auditTopics = [];
            }

            if (Array.isArray(analytics.topics)) {
                const topicIds = analytics.topics.map(t => t.topicId);
                const countsMap = await LearningRepository.findAccessibleCardCountsByTopics(
                    studentId,
                    analytics.subjectId,
                    schoolId,
                    topicIds
                );
                enrichedAnalytics = {
                    ...analytics,
                    topics: analytics.topics.map(t => ({
                        ...t,
                        accessibleCardCount: countsMap.get(t.topicId) ?? 0,
                    }))
                };
            }
        }

        const plan = makeStudyPlan7Days(enrichedAnalytics, { auditTopics, totalDays: 7 });
        const startsOn = getVietnamTodayDate();

        return {
            ...plan,
            startsOn,
            days: plan.days.map(day => ({
                ...day,
                studyDate: getStudyDate(startsOn, day.day)
            })),
            generatedAt: new Date().toISOString()
        };
    },

    async getMistakesPreview(analytics, studentId, schoolId = null) {
        let enrichedAnalytics = analytics;
        if (studentId && analytics?.subjectId && Array.isArray(analytics.topics)) {
            const topicIds = analytics.topics.map(t => t.topicId);
            const countsMap = await LearningRepository.findAccessibleCardCountsByTopics(
                studentId,
                analytics.subjectId,
                schoolId,
                topicIds
            );
            enrichedAnalytics = {
                ...analytics,
                topics: analytics.topics.map(t => ({
                    ...t,
                    accessibleCardCount: countsMap.get(t.topicId) ?? 0,
                }))
            };
        }

        const plan = makeStudyPlan7Days(enrichedAnalytics);

        // Lấy các Topic được xếp lịch ôn tập hoặc luyện tập
        const reviewTopics = new Map();

        for (const day of plan.days) {
            const isPracticeOrReview = day.activity === 'practice' || day.activity === 'review';
            if (isPracticeOrReview && !reviewTopics.has(day.topicId)) {
                reviewTopics.set(day.topicId, {
                    topicId: day.topicId,
                    topicName: day.topicName,
                    scheduledDays: [],
                    flashcards: []
                });
            }

            if (isPracticeOrReview) {
                reviewTopics
                    .get(day.topicId)
                    .scheduledDays.push(day.day);
            }
        }

        const topicIds = [...reviewTopics.keys()];

        const mistakes =
            await LearningRepository
                .findLatestIncorrectFlashcardsByTopic(
                    studentId,
                    analytics.subjectId,
                    topicIds,
                    schoolId
                );

        for (const mistake of mistakes) {
            const topic = reviewTopics.get(mistake.topicId);

            if (topic) {
                topic.flashcards.push({
                    flashcardId: mistake.flashcardId,
                    question: mistake.question,
                    difficulty: mistake.difficulty,
                    lastSubmittedAt: mistake.lastSubmittedAt
                });
            }
        }

        return {
            subjectId: analytics.subjectId,
            source: 'submitted_flashcard_tests',
            selectionMethod: 'latest_incorrect_answer',
            topics: [...reviewTopics.values()].map(topic => ({
                ...topic,
                sourceCount: topic.flashcards.length
            }))
        };
    },

    async generateForStudent(analytics, studentId, force = false, schoolId = null) {
        const startsOn = getVietnamTodayDate();

        // 1. Lấy danh sách Topic cần ôn được Giảng viên duyệt sau khi chấm bài
        let auditTopics = [];
        try {
            auditTopics = await LearningRepository.findApprovedReviewTopicsByStudent(
                studentId,
                analytics.subjectId,
                schoolId
            );
        } catch (_) {
            auditTopics = [];
        }

        // 2. Kiểm tra quyền truy cập học liệu và số lượng flashcard khả dụng của từng topic
        let enrichedAnalytics = analytics;
        if (analytics?.subjectId && Array.isArray(analytics.topics)) {
            const topicIds = analytics.topics.map(t => t.topicId);
            const countsMap = await LearningRepository.findAccessibleCardCountsByTopics(
                studentId,
                analytics.subjectId,
                schoolId,
                topicIds
            );

            enrichedAnalytics = {
                ...analytics,
                topics: analytics.topics.map(t => ({
                    ...t,
                    accessibleCardCount: countsMap.get(t.topicId) ?? 0,
                }))
            };
        }

        // 3. Kiểm tra xem sinh viên đã có kế hoạch đang active hay chưa
        const activePlan = await StudyPlannerRepository.getActivePlan(
            studentId,
            analytics.subjectId,
            schoolId
        );

        if (activePlan && Array.isArray(activePlan.days) && activePlan.days.length > 0) {
            const uncompletedDays = activePlan.days.filter(d => !d.isCompleted);

            // Nếu còn các ngày chưa nộp bài (1 <= K <= 7), tính toán lại các ngày chưa bắt đầu
            // và giữ nguyên các ngày đã hoàn thành để bảo toàn câu trả lời và kết quả
            if (uncompletedDays.length > 0) {
                const K = uncompletedDays.length;
                const partialPlan = makeStudyPlan7Days(enrichedAnalytics, {
                    auditTopics,
                    totalDays: K,
                    startDayNumber: 1,
                });

                const updatedDays = uncompletedDays.map((uncompletedDay, index) => {
                    const generatedDay = partialPlan.days[index];
                    return {
                        planDayId: uncompletedDay.planDayId,
                        dayNumber: uncompletedDay.day,
                        topicId: generatedDay.topicId,
                        activity: generatedDay.activity,
                        durationMinutes: generatedDay.durationMinutes,
                        targetQuestions: generatedDay.targetQuestions,
                        reason: generatedDay.reason,
                    };
                });

                await StudyPlannerRepository.updateUnsubmittedPlanDays({
                    planId: activePlan.planId,
                    updatedDays,
                    schoolId,
                });

                const refreshedPlan = await StudyPlannerRepository.getActivePlan(
                    studentId,
                    analytics.subjectId,
                    schoolId
                );

                return {
                    planId: refreshedPlan.planId,
                    subjectId: refreshedPlan.subjectId,
                    startsOn: refreshedPlan.startsOn,
                    durationDays: refreshedPlan.durationDays,
                    status: refreshedPlan.status,
                    created: false,
                    realigned: true,
                    completedDays: refreshedPlan.completedDays,
                    progressPercent: refreshedPlan.progressPercent,
                    days: refreshedPlan.days.map(day => ({
                        planDayId: day.planDayId,
                        day: day.day,
                        studyDate: day.studyDate,
                        topicId: day.topicId,
                        topicName: day.topicName,
                        topicCode: day.topicCode,
                        activity: day.activity,
                        durationMinutes: day.durationMinutes,
                        targetQuestions: day.targetQuestions,
                        reason: day.reason,
                        contentStatus: day.contentStatus,
                        isCompleted: day.isCompleted,
                        submission: day.submission,
                    })),
                };
            }
        }

        // 4. Nếu chưa có plan hoặc chu kỳ trước đã hoàn thành 100%, tạo kế hoạch mới đầy đủ 7 ngày
        const preview = makeStudyPlan7Days(enrichedAnalytics, { auditTopics, totalDays: 7 });

        const saved =
            await StudyPlannerRepository.createOrGetPlan({
                studentId,
                subjectId: analytics.subjectId,
                startsOn,
                analytics: enrichedAnalytics,
                days: preview.days,
                force,
                schoolId,
            });

        return {
            planId: saved.plan.id,
            subjectId: analytics.subjectId,
            startsOn,
            durationDays: 7,
            status: saved.plan.status,
            created: saved.created,
            realigned: false,
            days: saved.days.map(day => ({
                planDayId: day.id,
                day: day.day_number,
                studyDate: getStudyDate(startsOn, day.day_number),
                topicId: day.topic_id,
                activity: day.activity,
                durationMinutes: day.duration_minutes,
                targetQuestions: day.target_questions,
                reason: day.reason,
                contentStatus: day.content_status
            }))
        };
    },

    async getActivePlan(studentId, subjectId, schoolId = null) {
        return await StudyPlannerRepository.getActivePlan(studentId, subjectId, schoolId);
    },
};

module.exports = StudyPlannerService;
