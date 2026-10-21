
const {
    makeStudyPlan7Days
} = require('./studyPlanner.core');

const LearningRepository = require('./learning.repository');
const StudyPlannerRepository = require('./studyPlanner.repository');

const StudyPlannerService = {
    createPreview(analytics) {
        const plan = makeStudyPlan7Days(analytics);

        return {
            ...plan,
            generatedAt: new Date().toISOString()
        };
    },

    async getMistakesPreview(analytics, studentId) {
        const plan = makeStudyPlan7Days(analytics);

        // Chỉ lấy các Topic được xếp lịch ôn tập.
        const reviewTopics = new Map();

        for (const day of plan.days) {
            if (
                day.activity === 'review' &&
                !reviewTopics.has(day.topicId)
            ) {
                reviewTopics.set(day.topicId, {
                    topicId: day.topicId,
                    topicName: day.topicName,
                    scheduledDays: [],
                    flashcards: []
                });
            }

            if (day.activity === 'review') {
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
                    topicIds
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


    async generateForStudent(analytics, studentId) {
        // Ngày bắt đầu theo múi giờ Việt Nam.
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

        const startsOn =
            `${values.year}-${values.month}-${values.day}`;

        const preview = makeStudyPlan7Days(analytics);

        const saved =
            await StudyPlannerRepository.createOrGetPlan({
                studentId,
                subjectId: analytics.subjectId,
                startsOn,
                analytics,
                days: preview.days
            });

        const startDate = new Date(
            `${startsOn}T00:00:00.000Z`
        );

        return {
            planId: saved.plan.id,
            subjectId: analytics.subjectId,
            startsOn,
            durationDays: 7,
            status: saved.plan.status,
            created: saved.created,
            days: saved.days.map(day => {
                const date = new Date(startDate);

                date.setUTCDate(
                    date.getUTCDate() + day.day_number - 1
                );

                return {
                    planDayId: day.id,
                    day: day.day_number,
                    studyDate: date.toISOString().slice(0, 10),
                    topicId: day.topic_id,
                    activity: day.activity,
                    durationMinutes: day.duration_minutes,
                    targetQuestions: day.target_questions,
                    reason: day.reason,
                    contentStatus: day.content_status
                };
            })
        };
    },

};

module.exports = StudyPlannerService;
module.exports = StudyPlannerService;
