const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, S3_BUCKET } = require('../../config/seaweed.config');
const { pool } = require('../../config/db.config');
const AssignmentMaterialRepository = require('./assignmentMaterial.repository');
const { v4: uuidv4 } = require('uuid');

/**
 * Lấy thông tin assignment + class theo trường hiện tại, kiểm tra quyền truy cập.
 * - school_admin: được phép trong phạm vi trường hiện tại
 * - lecturer: phải là giảng viên của lớp chứa assignment này trong trường hiện tại
 * - student: phải là thành viên active của lớp chứa assignment trong trường hiện tại
 */
async function verifyAssignmentAccess(assignmentId, tenant) {
  const { rows: aRows } = await pool.query(
    `SELECT a.*, c.lecturer_id
     FROM assignments a
     JOIN classes c ON a.class_id = c.id AND c.school_id = a.school_id
     WHERE a.id = $1 AND a.school_id = $2`,
    [assignmentId, tenant.schoolId]
  );
  const assignment = aRows[0];
  if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

  if (tenant.role === 'school_admin') return assignment;

  if (tenant.role === 'lecturer') {
    if (assignment.lecturer_id !== tenant.userId) throw new Error('FORBIDDEN');
    return assignment;
  }

  if (tenant.role === 'student') {
    // Chỉ student enrolled trong cùng trường mới được đọc
    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members
       WHERE class_id = $1 AND student_id = $2 AND school_id = $3 AND status = 'active'`,
      [assignment.class_id, tenant.userId, tenant.schoolId]
    );
    if (!memberRows.length) throw new Error('FORBIDDEN');
    return assignment;
  }

  throw new Error('FORBIDDEN');
}

const AssignmentMaterialService = {
  /**
   * Lấy danh sách tài liệu của assignment
   * Student chỉ được xem nếu assignment không phải draft
   */
  async listMaterials(assignmentId, query, tenant) {
    const assignment = await verifyAssignmentAccess(assignmentId, tenant);

    if (tenant.role === 'student' && assignment.publish_status === 'draft') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const result = await AssignmentMaterialRepository.findByAssignmentId(assignmentId, tenant.schoolId, {
      page: query.page,
      limit: query.limit,
    });
    return result;
  },

  /**
   * Upload tài liệu cho assignment (chỉ lecturer / school_admin)
   */
  async uploadMaterial(assignmentId, body, file, tenant) {
    await verifyAssignmentAccess(assignmentId, tenant);

    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    const fileKey = `assignment-materials/${assignmentId}/${uuidv4()}_${file.originalname}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );

    const material = await AssignmentMaterialRepository.create({
      school_id: tenant.schoolId,
      assignment_id: assignmentId,
      description: body.description || '',
      file_name: file.originalname,
      file_key: fileKey,
      file_type: file.mimetype,
      file_size: file.size,
      uploaded_by: tenant.userId,
    });

    return material;
  },

  /**
   * Lấy chi tiết 1 tài liệu assignment
   */
  async getMaterialById(assignmentId, materialId, tenant) {
    const assignment = await verifyAssignmentAccess(assignmentId, tenant);

    if (tenant.role === 'student' && assignment.publish_status === 'draft') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId, tenant.schoolId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    return material;
  },

  /**
   * Cập nhật metadata tài liệu assignment (chỉ lecturer / school_admin)
   */
  async updateMaterial(assignmentId, materialId, body, tenant) {
    await verifyAssignmentAccess(assignmentId, tenant);

    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId, tenant.schoolId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    const updated = await AssignmentMaterialRepository.update(materialId, tenant.schoolId, body);
    return updated;
  },

  /**
   * Xóa tài liệu assignment (chỉ lecturer / school_admin)
   */
  async deleteMaterial(assignmentId, materialId, tenant) {
    await verifyAssignmentAccess(assignmentId, tenant);

    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId, tenant.schoolId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    // Xóa file trên S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: material.file_key,
      })
    );

    const deleted = await AssignmentMaterialRepository.delete(materialId, tenant.schoolId);
    return deleted;
  },

  /**
   * Tải xuống tài liệu assignment (presigned URL)
   */
  async downloadMaterial(assignmentId, materialId, tenant) {
    const assignment = await verifyAssignmentAccess(assignmentId, tenant);

    if (tenant.role === 'student' && assignment.publish_status === 'draft') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId, tenant.schoolId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: material.file_key,
      ResponseContentDisposition: `attachment; filename="${material.file_name}"`,
    });

    // Presigned URL có hiệu lực 15 phút
    const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 900 });

    return {
      url: presignedUrl,
      download_url: presignedUrl,
      file_name: material.file_name,
      file_type: material.file_type,
      file_size: material.file_size,
    };
  },
};

module.exports = AssignmentMaterialService;

