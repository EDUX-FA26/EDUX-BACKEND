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
 * - admin: luôn được phép
 * - lecturer: phải là giảng viên của lớp
 * - student: phải là thành viên active của lớp
 */
async function verifyClassAccess(classId, user) {
  const { rows: classRows } = await pool.query(
    'SELECT * FROM classes WHERE id = $1',
    [classId]
  );
  const classData = classRows[0];
  if (!classData) throw new Error('CLASS_NOT_FOUND');

  if (user.role === 'admin') return classData;

  if (user.role === 'lecturer') {
    if (classData.lecturer_id !== user.id) throw new Error('FORBIDDEN');
    return classData;
  }

  if (user.role === 'student') {
    const { rows: memberRows } = await pool.query(
      `SELECT 1 FROM class_members
       WHERE class_id = $1 AND student_id = $2 AND status = 'active'`,
      [classId, user.id]
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
  async listMaterials(classId, query, user) {
    await verifyClassAccess(classId, user);

    const result = await ClassMaterialRepository.findByClassId(classId, {
      page: query.page,
      limit: query.limit,
    });
    return result;
  },

  /**
   * UC19 — Upload tài liệu lên lớp học (chỉ lecturer)
   */
  async uploadMaterial(classId, body, file, user) {
    const classData = await verifyClassAccess(classId, user);

    if (user.role !== 'lecturer' && user.role !== 'admin') {
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
      uploaded_by: user.id,
    });

    return material;
  },

  /**
   * UC17 — Lấy chi tiết 1 tài liệu lớp
   */
  async getMaterialById(materialId, user) {
    const material = await ClassMaterialRepository.findById(materialId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, user);

    // Nếu tài liệu là private, chỉ lecturer/admin của lớp hoặc student enrolled mới xem được
    // (verifyClassAccess đã xử lý điều này)
    return material;
  },

  /**
   * UC20 — Cập nhật metadata tài liệu lớp (chỉ lecturer)
   */
  async updateMaterial(materialId, body, user) {
    const material = await ClassMaterialRepository.findById(materialId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, user);

    if (user.role !== 'lecturer' && user.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    const updated = await ClassMaterialRepository.update(materialId, body);
    return updated;
  },

  /**
   * UC21 — Xóa tài liệu lớp (chỉ lecturer)
   */
  async deleteMaterial(materialId, user) {
    const material = await ClassMaterialRepository.findById(materialId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, user);

    if (user.role !== 'lecturer' && user.role !== 'admin') {
      throw new Error('FORBIDDEN');
    }

    // Xóa file trên S3
    await s3.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: material.file_key,
      })
    );

    const deleted = await ClassMaterialRepository.delete(materialId);
    return deleted;
  },

  /**
   * UC18 — Tải xuống tài liệu lớp (presigned URL)
   */
  async downloadMaterial(materialId, user) {
    const material = await ClassMaterialRepository.findById(materialId);
    if (!material) throw new Error('MATERIAL_NOT_FOUND');

    await verifyClassAccess(material.class_id, user);

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

