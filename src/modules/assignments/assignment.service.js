const { v4: uuidv4 } = require('uuid');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3, S3_BUCKET } = require('../../config/seaweed.config');
const { pool, withTransaction } = require('../../config/db.config');
const AssignmentRepository = require('./assignment.repository');
const AssignmentMaterialRepository = require('../assignment-materials/assignmentMaterial.repository');

const AssignmentService = {
  /**
   * Helper: Kiểm tra quyền truy cập class
   */
  async verifyClassAccess(classId, user) {
    if (user.role === 'admin') return true;
    
    if (user.role === 'lecturer') {
      const { rows } = await pool.query(`SELECT lecturer_id FROM classes WHERE id = $1`, [classId]);
      if (rows.length === 0) throw new Error('CLASS_NOT_FOUND');
      if (rows[0].lecturer_id !== user.id) throw new Error('FORBIDDEN');
      return true;
    }
    
    throw new Error('FORBIDDEN');
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
  async createAssignment(data, files = [], user) {
    await this.verifyClassAccess(data.class_id, user);

    const assignmentId = uuidv4();
    const assignmentUuid = uuidv4(); // Unique varchar uuid
    const uploadedMaterials = [];

    // 1. Upload files to S3 first
    if (files.length > 0) {
      for (const file of files) {
        const fileKey = `assignment-materials/${assignmentId}/${uuidv4()}_${file.originalname}`;
        
        await s3.send(
          new PutObjectCommand({
            Bucket: S3_BUCKET,
            Key: fileKey,
            Body: file.buffer,
            ContentType: file.mimetype,
          })
        );
        
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
          created_by: user.id
        };
        const assignment = await AssignmentRepository.create(assignmentData, client);

        // Insert materials
        const materials = [];
        for (const mat of uploadedMaterials) {
          const createdMat = await AssignmentMaterialRepository.create({
            assignment_id: assignmentId,
            description: '',
            file_name: mat.file_name,
            file_key: mat.file_key,
            file_type: mat.file_type,
            file_size: mat.file_size,
            uploaded_by: user.id,
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
   * Cập nhật thông tin bài tập
   */
  async updateAssignment(id, data, user) {
    const assignment = await AssignmentRepository.findById(id);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    await this.verifyClassAccess(assignment.class_id, user);

    const updated = await AssignmentRepository.update(id, data);
    return updated;
  },

  /**
   * Đổi trạng thái bài tập
   */
  async updatePublishStatus(id, publishStatus, user) {
    const assignment = await AssignmentRepository.findById(id);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    await this.verifyClassAccess(assignment.class_id, user);

    const updated = await AssignmentRepository.updatePublishStatus(id, publishStatus);
    return updated;
  },

  /**
   * Xóa bài tập
   */
  async deleteAssignment(id, user) {
    const assignment = await AssignmentRepository.findById(id);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    await this.verifyClassAccess(assignment.class_id, user);

    // Get all materials to delete from S3
    const { data: materials } = await AssignmentMaterialRepository.findByAssignmentId(id, { limit: 1000 });
    
    // DB delete
    await AssignmentRepository.delete(id);

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
  async getAssignmentById(id, user) {
    const assignment = await AssignmentRepository.findById(id);
    if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

    // Row-level isolation logic is in repository for list, but for detail we verify access here
    if (user.role === 'student') {
      if (assignment.publish_status === 'draft') throw new Error('ASSIGNMENT_NOT_PUBLISHED');
      
      const { rows } = await pool.query(
        `SELECT 1 FROM class_members WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
        [assignment.class_id, user.id]
      );
      if (rows.length === 0) throw new Error('FORBIDDEN');
    } else if (user.role === 'lecturer') {
      if (assignment.lecturer_id !== user.id) throw new Error('FORBIDDEN');
    }

    // Get materials
    const { data: materials } = await AssignmentMaterialRepository.findByAssignmentId(id, { limit: 100 });

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
  async getAssignments(query, user) {
    const result = await AssignmentRepository.findMany(query, user);
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