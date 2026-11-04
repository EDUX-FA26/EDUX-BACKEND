
const ClassesService = require('../classes/classes.service');
const Repository = require('./classHealth.repository');
const NotificationsRepository = require(
    '../notifications/notifications.repository'
);
const EmailService = require('../../config/email.config');
const {
    emitCreatedNotifications,
} = require('../notifications/notifications.realtime');
const { validate: isUuid } = require('uuid');
function calculateRisk(student, streak, quiz, assignment) {
    const active7 = Number(streak?.active_days_7d || 0);
    const previous7 = Number(streak?.active_days_previous_7d || 0);

    const completedTests = Number(quiz?.completed_tests || 0);
    const recentTests = Number(quiz?.recent_test_count || 0);
    const lowTests = Number(quiz?.low_recent_tests || 0);

    const totalDue = Number(assignment?.total_due || 0);
    const overdue = Number(assignment?.overdue_count || 0);
    const late = Number(assignment?.late_count || 0);

    // Không tự gán nguy cơ thấp khi chưa đủ bằng chứng.
    // Các ngưỡng này là cấu hình thử nghiệm v1.
    const hasStreakData =
        Boolean(student.lastActivityDate) ||
        Boolean(streak?.last_activity_date) ||
        active7 > 0 ||
        previous7 > 0;

    const hasQuizData = completedTests >= 3;
    const hasAssignmentData = totalDue > 0;

    const riskFactors = {
        streak: {
            activeDays7d: active7,
            previousActiveDays7d: previous7,
            currentStreak: student.currentStreak,
            streakStatus: student.streakStatus,
        },
        quiz: {
            completedTests,
            recentTestCount: recentTests,
            recentAccuracy: quiz?.recent_accuracy === null ||
                quiz?.recent_accuracy === undefined
                ? null
                : Number(quiz.recent_accuracy),
            lowRecentTests: lowTests,
        },
        assignment: {
            totalDue,
            submitted: Number(assignment?.submitted_count || 0),
            overdue,
            late,
        },
    };


    const missingSignals = [];

    if (!hasStreakData) {
        missingSignals.push('streak');
    }

    if (!hasQuizData) {
        missingSignals.push('quiz');
    }

    if (!hasAssignmentData) {
        missingSignals.push('assignment');
    }

    // Early warnings dựa trên dữ liệu đã xác nhận
    const earlyWarnings = [];

    if (hasStreakData && active7 === 0) {
        earlyWarnings.push({
            type: 'no_recent_activity',
            severity: 'warning',
            message: 'No learning activity recorded in the last 7 days',
        });
    }

    if (
        hasStreakData &&
        previous7 >= 3 &&
        active7 <= previous7 / 2
    ) {
        earlyWarnings.push({
            type: 'activity_decline',
            severity: 'warning',
            message: 'Learning activity decreased significantly',
        });
    }

    if (hasAssignmentData && overdue > 0) {
        earlyWarnings.push({
            type: 'overdue_assignment',
            severity: 'warning',
            message: `${overdue} overdue assignment(s)`,
        });
    }

    if (hasQuizData && recentTests >= 3 && lowTests === 3) {
        earlyWarnings.push({
            type: 'low_quiz_performance',
            severity: 'warning',
            message: 'Low accuracy in the last 3 quizzes',
        });
    }

    if (missingSignals.length > 0) {
        return {
            riskScore: null,
            riskLevel: 'insufficient_data',
            riskFactors,
            reasons: earlyWarnings.map(w => w.message),
            earlyWarnings,
            missingSignals,
        };
    }


    let streakScore = 0;
    let quizScore = 0;
    let assignmentScore = 0;

    const reasons = [];

    // Streak: tối đa 30 điểm
    if (previous7 >= 3 && active7 <= previous7 / 2) {
        streakScore += 20;
        reasons.push('Learning activity decreased significantly');
    }

    if (active7 === 0) {
        streakScore += 10;
        reasons.push('No learning activity in the last 7 days');
    }

    // Quiz: tối đa 30 điểm
    if (recentTests >= 3 && lowTests === 3) {
        quizScore = 30;
        reasons.push('Low accuracy in the last 3 quizzes');
    } else if (
        quiz?.recent_accuracy !== null &&
        quiz?.recent_accuracy !== undefined &&
        Number(quiz.recent_accuracy) < 60
    ) {
        quizScore = 20;
        reasons.push('Recent quiz accuracy is below 60%');
    }

    // Assignment: tối đa 40 điểm
    assignmentScore = Math.min(
        40,
        Math.min(30, overdue * 15) + Math.min(10, late * 5)
    );

    if (overdue > 0) {
        reasons.push(`${overdue} overdue assignments`);
    }

    if (late > 0) {
        reasons.push(`${late} late submissions`);
    }

    const riskScore = Math.min(
        100,
        streakScore + quizScore + assignmentScore
    );

    const riskLevel =
        riskScore >= 70
            ? 'high'
            : riskScore >= 40
                ? 'medium'
                : 'low';

    return {
        riskScore,
        riskLevel,
        riskFactors,
        reasons,
        earlyWarnings,
        missingSignals: [],
    };
}


function buildClassHealthMessage({
    studentName,
    classCode,
    subjectName,
    subjectCode,
    lecturerName,
    semesterName,
    title,
    message,
}) {
    const notificationTitle =
        `[EduX] ${title} - ${subjectCode} - ${classCode}`;

    const notificationMessage = [
        `Chào ${studentName || 'bạn'},`,
        '',
        `Bạn có thông báo từ giảng viên phụ trách lớp học:`,
        '',
        `Môn học: ${subjectName}`,
        `Mã môn: ${subjectCode}`,
        `Lớp: ${classCode}`,
        `Học kỳ: ${semesterName}`,
        `Giảng viên: ${lecturerName}`,
        '',
        `${title}`,
        '',
        message,
        '',
        'Trân trọng,',
        `Giảng viên ${lecturerName}`,
        'EduX Learning System',
    ].join('\n');

    return {
        title: notificationTitle,
        message: notificationMessage,
    };
}


const ClassHealthService = {
    async getSnapshot(classId, user) {
        // Verify access to this class.
        await ClassesService.getClassById(classId, user);

        const [
            members,
            streakRows,
            quizRows,
            assignmentRows,
        ] = await Promise.all([
            ClassesService.getMembers(classId, user),
            Repository.getStreakSignals(classId),
            Repository.getQuizSignals(classId),
            Repository.getAssignmentSignals(classId),
        ]);

        const streakMap = new Map(
            streakRows.map(row => [row.student_id, row])
        );

        const quizMap = new Map(
            quizRows.map(row => [row.student_id, row])
        );

        const assignmentMap = new Map(
            assignmentRows.map(row => [row.student_id, row])
        );

        const students = members
            .filter(member => member.membershipStatus === 'active')
            .map(member => {
                const risk = calculateRisk(
                    member,
                    streakMap.get(member.studentId),
                    quizMap.get(member.studentId),
                    assignmentMap.get(member.studentId)
                );

                return {
                    studentId: member.studentId,
                    studentCode: member.studentCode,
                    fullName: member.fullName,
                    email: member.email,
                    membershipStatus: member.membershipStatus,
                    currentStreak: member.currentStreak,
                    longestStreak: member.longestStreak,
                    lastActivityDate: member.lastActivityDate,
                    streakStatus: member.streakStatus,
                    ...risk,
                };
            });

        const countLevel = level =>
            students.filter(s => s.riskLevel === level).length;

        return {
            classId,
            summary: {
                totalStudents: students.length,
                highRisk: countLevel('high'),
                mediumRisk: countLevel('medium'),
                lowRisk: countLevel('low'),
                insufficientData: countLevel('insufficient_data'),
            },
            students,
        };
    },



    async sendBulkNotification(classId, user, payload) {
        // 1. Xác thực quyền giảng viên
        if (!['admin', 'lecturer'].includes(user?.role)) {
            throw new Error('FORBIDDEN');
        }

        const classData = await ClassesService.getClassById(
            classId,
            user
        );

        const classCode = classData.class_code;
        const subjectName = classData.subject_name;
        const subjectCode = classData.subject_code;
        const lecturerName = classData.lecturer_name;
        const semesterName = classData.semester_name;

        const {
            studentIds,
            title,
            message,
            channel = 'in_app',
        } = payload || {};

        // 2. Validate dữ liệu
        if (
            !Array.isArray(studentIds) ||
            studentIds.length === 0 ||
            studentIds.length > 100 ||
            studentIds.some(
                id => typeof id !== 'string' || !isUuid(id)
            ) ||
            !['in_app', 'email', 'both'].includes(channel) ||
            typeof title !== 'string' ||
            typeof message !== 'string' ||
            !title.trim() ||
            !message.trim() ||
            title.trim().length > 200 ||
            message.trim().length > 5000
        ) {
            throw new Error('INVALID_NOTIFICATION_PAYLOAD');
        }

        const uniqueStudentIds = [...new Set(studentIds)];

        // Giới hạn 20 email mỗi request cho phiên bản SMTP trực tiếp
        if (
            channel !== 'in_app' &&
            uniqueStudentIds.length > 20
        ) {
            throw new Error('EMAIL_RECIPIENT_LIMIT_EXCEEDED');
        }

        // 3. Kiểm tra sinh viên thực sự thuộc lớp
        const members = await ClassesService.getMembers(classId, user);

        const activeMembers = new Map(
            members
                .filter(m => m.membershipStatus === 'active')
                .map(m => [m.studentId, m])
        );

        if (
            uniqueStudentIds.some(id => !activeMembers.has(id))
        ) {
            throw new Error('INVALID_RECIPIENTS');
        }

        const recipients = uniqueStudentIds.map(
            id => activeMembers.get(id)
        );

        // 4. Chuẩn bị kết quả độc lập cho từng kênh
        const result = {
            classId,
            channel,
            requestedCount: recipients.length,
            inApp: {
                status: 'skipped',
                created: 0,
            },
            email: {
                status: 'skipped',
                accepted: 0,
                failed: 0,
                skipped: 0,
                failedStudentIds: [],
                skippedStudentIds: [],
            },
        };

        // ==========================================
        // 5. GỬI IN-APP NOTIFICATION
        // ==========================================
        if (channel === 'in_app' || channel === 'both') {

            const notifications = recipients.map(student => {
                const content = buildClassHealthMessage({
                    studentName: student.fullName,
                    classCode,
                    subjectName,
                    subjectCode,
                    lecturerName,
                    semesterName,
                    title: title.trim(),
                    message: message.trim(),
                });

                return {
                    userId: student.studentId,
                    title: content.title,
                    message: content.message,
                    type: 'system_announcement',
                    related_entity_type: 'class',
                    related_entity_id: classId,
                };
            });


            const createdNotifications =
                await NotificationsRepository.bulkCreate(notifications);

            result.inApp.created = createdNotifications.length;
            result.inApp.status =
                createdNotifications.length === recipients.length
                    ? 'success'
                    : 'partial';

            // Realtime dùng helper chung với Admin
            try {
                emitCreatedNotifications(createdNotifications);
            } catch (error) {
                console.error(
                    '[CLASS HEALTH REALTIME]',
                    error.message
                );
            }
        }

        // ==========================================
        // 6. GỬI EMAIL
        // ==========================================
        if (channel === 'email' || channel === 'both') {
            for (const student of recipients) {
                const recipientEmail =
                    typeof student.email === 'string'
                        ? student.email.trim()
                        : '';

                // Sinh viên chưa có email
                if (!recipientEmail) {
                    result.email.skipped += 1;
                    result.email.skippedStudentIds.push(
                        student.studentId
                    );
                    continue;
                }

                try {

                    const content = buildClassHealthMessage({
                        studentName: student.fullName,
                        classCode,
                        subjectName,
                        subjectCode,
                        lecturerName,
                        semesterName,
                        title: title.trim(),
                        message: message.trim(),
                    });

                    await EmailService.sendEmail({
                        to: recipientEmail,
                        subject: content.title,
                        message: content.message,
                    });


                    result.email.accepted += 1;
                } catch (error) {
                    result.email.failed += 1;
                    result.email.failedStudentIds.push(
                        student.studentId
                    );

                    console.error('[CLASS HEALTH EMAIL]', {
                        classId,
                        studentId: student.studentId,
                        error: error.code || error.message,
                    });
                }
            }

            if (result.email.accepted === recipients.length) {
                result.email.status = 'success';
            } else if (result.email.accepted > 0) {
                result.email.status = 'partial';
            } else {
                result.email.status = 'failed';
            }
        }

        return result;
    },


};

module.exports = ClassHealthService;
