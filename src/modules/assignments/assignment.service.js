const { v4: uuidv4 } = require('uuid');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, S3_BUCKET } = require('../../config/seaweed.config');
const { pool, withTransaction } = require('../../config/db.config');
const AssignmentRepository = require('./assignment.repository');
const AssignmentMaterialRepository = require('../assignment-materials/assignmentMaterial.repository');

const AssignmentService = {
  /**
   * Helper: Kiểm tra quyền truy cập class (và session nếu có) theo trường hiện tại
   */
  async verifyClassAccess(classId, tenant, sessionId = null) {
    const { rows } = await pool.query(
      `SELECT id, lecturer_id, school_id FROM classes WHERE id = $1 AND school_id = $2`,
      [classId, tenant.schoolId]
    );
    if (rows.length === 0) throw new Error('CLASS_NOT_FOUND');

    if (tenant.role === 'lecturer') {
      if (rows[0].lecturer_id !== tenant.userId) throw new Error('FORBIDDEN');
    } else if (tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    if (sessionId) {
      const { rows: sessionRows } = await pool.query(
        `SELECT id FROM sessions WHERE id = $1 AND class_id = $2 AND school_id = $3`,
        [sessionId, classId, tenant.schoolId]
      );
      if (sessionRows.length === 0) throw new Error('SESSION_NOT_FOUND');
    }

    return true;
  },

  /**
   * Cập nhật cleanup S3 files
   */
  async cleanupS3Files(fileKeys) {
    for (const key of fileKeys) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: key
        }));
      } catch (err) {
        console.error(`Failed to cleanup S3 file: ${key}`, err);
      }
    }
  },

  /**
   * Tạo bài tập (kèm tài liệu nếu có)
   */
  async createAssignment(data, files = [], tenant) {
    await this.verifyClassAccess(data.class_id, tenant, data.session_id);

    const assignmentId = uuidv4();
    const assignmentUuid = uuidv4(); // Unique varchar uuid
    const uploadedMaterials = [];

    // 1. Upload files to S3 first
    if (files.length > 0) {
      for (const file of files) {
        const fileKey = `assignment-materials/${assignmentId}/${uuidv4()}_${file.originalname}`;
        
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
          console.warn('⚠️ S3 Upload failed (SeaweedFS might be down).', uploadError.message);
        }
        
        uploadedMaterials.push({
          file_name: file.originalname,
          file_key: fileKey,
          file_type: file.mimetype,
          file_size: file.size,
        });
      }
    }

    try {
      // 2. DB Transaction
      const result = await withTransaction(async (client) => {
        // Insert assignment
        const assignmentData = {
          ...data,
          id: assignmentId,
          uuid: assignmentUuid,
          school_id: tenant.schoolId,
          created_by: tenant.userId
        };
        const assignment = await AssignmentRepository.create(assignmentData, client);

        // Insert materials
        const materials = [];
        for (const mat of uploadedMaterials) {
          const createdMat = await AssignmentMaterialRepository.create({
            school_id: tenant.schoolId,
            assignment_id: assignmentId,
            description: '',
            file_name: mat.file_name,
            file_key: mat.file_key,
            file_type: mat.file_type,
            file_size: mat.file_size,
            uploaded_by: tenant.userId,
          }, client);
          materials.push(createdMat);
        }

        return { ...assignment, materials };
      });

      return result;
    } catch (error) {
      // Cleanup orphan files on DB failure
      if (uploadedMaterials.length > 0) {
        const keys = uploadedMaterials.map(m => m.file_key);
        await this.cleanupS3Files(keys);
      }
      throw error;
    }
  },

  /**
   * Cập nhật thông tin bài tập (kèm upload thêm tài liệu nếu có)
   */
  async updateAssignment(id, data, files = [], tenant) {
    const actualTenant = tenant || files;
    const actualFiles = Array.isArray(files) ? files : [];

    const assignment = await AssignmentRepository.findById(id, actualTenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    await this.verifyClassAccess(assignment.class_id, actualTenant, data.session_id);

    // Nếu có upload thêm files, upload lên S3 và tạo record trong assignment_materials
    if (actualFiles && actualFiles.length > 0) {
      for (const file of actualFiles) {
        const fileKey = `assignment-materials/${id}/${uuidv4()}_${file.originalname}`;
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
          console.warn('⚠️ S3 Upload failed (SeaweedFS might be down).', uploadError.message);
        }

        await AssignmentMaterialRepository.create({
          school_id: actualTenant.schoolId,
          assignment_id: id,
          description: '',
          file_name: file.originalname,
          file_key: fileKey,
          file_type: file.mimetype,
          file_size: file.size,
          uploaded_by: actualTenant.userId,
        });
      }
    }

    const updated = await AssignmentRepository.update(id, actualTenant.schoolId, data);
    return updated;
  },

  /**
   * Đổi trạng thái bài tập
   */
  async updatePublishStatus(id, publishStatus, tenant) {
    const assignment = await AssignmentRepository.findById(id, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    await this.verifyClassAccess(assignment.class_id, tenant);

    const updated = await AssignmentRepository.updatePublishStatus(id, tenant.schoolId, publishStatus);
    return updated;
  },

  /**
   * Xóa bài tập
   */
  async deleteAssignment(id, tenant) {
    const assignment = await AssignmentRepository.findById(id, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    await this.verifyClassAccess(assignment.class_id, tenant);

    // Get all materials to delete from S3
    const { data: materials } = await AssignmentMaterialRepository.findByAssignmentId(id, tenant.schoolId, { limit: 1000 });
    
    // DB delete
    await AssignmentRepository.delete(id, tenant.schoolId);

    // Delete files from S3 after DB delete succeeds
    if (materials.length > 0) {
      const keys = materials.map(m => m.file_key);
      await this.cleanupS3Files(keys);
    }

    return assignment;
  },

  /**
   * Lấy chi tiết
   */
  async getAssignmentById(id, tenant) {
    const assignment = await AssignmentRepository.findById(id, tenant.schoolId);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    // Row-level isolation logic is in repository for list, but for detail we verify access here
    if (tenant.role === 'student') {
      if (assignment.publish_status === 'draft') throw new Error('ASSIGNMENT_NOT_PUBLISHED');
      
      const { rows } = await pool.query(
        `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
        [assignment.class_id, tenant.userId, tenant.schoolId]
      );
      if (rows.length === 0) throw new Error('FORBIDDEN');
    } else if (tenant.role === 'lecturer') {
      if (assignment.lecturer_id !== tenant.userId) throw new Error('FORBIDDEN');
    } else if (tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    // Get materials
    const { data: materials } = await AssignmentMaterialRepository.findByAssignmentId(id, tenant.schoolId, { limit: 100 });

    const subjectObj = {
      id: assignment.subject_id,
      code: assignment.subject_code,
      name: assignment.subject_name
    };

    const classObj = {
      id: assignment.class_id,
      class_code: assignment.class_code,
      class_name: assignment.class_code,
      lecturer_id: assignment.lecturer_id,
      semester_id: assignment.semester_id,
      semester_name: assignment.semester_name,
      subject_id: assignment.subject_id,
      subject: subjectObj,
      course: subjectObj
    };

    return {
      ...assignment,
      class_name: assignment.class_code,
      course_name: assignment.subject_name,
      course_code: assignment.subject_code,
      class: classObj,
      subject: subjectObj,
      course: subjectObj,
      materials
    };
  },

  /**
   * Lấy danh sách (phân trang, filter)
   */
  async getAssignments(query, tenant) {
    const result = await AssignmentRepository.findMany(query, tenant);
    const enrichedData = (result.data || []).map(a => {
      const subjectObj = {
        id: a.subject_id,
        code: a.subject_code,
        name: a.subject_name
      };
      return {
        ...a,
        class_name: a.class_code,
        course_name: a.subject_name,
        course_code: a.subject_code,
        class: {
          id: a.class_id,
          class_code: a.class_code,
          class_name: a.class_code,
          subject_id: a.subject_id,
          subject: subjectObj,
          course: subjectObj
        },
        subject: subjectObj,
        course: subjectObj
      };
    });
    return { ...result, data: enrichedData };
  }
};

module.exports = AssignmentService;
