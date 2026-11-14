const {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, S3_BUCKET } = require('../../config/seaweed.config');
const { pool } = require('../../config/db.config');
const ClassMaterialRepository = require('./classMaterial.repository');
const { v4: uuidv4 } = require('uuid');

/**
 * Kiểm tra quyền truy cập vào lớp học.
 * - school_admin: được phép trong trường đã chọn
 * - lecturer: phải là giảng viên của lớp
 * - student: phải là thành viên active của lớp
 */
async function verifyClassAccess(classId, tenant) {
  const { rows: classRows } = await pool.query(
    'SELECT * FROM classes WHERE id = $1 AND school_id = $2',
    [classId, tenant.schoolId]
  );
  const classData = classRows[0];
  if (!classData) throw new Error('CLASS_NOT_FOUND');

  if (tenant.role === 'school_admin') return classData;

  if (tenant.role === 'lecturer') {
    if (classData.lecturer_id !== tenant.userId) throw new Error('FORBIDDEN');
    return classData;
  }

  if (tenant.role === 'student') {
    const { rows: memberRows } = await pool.query(
      `SELECT 1
       FROM class_members cm
       JOIN school_memberships sm
         ON sm.school_id = cm.school_id
        AND sm.user_id = cm.student_id
        AND sm.role = 'student'
        AND sm.status = 'active'
       WHERE cm.class_id = $1
         AND cm.school_id = $2
         AND cm.student_id = $3
         AND cm.status = 'active'`,
      [classId, tenant.schoolId, tenant.userId]
    );
    if (!memberRows.length) throw new Error('FORBIDDEN');
    return classData;
  }

  throw new Error('FORBIDDEN');
}

const ClassMaterialService = {
  /**
   * UC17 — Lấy danh sách tài liệu lớp học
   */
  async listMaterials(classId, query, tenant) {
    await verifyClassAccess(classId, tenant);

    const result = await ClassMaterialRepository.findByClassId(classId, tenant.schoolId, {
      page: query.page,
      limit: query.limit,
    });
    return result;
  },

  /**
   * UC19 — Upload tài liệu lên lớp học (chỉ lecturer)
   */
  async uploadMaterial(classId, body, file, tenant) {
    await verifyClassAccess(classId, tenant);

    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    const fileKey = `class-materials/${classId}/${uuidv4()}_${file.originalname}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    );

    const material = await ClassMaterialRepository.create({
      class_id: classId,
      title: body.title,
      description: body.description || '',
      file_name: file.originalname,
      file_key: fileKey,
      file_type: file.mimetype,
      file_size: file.size,
      is_private: body.is_private !== undefined ? body.is_private : true,
      uploaded_by: tenant.userId,
    });

    return material;
  },

  /**
   * UC17 — Lấy chi tiết 1 tài liệu lớp
   */
  async getMaterialById(materialId, tenant) {
    const material = await ClassMaterialRepository.findById(
      materialId,
      tenant.schoolId
    );
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, tenant);

    // Nếu tài liệu là private, chỉ lecturer/admin của lớp hoặc student enrolled mới xem được
    // (verifyClassAccess đã xử lý điều này)
    return material;
  },

  /**
   * UC20 — Cập nhật metadata tài liệu lớp (chỉ lecturer)
   */
  async updateMaterial(materialId, body, tenant) {
    const material = await ClassMaterialRepository.findById(
      materialId,
      tenant.schoolId
    );
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, tenant);

    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    const updated = await ClassMaterialRepository.update(
      materialId,
      body,
      tenant.schoolId
    );
    return updated;
  },

  /**
   * UC21 — Xóa tài liệu lớp (chỉ lecturer)
   */
  async deleteMaterial(materialId, tenant) {
    const material = await ClassMaterialRepository.findById(
      materialId,
      tenant.schoolId
    );
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, tenant);

    if (tenant.role !== 'lecturer' && tenant.role !== 'school_admin') {
      throw new Error('FORBIDDEN');
    }

    // Xóa file trên S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: material.file_key,
      })
    );

    const deleted = await ClassMaterialRepository.delete(
      materialId,
      tenant.schoolId
    );
    return deleted;
  },

  /**
   * UC18 — Tải xuống tài liệu lớp (presigned URL)
   */
  async downloadMaterial(materialId, tenant) {
    const material = await ClassMaterialRepository.findById(
      materialId,
      tenant.schoolId
    );
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, tenant);

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

module.exports = ClassMaterialService;

