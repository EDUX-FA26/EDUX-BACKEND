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
 * Lấy thông tin assignment + class, kiểm tra quyền truy cập.
 * - admin: luôn được phép
 * - lecturer: phải là giảng viên của lớp chứa assignment này
 * - student: phải là thành viên active của lớp chứa assignment
 */
async function verifyAssignmentAccess(assignmentId, user) {
  const { rows: aRows } = await pool.query(
    `SELECT a.*, c.lecturer_id
     FROM assignments a
     JOIN classes c ON a.class_id = c.id
     WHERE a.id = $1`,
    [assignmentId]
  );
  const assignment = aRows[0];
  if (!assignment) throw new Error('ASSIGNMENT_NOT_FOUND');

  if (user.role === 'admin') return assignment;

  if (user.role === 'lecturer') {
    if (assignment.lecturer_id !== user.id) throw new Error('FORBIDDEN');
    return assignment;
  }

  if (user.role === 'student') {
    // Chỉ student enrolled mới được đọc
    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members
       WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
      [assignment.class_id, user.id]
    );
    if (!memberRows.length) throw new Error('FORBIDDEN');
    return assignment;
  }

  throw new Error('FORBIDDEN');
}

const AssignmentMaterialService = {
  /**
   * Lấy danh sách tài liệu của assignment
   * Student chỉ được xem nếu assignment đã published
   */
  async listMaterials(assignmentId, query, user) {
    const assignment = await verifyAssignmentAccess(assignmentId, user);

    // Student chỉ thấy tài liệu của assignment đã published
    if (user.role === 'student' && assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const result = await AssignmentMaterialRepository.findByAssignmentId(assignmentId, {
      page: query.page,
      limit: query.limit,
    });
    return result;
  },

  /**
   * Upload tài liệu cho assignment (chỉ lecturer)
   */
  async uploadMaterial(assignmentId, body, file, user) {
    await verifyAssignmentAccess(assignmentId, user);

    if (user.role !== 'lecturer' && user.role !== 'admin') {
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
      assignment_id: assignmentId,
      description: body.description || '',
      file_name: file.originalname,
      file_key: fileKey,
      file_type: file.mimetype,
      file_size: file.size,
      uploaded_by: user.id,
    });

    return material;
  },

  /**
   * Lấy chi tiết 1 tài liệu assignment
   */
  async getMaterialById(assignmentId, materialId, user) {
    const assignment = await verifyAssignmentAccess(assignmentId, user);

    if (user.role === 'student' && assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    return material;
  },

  /**
   * Cập nhật metadata tài liệu assignment (chỉ lecturer)
   */
  async updateMaterial(assignmentId, materialId, body, user) {
    await verifyAssignmentAccess(assignmentId, user);

    if (user.role !== 'lecturer' && user.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    const updated = await AssignmentMaterialRepository.update(materialId, body);
    return updated;
  },

  /**
   * Xóa tài liệu assignment (chỉ lecturer)
   */
  async deleteMaterial(assignmentId, materialId, user) {
    await verifyAssignmentAccess(assignmentId, user);

    if (user.role !== 'lecturer' && user.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    // Xóa file trên S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: material.file_key,
      })
    );

    const deleted = await AssignmentMaterialRepository.delete(materialId);
    return deleted;
  },

  /**
   * Tải xuống tài liệu assignment (presigned URL)
   */
  async downloadMaterial(assignmentId, materialId, user) {
    const assignment = await verifyAssignmentAccess(assignmentId, user);

    if (user.role === 'student' && assignment.publish_status !== 'published') {
      throw new Error('ASSIGNMENT_NOT_PUBLISHED');
    }

    const material = await AssignmentMaterialRepository.findByIdAndAssignment(materialId, assignmentId);
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
      file_name: material.file_name,
      file_type: material.file_type,
      file_size: material.file_size,
    };
  },
};

module.exports = AssignmentMaterialService;

