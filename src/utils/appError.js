/** Lỗi nghiệp vụ có mã (message) + HTTP status + dữ liệu đính kèm tuỳ chọn. */
class AppError extends Error {
  constructor(message, status = 400, data) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.data = data;
  }
}

module.exports = { AppError };

