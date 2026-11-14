const { pool } = require('../../config/db.config');
const SubmissionRepository = require('./submission.repository');
const AssignmentRepository = require('../assignments/assignment.repository');
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, S3_BUCKET } = require('../../config/seaweed.config');
const { v4: uuidv4 } = require('uuid');
const { normalizeAuditData } = require('../../utils/aiAuditHelper');
const { preSubmissionSanityCheckWithGemini } = require('../../config/gemini.config');

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
        console.error(
          '[SUBMISSION_UPLOAD_FAILED]',
          uploadError
        );

        const error = new Error('SUBMISSION_FILE_UPLOAD_FAILED');
        error.status = 503;
        throw error;
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
  async saveDraft(assignmentId, tenant, uploadedFiles = [], body = {}) {
    if (tenant.role !== 'student') {
      throw new Error('ONLY_STUDENT_CAN_SUBMIT');
    }

    // 1. Kiểm tra assignment và enrollment trong trường hiện tại
    const assignment = await AssignmentRepository.findById(assignmentId, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
      [assignment.class_id, tenant.userId, tenant.schoolId]
    );
    if (!memberRows.length) throw new Error('NOT_ENROLLED_IN_CLASS');

    // 2. Upload file lên S3 nếu có
    const filesMeta = await this.uploadFilesToS3(assignmentId, tenant.userId, uploadedFiles);

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

      const existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(
        assignmentId,
        tenant.userId,
        tenant.schoolId,
        client
      );
      let result;

      if (!existingSubmission) {
        // Tạo mới submission draft
        const submissionData = {
          id: uuidv4(),
          uuid: uuidv4(),
          school_id: tenant.schoolId,
          assignment_id: assignmentId,
          student_id: tenant.userId,
          status: 'draft'
        };
        const versionData = {
          files: filesMeta,
          note: draftNote
        };
        result = await SubmissionRepository.createSubmissionWithVersion(submissionData, versionData, client);
      } else {
        // Đã có submission
        if (existingSubmission.status !== 'draft') {
          throw new Error('SUBMISSION_LOCKED');
        }

        const latestVer = await SubmissionRepository.findLatestVersion(existingSubmission.id, tenant.schoolId, client);
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

        result = await SubmissionRepository.updateDraftSubmission(
          existingSubmission.id,
          latestVer.id,
          tenant.schoolId,
          finalFiles,
          finalNote,
          client
        );
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
  async submitFinal(assignmentId, tenant, uploadedFiles = [], body = {}) {
    if (tenant.role !== 'student') {
      throw new Error('ONLY_STUDENT_CAN_SUBMIT');
    }

    // 1. Kiểm tra assignment và enrollment trong trường hiện tại
    const assignment = await AssignmentRepository.findById(assignmentId, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
      [assignment.class_id, tenant.userId, tenant.schoolId]
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
    const filesMeta = await this.uploadFilesToS3(assignmentId, tenant.userId, uploadedFiles);

    // 4. Transaction lưu DB và kiểm tra ràng buộc hoàn tất
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(
        assignmentId,
        tenant.userId,
        tenant.schoolId,
        client
      );

      // Xác định file có hiệu lực (từ file vừa tải lên hoặc từ version trước đó)
      let effectiveFiles = filesMeta;
      let existingLatestVer = null;

      if (existingSubmission) {
        existingLatestVer = await SubmissionRepository.findLatestVersion(existingSubmission.id, tenant.schoolId, client);
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
          school_id: tenant.schoolId,
          assignment_id: assignmentId,
          student_id: tenant.userId,
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
          tenant.schoolId,
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
        result = await SubmissionRepository.addSubmissionVersion(existingSubmission.id, tenant.schoolId, versionData, client);
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
  async submitAssignment(assignmentId, tenant, uploadedFiles, body = {}) {
    const isDraft = body.is_draft === true || body.is_draft === 'true';
    if (isDraft) {
      return await this.saveDraft(assignmentId, tenant, uploadedFiles, body);
    }
    return await this.submitFinal(assignmentId, tenant, uploadedFiles, body);
  },

  /**
   * Sinh viên xóa 1 file trong version hiện tại
   */
  async deleteSubmissionFile(submissionId, fileId, tenant) {
    if (tenant.role !== 'student') throw new Error('ONLY_STUDENT_CAN_DELETE');

    const submission = await SubmissionRepository.findById(submissionId, false, tenant.schoolId);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');
    if (submission.student_id !== tenant.userId) throw new Error('FORBIDDEN');

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
    const updatedVersion = await SubmissionRepository.updateVersionFiles(latestVersion.id, tenant.schoolId, files);

    return updatedVersion;
  },

  /**
   * Lấy chi tiết bài nộp
   */
  async getSubmissionById(submissionId, includeHistory, tenant) {
    const submission = await SubmissionRepository.findById(submissionId, includeHistory, tenant.schoolId);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    // Phân quyền
    if (tenant.role === 'student') {
      if (submission.student_id !== tenant.userId) {
        throw new Error('FORBIDDEN');
      }
      return submission;
    }

    // Giảng viên / School Admin: Tuyệt đối không nhìn thấy bài đang ở trạng thái draft
    if (tenant.role === 'lecturer' || tenant.role === 'school_admin') {
      if (submission.status === 'draft') {
        throw new Error('SUBMISSION_NOT_FOUND');
      }

      if (tenant.role === 'lecturer') {
        const assignment = await AssignmentRepository.findById(submission.assignment_id, tenant.schoolId);
        if (!assignment || assignment.lecturer_id !== tenant.userId) {
          throw new Error('FORBIDDEN');
        }
      }
      return submission;
    }

    throw new Error('FORBIDDEN');
  },

  /**
   * Giảng viên/School Admin đánh giá bài nộp
   */
  async reviewSubmission(submissionId, body, tenant) {
    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    const submission = await SubmissionRepository.findById(submissionId, false, tenant.schoolId);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    // Không thể đánh giá bài nháp
    if (submission.status === 'draft') {
      throw new Error('SUBMISSION_NOT_FOUND');
    }

    if (tenant.role === 'lecturer') {
      const assignment = await AssignmentRepository.findById(submission.assignment_id, tenant.schoolId);
      if (!assignment || assignment.lecturer_id !== tenant.userId) {
        throw new Error('FORBIDDEN');
      }
    }
    const updated = await SubmissionRepository.updateStatus(
      submissionId,
      tenant.schoolId,
      body.status
    );
    return updated;
  },

  /**
   * Tải xuống hoặc xem 1 file
   */
  async getSubmissionFile(submissionId, fileId, tenant) {
    const submission = await SubmissionRepository.findById(submissionId, true, tenant.schoolId);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    if (tenant.role === 'student' && submission.student_id !== tenant.userId) {
      throw new Error('FORBIDDEN');
    }

    // Giảng viên / School Admin không được tải file từ bài nháp
    if (tenant.role === 'lecturer' || tenant.role === 'school_admin') {
      if (submission.status === 'draft') {
        throw new Error('SUBMISSION_NOT_FOUND');
      }

      if (tenant.role === 'lecturer') {
        const assignment = await AssignmentRepository.findById(submission.assignment_id, tenant.schoolId);
        if (!assignment || assignment.lecturer_id !== tenant.userId) {
          throw new Error('FORBIDDEN');
        }
      }
    } else if (tenant.role !== 'student') {
      throw new Error('FORBIDDEN');
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
   * Helper đánh giá trạng thái khai báo AI Audit Log cho mỗi submission
   * Đảm bảo trả về:
   * - has_declared_audit: boolean
   * - ai_declarations: array
   * - ai_audit_log: object | null
   */
  enrichSubmissionAuditData(sub) {
    if (!sub) return sub;

    const rawNote = sub.latest_note || sub.note || sub.declarations || sub.aiAuditLog || sub.ai_audit_log;

    let hasDeclaredAudit = false;
    let normalizedAudit = null;
    const completedDeclarations = [];

    if (rawNote) {
      let parsed = null;
      if (typeof rawNote === 'string') {
        let trimmed = rawNote.trim();
        if (trimmed.toLowerCase().startsWith('note:')) {
          trimmed = trimmed.substring(5).trim();
        }
        try {
          parsed = JSON.parse(trimmed);
        } catch (e) {
          parsed = null;
        }
      } else if (typeof rawNote === 'object') {
        parsed = rawNote;
      }

      if (parsed) {
        normalizedAudit = normalizeAuditData(parsed);
        if (normalizedAudit && Array.isArray(normalizedAudit.scopes)) {
          for (const scope of normalizedAudit.scopes) {
            if (scope && scope.declarations) {
              for (const key of Object.keys(scope.declarations)) {
                const item = scope.declarations[key];
                const prompt = (item.prompt || item.prompt_used || item.promptUsed || '').trim();
                const response = (item.response || item.responseSummary || item.aiResponseSummary || item.ai_response_summary || '').trim();
                const reflection = (item.reflection || item.studentReflection || item.student_reflection || '').trim();

                // Xác định hoàn thành: Có cả 3 trường prompt, response, reflection không rỗng
                const isCompleted = Boolean(item.isCompleted || (prompt.length > 0 && response.length > 0 && reflection.length > 0));

                if (isCompleted || prompt.length > 0 || response.length > 0 || reflection.length > 0) {
                  completedDeclarations.push({
                    key,
                    scope_id: scope.id,
                    scope_title: scope.scope_title,
                    ...item,
                    isCompleted,
                  });
                }

                if (isCompleted) {
                  hasDeclaredAudit = true;
                }
              }
            }
          }
        }
      }
    }

    sub.has_declared_audit = hasDeclaredAudit;
    sub.ai_declarations = completedDeclarations;
    sub.ai_audit_log = hasDeclaredAudit ? normalizedAudit : null;
    if (!sub.declarations && normalizedAudit) {
      sub.declarations = normalizedAudit;
    }

    return sub;
  },

  /**
   * Giảng viên xem danh sách bài nộp của lớp
   */
  async getAssignmentSubmissions(assignmentId, query, tenant) {
    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    const assignment = await AssignmentRepository.findById(assignmentId, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    if (tenant.role === 'lecturer' && assignment.lecturer_id !== tenant.userId) {
      throw new Error('FORBIDDEN');
    }

    const result =
      await SubmissionRepository.findManyByAssignmentId(
        assignmentId,
        tenant.schoolId,
        query
      );
    if (result && Array.isArray(result.data)) {
      result.data = result.data.map(sub => this.enrichSubmissionAuditData(sub));
    }
    return result;
  },

  /**
   * Lấy danh sách bài nộp của student hiện tại trong trường hiện tại
   */
  async getMySubmissions(tenant, query) {
    return await SubmissionRepository.findMySubmissions(tenant.userId, tenant.schoolId, query);
  },

  /**
   * Lấy chi tiết bài nộp của student cho 1 assignment cụ thể (kể cả draft)
   */
  async getStudentSubmissionForAssignment(assignmentId, tenant) {
    const assignment = await AssignmentRepository.findById(assignmentId, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (assignment.publish_status === 'draft') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
      [assignment.class_id, tenant.userId, tenant.schoolId]
    );
    if (!memberRows.length) throw new Error('FORBIDDEN');

    const sub = await SubmissionRepository.findByAssignmentAndStudent(assignmentId, tenant.userId, tenant.schoolId);
    if (!sub) return null;
    const detailed = await SubmissionRepository.findById(sub.id, true, tenant.schoolId);
    if (!detailed) return null;

    if (detailed.versions && detailed.versions.length > 0) {
      detailed.versions = detailed.versions.map(v => {
        let parsedFiles = v.files;
        if (typeof parsedFiles === 'string') {
          try {
            parsedFiles = JSON.parse(parsedFiles);
          } catch (e) {
            parsedFiles = [];
          }
        }
        return {
          ...v,
          files: Array.isArray(parsedFiles) ? parsedFiles : []
        };
      });

      const latestVer = detailed.versions.find(v => v.is_latest) || detailed.versions[0];
      if (latestVer) {
        detailed.latest_files = latestVer.files;
        detailed.latest_note = latestVer.note;
      }
    }

    return this.enrichSubmissionAuditData(detailed);
  },

  /**
   * 1. Silent Auto-Save Draft File
   * Upload file ngay lập tức lên SeaweedFS / S3 và lưu vào DB ở trạng thái draft
   */
  async saveDraftFile(assignmentId, tenant, uploadedFiles = [], body = {}) {
    if (tenant.role !== 'student') {
      throw new Error('ONLY_STUDENT_CAN_SUBMIT');
    }

    // 1. Kiểm tra assignment và enrollment
    const assignment = await AssignmentRepository.findById(assignmentId, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
      [assignment.class_id, tenant.userId, tenant.schoolId]
    );
    if (!memberRows.length) throw new Error('NOT_ENROLLED_IN_CLASS');

    // 2. Upload file lên S3 / SeaweedFS
    const filesMeta = await this.uploadFilesToS3(assignmentId, tenant.userId, uploadedFiles);

    // 3. Transaction DB
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(
        assignmentId,
        tenant.userId,
        tenant.schoolId,
        client
      );
      let result;

      if (!existingSubmission) {
        // Chưa có bản ghi: tạo mới draft với latest_version_no = 1
        const submissionData = {
          id: uuidv4(),
          uuid: uuidv4(),
          school_id: tenant.schoolId,
          assignment_id: assignmentId,
          student_id: tenant.userId,
          status: 'draft'
        };
        const versionData = {
          files: filesMeta,
          note: body.note || ''
        };
        result = await SubmissionRepository.createSubmissionWithVersion(submissionData, versionData, client);
      } else {
        // Đã có bản ghi: kiểm tra khóa
        if (existingSubmission.status !== 'draft') {
          throw new Error('SUBMISSION_LOCKED');
        }

        const latestVer = await SubmissionRepository.findLatestVersion(existingSubmission.id, tenant.schoolId, client);
        if (!latestVer) {
          throw new Error('VERSION_NOT_FOUND');
        }

        let finalFiles = filesMeta;
        if (body.action === 'append') {
          let currentFiles = [];
          if (latestVer.files) {
            try {
              currentFiles = typeof latestVer.files === 'string' ? JSON.parse(latestVer.files) : latestVer.files;
            } catch (e) {
              currentFiles = [];
            }
          }
          finalFiles = [...(Array.isArray(currentFiles) ? currentFiles : []), ...filesMeta];
        }

        const finalNote = latestVer.note || body.note || '';

        // Cập nhật version hiện tại mà không làm đổi version
        result = await SubmissionRepository.updateDraftSubmission(
          existingSubmission.id,
          latestVer.id,
          tenant.schoolId,
          finalFiles,
          finalNote,
          client
        );
      }

      await client.query('COMMIT');
      return {
        submission_id: result.submission.id,
        status: result.submission.status,
        file: filesMeta[0] || null,
        files: filesMeta,
        version: result.version
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * 2. Silent Auto-Save Draft Declarations (Debounced text/JSON)
   * Cập nhật trường khai báo AI vào bản ghi draft hiện có mà không làm đổi version
   */
  async saveDraftDeclarations(assignmentId, tenant, body = {}) {
    if (tenant.role !== 'student') {
      throw new Error('ONLY_STUDENT_CAN_SUBMIT');
    }

    // 1. Kiểm tra assignment và enrollment
    const assignment = await AssignmentRepository.findById(assignmentId, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
      [assignment.class_id, tenant.userId, tenant.schoolId]
    );
    if (!memberRows.length) throw new Error('NOT_ENROLLED_IN_CLASS');

    // 2. Định dạng note từ declarations / scopes
    let draftNote = body.note;
    if (!draftNote) {
      const scopes = body.scopes || (body.ai_declarations ? [{
        id: 'scope-default',
        scopeId: 'scope-default',
        title: 'Khai báo chung',
        scope_title: 'Khai báo chung',
        declarations: body.ai_declarations
      }] : null);

      if (scopes || body.ai_declarations) {
        draftNote = JSON.stringify({
          version: '2.0',
          scopes: scopes,
          declarations: body.ai_declarations || scopes?.[0]?.declarations || {},
          isDraft: true,
          savedAt: new Date().toISOString()
        });
      } else {
        draftNote = '';
      }
    }

    // 3. Transaction DB
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(
        assignmentId,
        tenant.userId,
        tenant.schoolId,
        client
      );
      let result;

      if (!existingSubmission) {
        // Chưa có bản ghi: tạo mới draft với latest_version_no = 1
        const submissionData = {
          id: uuidv4(),
          uuid: uuidv4(),
          school_id: tenant.schoolId,
          assignment_id: assignmentId,
          student_id: tenant.userId,
          status: 'draft'
        };
        const versionData = {
          files: [],
          note: draftNote
        };
        result = await SubmissionRepository.createSubmissionWithVersion(submissionData, versionData, client);
      } else {
        // Đã có bản ghi: kiểm tra khóa
        if (existingSubmission.status !== 'draft') {
          throw new Error('SUBMISSION_LOCKED');
        }

        const latestVer = await SubmissionRepository.findLatestVersion(existingSubmission.id, tenant.schoolId, client);
        if (!latestVer) {
          throw new Error('VERSION_NOT_FOUND');
        }

        // Cập nhật note vào version hiện tại
        result = await SubmissionRepository.updateDraftNote(
          existingSubmission.id,
          latestVer.id,
          tenant.schoolId,
          draftNote,
          client
        );
      }

      await client.query('COMMIT');
      return {
        submission_id: result.submission.id,
        status: result.submission.status,
        note: draftNote,
        version: result.version
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Xóa file trong bản nháp draft của assignment
   */
  async removeDraftFile(assignmentId, tenant) {
    if (tenant.role !== 'student') {
      throw new Error('ONLY_STUDENT_CAN_DELETE');
    }

    const submission = await SubmissionRepository.findByAssignmentAndStudent(assignmentId, tenant.userId, tenant.schoolId);
    if (!submission) throw new Error('SUBMISSION_NOT_FOUND');

    if (submission.status !== 'draft') {
      throw new Error('SUBMISSION_LOCKED');
    }

    const latestVer = await SubmissionRepository.findLatestVersion(submission.id, tenant.schoolId);
    if (!latestVer) throw new Error('VERSION_NOT_FOUND');

    let currentFiles = [];
    if (latestVer.files) {
      try {
        currentFiles = typeof latestVer.files === 'string' ? JSON.parse(latestVer.files) : latestVer.files;
      } catch (e) {
        currentFiles = [];
      }
    }

    if (Array.isArray(currentFiles)) {
      for (const f of currentFiles) {
        if (f.key) {
          try {
            await s3.send(
              new DeleteObjectCommand({
                Bucket: S3_BUCKET,
                Key: f.key,
              })
            );
          } catch (err) {
            console.warn('⚠️ S3 delete failed:', err.message);
          }
        }
      }
    }

    const updatedVersion = await SubmissionRepository.updateVersionFiles(latestVer.id, tenant.schoolId, []);
    return {
      submission_id: submission.id,
      files: [],
      version: updatedVersion
    };
  },

  /**
   * Helper trích xuất nội dung mã nguồn phục vụ Pre-submission Sanity Check
   */
  async extractCodeForSanityCheck(filesList) {
    const AdmZip = require('adm-zip');
    if (!Array.isArray(filesList) || filesList.length === 0) return '';

    const zipFile = filesList.find(f =>
      (f.name || f.filename || '').toLowerCase().endsWith('.zip') ||
      (f.key || '').toLowerCase().endsWith('.zip')
    );

    if (zipFile && zipFile.key) {
      try {
        const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: zipFile.key });
        const res = await s3.send(command);
        const chunks = [];
        for await (const chunk of res.Body) {
          chunks.push(chunk);
        }
        const zipBuffer = Buffer.concat(chunks);
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        const fileListOverview = [];
        const codeSnippets = [];

        for (const entry of entries) {
          if (
            entry.isDirectory ||
            entry.entryName.includes('.git/') ||
            entry.entryName.includes('node_modules/') ||
            entry.entryName.includes('__MACOSX/')
          ) continue;

          fileListOverview.push(`- ${entry.entryName} (${entry.header.size} bytes)`);

          const isCode = /\.(py|js|ts|tsx|jsx|java|cpp|c|cs|html|css|json|md|sql)$/i.test(entry.entryName);
          if (isCode && codeSnippets.length < 8) {
            const content = entry.getData().toString('utf8');
            const trimmed = content.slice(0, 3000);
            codeSnippets.push(`\n[TỆP: ${entry.entryName}]\n${trimmed}`);
          }
        }

        return `Cấu trúc tệp tin dự án:\n${fileListOverview.slice(0, 50).join('\n')}\n\nNội dung các tệp mã nguồn mẫu:\n${codeSnippets.join('\n\n')}`;
      } catch (err) {
        console.warn('⚠️ Lỗi đọc zip từ S3 cho sanity check:', err.message);
      }
    }

    // Trường hợp nộp file code đơn lẻ
    const singleCodeFile = filesList.find(f =>
      /\.(py|js|ts|tsx|jsx|java|cpp|c|cs|html|css|json|md|sql)$/i.test(f.name || f.filename || '')
    );
    if (singleCodeFile && singleCodeFile.key) {
      try {
        const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: singleCodeFile.key });
        const res = await s3.send(command);
        const chunks = [];
        for await (const chunk of res.Body) {
          chunks.push(chunk);
        }
        const codeBuffer = Buffer.concat(chunks);
        const content = codeBuffer.toString('utf8');
        return `[TỆP: ${singleCodeFile.name}]\n${content.slice(0, 8000)}`;
      } catch (err) {
        console.warn('⚠️ Lỗi đọc file code đơn lẻ từ S3 cho sanity check:', err.message);
      }
    }

    return filesList.map(f => `- Tệp: ${f.name} (${f.size} bytes)`).join('\n');
  },

  /**
   * Pre-submission AI Sanity Check
   * Chẩn đoán nhanh bài làm bản nháp theo yêu cầu của sinh viên (On-demand)
   */
  async sanityCheck(assignmentId, tenant, body = {}) {
    if (tenant.role !== 'student') {
      throw new Error('ONLY_STUDENT_CAN_SUBMIT');
    }

    // 1. Kiểm tra assignment và enrollment
    const assignment = await AssignmentRepository.findById(assignmentId, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');
    if (assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
      [assignment.class_id, tenant.userId, tenant.schoolId]
    );
    if (!memberRows.length) throw new Error('NOT_ENROLLED_IN_CLASS');

    // 2. Lấy submission draft hiện tại
    const existingSubmission = await SubmissionRepository.findByAssignmentAndStudent(assignmentId, tenant.userId, tenant.schoolId);
    let filesList = [];
    let noteData = body.note || '';

    if (existingSubmission) {
      const latestVer = await SubmissionRepository.findLatestVersion(existingSubmission.id, tenant.schoolId);
      if (latestVer?.files) {
        try {
          filesList = typeof latestVer.files === 'string' ? JSON.parse(latestVer.files) : latestVer.files;
        } catch (e) {
          filesList = [];
        }
      }
      if (!noteData && latestVer?.note) {
        noteData = latestVer.note;
      }
    }

    if (!Array.isArray(filesList) || filesList.length === 0) {
      throw new Error('NO_SUBMISSION_FILE');
    }

    // 3. Trích xuất code
    const sourceCode = await this.extractCodeForSanityCheck(filesList);

    // 4. Trích xuất khai báo AI
    let studentDeclarationsSummary = '';
    const scopesData = body.scopes || (body.ai_declarations ? [{ declarations: body.ai_declarations }] : null);
    if (scopesData) {
      studentDeclarationsSummary = JSON.stringify(scopesData, null, 2);
    } else if (noteData) {
      try {
        const normalized = normalizeAuditData(noteData);
        studentDeclarationsSummary = JSON.stringify(normalized, null, 2);
      } catch (e) {
        studentDeclarationsSummary = typeof noteData === 'string' ? noteData : JSON.stringify(noteData);
      }
    }

    // 5. Gọi AI chẩn đoán
    const sanityResult = await preSubmissionSanityCheckWithGemini({
      assignmentTitle: assignment.title,
      assignmentDescription: `${assignment.description || ''}\n${assignment.instructions || ''}`,
      sourceCode,
      studentDeclarations: studentDeclarationsSummary,
    });

    return sanityResult;
  }
};

module.exports = SubmissionService;
