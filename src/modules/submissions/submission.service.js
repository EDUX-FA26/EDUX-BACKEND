const { pool } = require('../../config/db.config');
const SubmissionRepository = require('./submission.repository');
const AssignmentRepository = require('../assignments/assignment.repository');
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, S3_BUCKET } = require('../../config/seaweed.config');
const { v4: uuidv4 } = require('uuid');
const { normalizeAuditData } = require('../../utils/aiAuditHelper');

const SubmissionService = {
  /**
   * Helper tải file lên S3
   */
  async uploadFilesToS3(assignmentId, userId, uploadedFiles) {
    const filesMeta = [];
    for (const file of uploadedFiles) {
      const fileId = uuidv4();
      const fileKey = `submissions/${assignmentId}/${userId}/${fileId}_${file.originalname}`;
      
      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: fileKey,
            Body: file.buffer,
            ContentType: file.mimetype,
          })
        );
      } catch (uploadError) {
        console.warn('⚠️ S3 Upload failed (SeaweedFS might be down). Continuing with DB insert for testing.', uploadError.message);
      }

      filesMeta.push({
        id: fileId,
        name: file.originalname,
        key: fileKey,
        type: file.mimetype,
        size: file.size,
        uploaded_at: new Date().toISOString()
      });
    }
    return filesMeta;
  },

  /**
   * Sinh viên lưu bản nháp (Save Draft)
   * - Bỏ qua kiểm tra deadline (hoặc lưu draft trước deadline mà chưa tính nộp muộn)
   * - Không bắt buộc hoàn thành đủ rubric AI hay bắt buộc có file ngay
   * - Nếu chưa có: tạo mới status = 'draft', latest_version_no = 1
   * - Nếu đã có status = 'draft': cập nhật trực tiếp version hiện tại mà không tăng major version
   */
  async saveDraft(assignmentId, user, uploadedFiles = [], body = {}) {
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

    // 2. Upload file lên S3 nếu có
    const filesMeta = await this.uploadFilesToS3(assignmentId, user.id, uploadedFiles);

    // Chuẩn bị note/declarations
    let draftNote = body.note || '';
    if (!draftNote && body.ai_declarations) {
      try {
        draftNote = typeof body.ai_declarations === 'string'
          ? body.ai_declarations
          : JSON.stringify({ declarations: body.ai_declarations });
      } catch (e) {
        draftNote = '';
      }
    }

    // 3. Transaction DB
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(assignmentId, user.id, client);
      let result;

      if (!existingSubmission) {
        // Tạo mới submission draft
        const submissionData = {
          id: uuidv4(),
          uuid: uuidv4(),
          assignment_id: assignmentId,
          student_id: user.id,
          status: 'draft'
        };
        const versionData = {
          files: filesMeta,
          note: draftNote
        };
        result = await SubmissionRepository.createSubmissionWithVersion(submissionData, versionData, client);
      } else {
        // Đã có submission
        const lockedStatuses = ['evaluated', 'reviewed', 'graded', 'flagged'];
        if (lockedStatuses.includes(existingSubmission.status)) {
          throw new Error('SUBMISSION_LOCKED');
        }

        const latestVer = await SubmissionRepository.findLatestVersion(existingSubmission.id);
        let currentFiles = [];
        if (latestVer?.files) {
          try {
            currentFiles = typeof latestVer.files === 'string' ? JSON.parse(latestVer.files) : latestVer.files;
          } catch (e) {
            currentFiles = [];
          }
        }

        let finalFiles = filesMeta.length > 0 ? filesMeta : currentFiles;
        if (body.clear_files === 'true' || body.clear_files === true) {
          finalFiles = [];
        }

        const finalNote = draftNote !== undefined ? draftNote : (latestVer?.note || '');

        if (existingSubmission.status === 'draft') {
          // Update trực tiếp draft hiện tại, không tăng version
          result = await SubmissionRepository.updateDraftSubmission(
            existingSubmission.id,
            latestVer.id,
            finalFiles,
            finalNote,
            client
          );
        } else {
          // Bài đã từng nộp chính thức, lưu cập nhật dở dang vào version hiện tại
          result = await SubmissionRepository.updateDraftSubmission(
            existingSubmission.id,
            latestVer.id,
            finalFiles,
            finalNote,
            client
          );
        }
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
   * Sinh viên nộp bài chính thức (Submit Final)
   * - Kiểm tra deadline (hoặc allow_late_submission)
   * - Bắt buộc kiểm tra file hợp lệ và khai báo AI (nếu yêu cầu)
   * - Đóng băng version, chốt status = 'submitted' hoặc 'late', submitted_at = NOW()
   */
  async submitFinal(assignmentId, user, uploadedFiles = [], body = {}) {
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

    // 2. Kiểm tra deadline
    const now = new Date();
    const deadline = new Date(assignment.deadline);
    let status = 'submitted';

    if (now > deadline) {
      if (!assignment.allow_late_submission) {
        throw new Error('DEADLINE_PASSED_AND_LATE_SUBMISSION_NOT_ALLOWED');
      }
      status = 'late';
    }

    // 3. Upload files mới lên S3 (nếu có)
    const filesMeta = await this.uploadFilesToS3(assignmentId, user.id, uploadedFiles);

    // 4. Transaction lưu DB và kiểm tra ràng buộc hoàn tất
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(assignmentId, user.id, client);

      // Xác định file có hiệu lực (từ file vừa tải lên hoặc từ version trước đó)
      let effectiveFiles = filesMeta;
      let existingLatestVer = null;

      if (existingSubmission) {
        existingLatestVer = await SubmissionRepository.findLatestVersion(existingSubmission.id);
        if (filesMeta.length === 0 && existingLatestVer?.files) {
          try {
            effectiveFiles = typeof existingLatestVer.files === 'string'
              ? JSON.parse(existingLatestVer.files)
              : existingLatestVer.files;
          } catch (e) {
            effectiveFiles = [];
          }
        }
      }

      // Xác định note có hiệu lực
      let effectiveNote = body.note || '';
      if (!effectiveNote && body.ai_declarations) {
        try {
          effectiveNote = typeof body.ai_declarations === 'string'
            ? body.ai_declarations
            : JSON.stringify({ declarations: body.ai_declarations });
        } catch (e) {
          effectiveNote = '';
        }
      }
      if (!effectiveNote && existingLatestVer?.note) {
        effectiveNote = existingLatestVer.note;
      }

      // 4.1. Kiểm tra nội dung bài nộp (không được để trống cả file lẫn ghi chú)
      const hasFiles = Boolean(effectiveFiles && effectiveFiles.length > 0);
      const hasNote = Boolean(effectiveNote && effectiveNote.trim().length > 0);
      if (!hasFiles && !hasNote) {
        throw new Error('SUBMISSION_EMPTY_CONTENT');
      }

      // 4.2. Kiểm tra yêu cầu khai báo AI Audit Log nếu được bật
      if (assignment.ai_declaration_required) {
        const auditData = normalizeAuditData(effectiveNote);
        let validCount = 0;
        if (auditData && Array.isArray(auditData.scopes)) {
          for (const scope of auditData.scopes) {
            if (scope && scope.declarations) {
              for (const key of Object.keys(scope.declarations)) {
                const item = scope.declarations[key];
                const prompt = (item.prompt || item.prompt_used || '').trim();
                const response = (item.response || item.responseSummary || '').trim();
                const reflection = (item.reflection || item.studentReflection || '').trim();
                if (prompt.length > 0 && response.length > 0 && reflection.length > 0) {
                  validCount++;
                }
              }
            }
          }
        }

        const minRequired = (assignment.min_ai_interactions != null && Number(assignment.min_ai_interactions) > 0)
          ? Number(assignment.min_ai_interactions)
          : 1;
        if (validCount < minRequired) {
          throw new Error(`AI_DECLARATION_REQUIRED: Bài tập yêu cầu khai báo AI Audit Log tối thiểu ${minRequired} lượt tương tác hợp lệ (hiện có: ${validCount})`);
        }
      }

      let result;

      if (!existingSubmission) {
        // Chưa có submission: Tạo mới trực tiếp ở trạng thái submitted / late
        const submissionData = {
          id: uuidv4(),
          uuid: uuidv4(),
          assignment_id: assignmentId,
          student_id: user.id,
          status
        };
        const versionData = {
          files: effectiveFiles,
          note: effectiveNote,
          status
        };
        result = await SubmissionRepository.createSubmissionWithVersion(submissionData, versionData, client);
      } else if (existingSubmission.status === 'draft') {
        // Đang ở trạng thái DRAFT: Đóng băng và chuyển sang submitted / late
        result = await SubmissionRepository.finalizeDraftSubmission(
          existingSubmission.id,
          existingLatestVer.id,
          status,
          effectiveFiles,
          effectiveNote,
          client
        );
      } else {
        // Đã từng nộp trước đó: Resubmit tạo version mới
        const versionData = {
          files: effectiveFiles,
          note: effectiveNote,
          status: (status === 'late' ? 'late' : 'resubmitted')
        };
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
   * Sinh viên nộp bài / nộp lại bài / lưu bản nháp
   * Tự động điều hướng theo query hoặc body is_draft
   */
  async submitAssignment(assignmentId, user, uploadedFiles, body = {}) {
    const isDraft = body.is_draft === true || body.is_draft === 'true';
    if (isDraft) {
      return await this.saveDraft(assignmentId, user, uploadedFiles, body);
    }
    return await this.submitFinal(assignmentId, user, uploadedFiles, body);
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
    
    // Giảng viên / Admin: Tuyệt đối không nhìn thấy bài đang ở trạng thái draft
    if (user.role === 'lecturer' || user.role === 'admin') {
      if (submission.status === 'draft') {
        throw new Error('SUBMISSION_NOT_FOUND');
      }

      if (user.role === 'lecturer') {
        const assignment = await AssignmentRepository.findById(submission.assignment_id);
        if (assignment.lecturer_id !== user.id) {
          throw new Error('FORBIDDEN');
        }
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

    // Không thể đánh giá bài nháp
    if (submission.status === 'draft') {
      throw new Error('SUBMISSION_NOT_FOUND');
    }

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

    // Giảng viên không được tải file từ bài nháp
    if (user.role === 'lecturer' || user.role === 'admin') {
      if (submission.status === 'draft') {
        throw new Error('SUBMISSION_NOT_FOUND');
      }

      if (user.role === 'lecturer') {
        const assignment = await AssignmentRepository.findById(submission.assignment_id);
        if (assignment.lecturer_id !== user.id) {
          throw new Error('FORBIDDEN');
        }
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
  },

  /**
   * Lấy chi tiết bài nộp của student cho 1 assignment cụ thể (kể cả draft)
   */
  async getStudentSubmissionForAssignment(assignmentId, studentId) {
    const sub = await SubmissionRepository.findByAssignmentAndStudent(assignmentId, studentId);
    if (!sub) return null;
    return await SubmissionRepository.findById(sub.id, true);
  }
};

module.exports = SubmissionService;
