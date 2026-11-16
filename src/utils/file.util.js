const path = require('path');

/**
 * Decode tên file từ latin1 sang utf8 (nếu bị lỗi encoding do multer / busboy)
 * @param {string} rawName
 * @returns {string}
 */
function decodeUtf8Filename(rawName) {
  if (!rawName) return 'unnamed_file';
  try {
    // Chuyển ngược từ latin1 về buffer rồi decode lại thành utf8 chuẩn
    const decoded = Buffer.from(rawName, 'latin1').toString('utf8');
    // Nếu chuỗi sau decode chứa ký tự lỗi replacement (\uFFFD) thì giữ nguyên rawName (trường hợp đã là utf8 sẵn)
    return decoded.includes('\uFFFD') ? rawName : decoded;
  } catch {
    return rawName;
  }
}

/**
 * Tạo tên file an toàn cho storage key trên S3 / filesystem (bỏ dấu tiếng Việt, loại bỏ ký tự đặc biệt)
 * @param {string} originalName
 * @returns {string}
 */
function sanitizeStorageFilename(originalName) {
  if (!originalName) return 'file';
  const cleanName = decodeUtf8Filename(originalName);
  const ext = path.extname(cleanName);
  const base = path.basename(cleanName, ext);
  const safeBase = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `${safeBase || 'file'}${ext.toLowerCase()}`;
}

/**
 * Chuẩn hóa header Content-Disposition theo chuẩn RFC 5987 / RFC 6266
 * Giúp trình duyệt tải về đúng tên file tiếng Việt có dấu mà không bị lỗi font hay crash header HTTP
 * @param {string} fileName
 * @param {'attachment' | 'inline'} [disposition='attachment']
 * @returns {string}
 */
function formatContentDisposition(fileName, disposition = 'attachment') {
  const safeName = decodeUtf8Filename(fileName || 'download');
  const encodedFilename = encodeURIComponent(safeName)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
  const asciiFallback = sanitizeStorageFilename(safeName);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

module.exports = {
  decodeUtf8Filename,
  sanitizeStorageFilename,
  formatContentDisposition,
};
