const multer = require('multer');
const { decodeUtf8Filename } = require('../utils/file.util');

const baseUpload = multer({ storage: multer.memoryStorage() });

/**
 * Middleware tự động chuẩn hóa encoding UTF-8 cho tên file (file.originalname)
 * khắc phục việc multer / busboy tự động parse header theo latin1 làm lỗi font tiếng Việt.
 */
function decodeUploadedFiles(req, res, next) {
  if (req.file) {
    req.file.originalname = decodeUtf8Filename(req.file.originalname);
  }
  if (req.files) {
    if (Array.isArray(req.files)) {
      req.files.forEach((file) => {
        if (file && file.originalname) {
          file.originalname = decodeUtf8Filename(file.originalname);
        }
      });
    } else if (typeof req.files === 'object') {
      Object.values(req.files).forEach((fileArr) => {
        if (Array.isArray(fileArr)) {
          fileArr.forEach((file) => {
            if (file && file.originalname) {
              file.originalname = decodeUtf8Filename(file.originalname);
            }
          });
        }
      });
    }
  }
  next();
}

/**
 * Wrapper upload middleware tự động gắn decodeUploadedFiles
 */
const upload = {
  single: (fieldName) => [baseUpload.single(fieldName), decodeUploadedFiles],
  array: (fieldName, maxCount) => [baseUpload.array(fieldName, maxCount), decodeUploadedFiles],
  fields: (fields) => [baseUpload.fields(fields), decodeUploadedFiles],
  any: () => [baseUpload.any(), decodeUploadedFiles],
  none: () => baseUpload.none(),
};

module.exports = {
  upload,
  baseUpload,
  decodeUploadedFiles,
};
