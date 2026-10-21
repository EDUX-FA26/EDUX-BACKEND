
const Repository = require('./topicClassificationReview.repository');
const TopicsRepository = require('./topics.repository');
const {
    buildClassificationInput,
    hashClassificationInput
} = require('./topicClassificationHash');

function fail(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    throw error;
}

const ReviewService = {
    async review(flashcardId, data, user) {
        return Repository.transaction(async (client) => {
            const card = await Repository.getCard(client, flashcardId);

            if (!card || !card.is_active || !card.deck_is_active) {
                fail('FLASHCARD_NOT_FOUND', 404);
            }

            if (user.role !== 'admin') {
                if (user.role !== 'lecturer') {
                    fail('FORBIDDEN', 403);
                }

                const assigned =
                    await TopicsRepository.isLecturerAssignedToSubject(
                        user.id,
                        card.subject_id
                    );

                if (!assigned || card.created_by !== user.id) {
                    fail('FORBIDDEN', 403);
                }
            }

            const classification =
                await Repository.getClassification(client, flashcardId);

            if (!classification) {
                fail('CLASSIFICATION_NOT_FOUND', 404);
            }

            if (classification.status !== 'needs_review') {
                fail('CLASSIFICATION_NOT_PENDING', 409);
            }

            const topics = await Repository.getTopics(
                client,
                card.subject_id
            );

            const currentInput =
                buildClassificationInput(card, topics);

            const currentHash =
                hashClassificationInput(currentInput);

            if (classification.content_hash !== currentHash) {
                fail('CLASSIFICATION_STALE', 409);
            }

            const proposed = classification.result;

            if (!proposed || typeof proposed !== 'object' ||
                Array.isArray(proposed)) {
                fail('INVALID_CLASSIFICATION', 409);
            }

            let selectedTopicId = null;
            let mapping = null;

            if (data.action === 'approve') {
                selectedTopicId = proposed.topicId;

                if (!selectedTopicId) {
                    fail('NO_SUGGESTED_TOPIC', 400);
                }
            }

            if (data.action === 'change') {
                selectedTopicId = data.topicId;
            }

            if (selectedTopicId) {
                const topic = topics.find(
                    t => t.id === selectedTopicId
                );

                if (!topic) {
                    fail('INVALID_TOPIC', 400);
                }

                const protectedMapping =
                    await Repository.findProtectedMapping(
                        client,
                        flashcardId
                    );

                if (protectedMapping) {
                    fail('PROTECTED_MANUAL_MAPPING', 409);
                }

                mapping = await Repository.saveMapping(client, {
                    flashcardId,
                    topicId: selectedTopicId,
                    source: data.action === 'change'
                        ? 'lecturer'
                        : 'ai',
                    userId: user.id,
                    confidence: data.action === 'approve'
                        ? proposed.confidence
                        : null,
                    explanation: data.action === 'approve'
                        ? proposed.explanation
                        : null
                });

                if (!mapping) {
                    fail('PROTECTED_MANUAL_MAPPING', 409);
                }
            }

            const review = {
                action: data.action,
                topicId: selectedTopicId,
                reviewedBy: user.id,
                reviewedAt: new Date().toISOString()
            };

            await Repository.saveReview(client, {
                flashcardId,
                status: data.action === 'reject'
                    ? 'failed'
                    : 'classified',
                failureCode: data.action === 'reject'
                    ? 'REJECTED_BY_LECTURER'
                    : null,
                result: {
                    ...proposed,
                    review
                }
            });

            return {
                flashcardId,
                action: data.action,
                selectedTopicId,
                reviewStatus: data.action === 'reject'
                    ? 'rejected'
                    : 'approved',
                mapping
            };
        });
    }
};

module.exports = ReviewService;
