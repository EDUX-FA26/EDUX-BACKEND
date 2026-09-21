const { pool } = require('../../config/db.config');
const SubmissionRepository = require('./submission.repository');
const AssignmentRepository = require('../assignments/assignment.repository');
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, S3_BUCKET } = require('../../config/seaweed.config');
const { v4: uuidv4 } = require('uuid');

const SubmissionService = {
  /**
   * Sinh viên nộp bài / nộp lại bài
   */
  async submitAssignment(assignmentId, user, uploadedFiles, body) {
    if (user.role !== 'student') {
      throw new Error('ONLY_STUDENT_CAN_SUBMIT');
    }

    // 1. Kiểm tra assignment và enrollment
    const assignment = await AssignmentRepository.findById(assignmentId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
      [assignment.class_id, user.id]
    );
    if (!memberRows.length) throw new Error('NOT_ENROLLED_IN_CLASS');

    // 2. Check deadline
    const now = new Date();
    const deadline = new Date(assignment.deadline);
    let status = 'submitted';

    if (now > deadline) {
      if (!assignment.allow_late_submission) {
        throw new Error('DEADLINE_PASSED_AND_LATE_SUBMISSION_NOT_ALLOWED');
      }
      status = 'late';
    }

    // 3. Upload files lên S3
    const filesMeta = [];
    for (const file of uploadedFiles) {
      const fileId = uuidv4();
      const fileKey = `submissions/${assignmentId}/${user.id}/${fileId}_${file.originalname}`;
      
      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );

      filesMeta.push({
        id: fileId,
        name: file.originalname,
        key: fileKey,
        type: file.mimetype,
        size: file.size,
        uploaded_at: new Date().toISOString()
      });
    }

    const versionData = {
      files: filesMeta,
      note: body.note || '',
      status
    };

    // 4. Transaction lưu DB
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      let existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(assignmentId, user.id, client);
      let result;

      if (!existingSubmission) {
        const submissionData = {
          id: uuidv4(),
          uuid: uuidv4(),
          assignment_id: assignmentId,
          student_id: user.id,
          status
        };
        result = await SubmissionRepository.createSubmissionWithVersion(submissionData, versionData, client);
      } else {
        // Resubmit
        result = await SubmissionRepository.addSubmissionVersion(existingSubmission.id, versionData, client);
      }

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Sinh viên xóa 1 file trong version hiện tại
   */
  async deleteSubmissionFile(submissionId, fileId, user) {
    if (user.role !== 'student') throw new Error('ONLY_STUDENT_CAN_DELETE');

    const submission = await SubmissionRepository.findById(submissionId, false);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');
    if (submission.student_id !== user.id) throw new Error('FORBIDDEN');

    // Không cho xóa nếu bài đã chấm hoặc bị khoá
    const lockedStatuses = ['evaluated', 'reviewed', 'graded', 'flagged'];
    if (lockedStatuses.includes(submission.status)) {
      throw new Error('SUBMISSION_LOCKED');
    }

    const latestVersion = submission.versions[0];
    if (!latestVersion) throw new Error('VERSION_NOT_FOUND');

    const files = typeof latestVersion.files === 'string' ? JSON.parse(latestVersion.files) : latestVersion.files;
    const fileIndex = files.findIndex(f => f.id === fileId);
    
    if (fileIndex === -1) throw new Error('FILE_NOT_FOUND');
    const fileToDelete = files[fileIndex];

    // Xóa khỏi S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: fileToDelete.key,
      })
    );

    // Cập nhật DB
    files.splice(fileIndex, 1);
    const updatedVersion = await SubmissionRepository.updateVersionFiles(latestVersion.id, files);
    
    return updatedVersion;
  },

  /**
   * Lấy chi tiết bài nộp
   */
  async getSubmissionById(submissionId, includeHistory, user) {
    const submission = await SubmissionRepository.findById(submissionId, includeHistory);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    // Phân quyền
    if (user.role === 'student' && submission.student_id !== user.id) {
      throw new Error('FORBIDDEN');
    }
    
    if (user.role === 'lecturer') {
      const assignment = await AssignmentRepository.findById(submission.assignment_id);
      if (assignment.lecturer_id !== user.id) {
        throw new Error('FORBIDDEN');
      }
    }

    return submission;
  },

  /**
   * Giảng viên/Admin đánh giá bài nộp
   */
  async reviewSubmission(submissionId, body, user) {
    if (user.role !== 'lecturer' && user.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const submission = await SubmissionRepository.findById(submissionId, false);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    if (user.role === 'lecturer') {
      const assignment = await AssignmentRepository.findById(submission.assignment_id);
      if (assignment.lecturer_id !== user.id) {
        throw new Error('FORBIDDEN');
      }
    }

    const updated = await SubmissionRepository.updateStatus(submissionId, body.status, body.feedback);
    return updated;
  },

  /**
   * Tải xuống hoặc xem 1 file
   */
  async getSubmissionFile(submissionId, fileId, user) {
    const submission = await SubmissionRepository.findById(submissionId, true);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    if (user.role === 'student' && submission.student_id !== user.id) {
      throw new Error('FORBIDDEN');
    }

    if (user.role === 'lecturer') {
      const assignment = await AssignmentRepository.findById(submission.assignment_id);
      if (assignment.lecturer_id !== user.id) {
        throw new Error('FORBIDDEN');
      }
    }

    // Tìm file trong toàn bộ versions (vì có thể file ở version cũ)
    let foundFile = null;
    for (const version of submission.versions) {
      const files = typeof version.files === 'string' ? JSON.parse(version.files) : version.files;
      const f = files.find(x => x.id === fileId);
      if (f) {
        foundFile = f;
        break;
      }
    }

    if (!foundFile) throw new Error('FILE_NOT_FOUND');

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: foundFile.key,
      ResponseContentDisposition: `attachment; filename="${foundFile.name}"`,
    });

    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    return {
      url: presignedUrl,
      file_name: foundFile.name,
      file_type: foundFile.type,
      file_size: foundFile.size,
    };
  },

  /**
   * Giảng viên xem danh sách bài nộp của lớp
   */
  async getAssignmentSubmissions(assignmentId, query, user) {
    if (user.role !== 'lecturer' && user.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    if (user.role === 'lecturer') {
      const assignment = await AssignmentRepository.findById(assignmentId);
      if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
      if (assignment.lecturer_id !== user.id) {
        throw new Error('FORBIDDEN');
      }
    }

    return await SubmissionRepository.findManyByAssignmentId(assignmentId, query);
  },
  
  /**
   * Lấy danh sách bài nộp của student hiện tại
   */
  async getMySubmissions(studentId, query) {
    return await SubmissionRepository.findMySubmissions(studentId, query);
  }
};

module.exports = SubmissionService;