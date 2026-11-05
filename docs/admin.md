# EDUTrack – 5 PROMPT PHÁT TRIỂN ADMIN FE + BE

## QUY TẮC CHUNG – ÁP DỤNG CHO CẢ 5 PROMPT

Bạn đang làm việc trên dự án EduTrack, gồm hai repository:

- Backend: `EDUX-FA26/EDUX-BACKEND`
- Frontend: `EDUX-FA26/EDUX-FRONTEND`

Đây là dự án đang phát triển, đã có nghiệp vụ, database, API và giao diện. Nhiệm vụ của bạn là **đọc và mở rộng code hiện tại**, không phải tạo một dự án mới.

### 1. Công nghệ và kiến trúc bắt buộc tuân thủ

**Backend**
- Node.js + Express 5.
- CommonJS (`require`, `module.exports`).
- PostgreSQL.
- Sử dụng `pg`, `pool`, `withTransaction` và Repository Pattern đang có.
- Validation bằng Zod và middleware hiện tại.
- Giữ cấu trúc Controller → Service → Repository → Database.
- Authentication và authorization sử dụng middleware hiện có.
- Excel sử dụng ExcelJS.
- Realtime sử dụng Socket.IO nếu nghiệp vụ thực sự cần.

**Frontend**
- React 19 + Vite.
- JavaScript/JSX, không tự chuyển dự án sang TypeScript.
- React Router hiện tại.
- Sử dụng `DashboardLayout`, `ProtectedRoute` và hệ thống role hiện có.
- Gọi API thông qua Axios services trong `src/services/`.
- Giữ cách tổ chức component, CSS và design token hiện tại.
- Tái sử dụng component, hooks, service và utility đã có.

### 2. Nguyên tắc bắt buộc khi chỉnh sửa

1. Đọc các file liên quan trước khi code.
2. Không tự tạo API, database table hoặc field khi chưa kiểm tra dữ liệu hiện tại.
3. Không tạo module trùng chức năng với module đang tồn tại.
4. Không viết lại toàn bộ dự án hoặc thay đổi kiến trúc chỉ để phục vụ một chức năng.
5. Không xóa hoặc làm hỏng chức năng đang chạy của Student, Lecturer và các role khác.
6. Không thay đổi tên field, cấu trúc response hoặc API hiện có nếu chưa đánh giá ảnh hưởng đến các màn hình khác.
7. Mọi thao tác quản trị quan trọng phải được xác thực và phân quyền ở Backend.
8. Không sử dụng Mock Data để giả lập thành công khi API hoặc database bị lỗi.
9. Không để lộ password, access token, refresh token hoặc dữ liệu nhạy cảm trong response và log.
10. Không xóa dữ liệu học vụ liên quan một cách tùy tiện.
11. Các thao tác ghi dữ liệu quan trọng phải có transaction và xử lý lỗi phù hợp.
12. Không tự ý nâng cấp hoặc cài thêm thư viện nếu chưa thực sự cần thiết.

### 3. Quy trình làm việc bắt buộc

Thực hiện theo từng bước:

**Bước 1 – Audit code hiện tại**

- Đọc cấu trúc hai repository.
- Xác định module BE liên quan.
- Xác định trang FE liên quan.
- Đọc routes, controllers, services, repositories, validation và database schema.
- Xác định API đang hoạt động và API chưa được mount.
- Xác định các chức năng đã có, chưa có và đang bị lỗi.
- Kiểm tra những nơi đang sử dụng module hoặc API có thể bị ảnh hưởng.

**Bước 2 – Đưa ra thiết kế trước khi code**

Trình bày:
- Nghiệp vụ và use cases.
- Luồng hoạt động của Admin.
- Danh sách màn hình FE.
- Danh sách API BE.
- Request và response dự kiến.
- Các bảng database cần sử dụng hoặc bổ sung.
- Quy tắc phân quyền.
- Những file sẽ tạo, sửa và lý do sửa.

**Bước 3 – Triển khai**

- Triển khai BE và FE theo từng phần có thể kiểm thử.
- Ưu tiên tái sử dụng module hiện tại.
- Không để FE gọi API chưa được triển khai.
- Không để API chưa được mount trong `src/app.js`.
- Không tạo dữ liệu giả để che lỗi.
- Giữ tương thích với các chức năng hiện có.

**Bước 4 – Kiểm thử**

- Test validation.
- Test authentication và authorization.
- Test dữ liệu hợp lệ và không hợp lệ.
- Test trường hợp không có dữ liệu.
- Test phân trang, lọc và tìm kiếm.
- Test lỗi database và transaction.
- Test các luồng FE thực tế.
- Kiểm tra build FE và test BE.

**Bước 5 – Báo cáo hoàn thành**

Cung cấp:
- Danh sách file đã tạo.
- Danh sách file đã sửa.
- API đã triển khai.
- Database đã thay đổi.
- Luồng nghiệp vụ đã hoàn thành.
- Kết quả test.
- Các phần còn thiếu hoặc cần triển khai tiếp.

Không được tuyên bố hoàn thành nếu chưa kiểm tra luồng thực tế.

---

# PROMPT 1 – SMART ACADEMIC IMPORT CENTER

## 1. Mục tiêu

Phát triển chức năng Smart Academic Import Center dành cho Admin của EduTrack.

Mục đích là cho phép Admin nhập dữ liệu học vụ từ Excel một cách an toàn, có kiểm tra dữ liệu trước khi ghi vào PostgreSQL, tránh tạo dữ liệu trùng, sai liên kết hoặc gây ảnh hưởng đến dữ liệu hiện tại.

Đây không đơn thuần là chức năng upload Excel. Đây phải là một quy trình import dữ liệu hoàn chỉnh, có thể kiểm tra, xác nhận, theo dõi và truy xuất lịch sử.

## 2. Khảo sát code hiện tại

Đọc kỹ các file:

Backend:
- `src/modules/admin/admin.routes.js`
- `src/modules/admin/admin.controller.js`
- `src/modules/admin/admin.service.js`
- `src/modules/admin/admin.repository.js`
- `src/modules/admin/admin.validation.js`
- `src/modules/classes/classes.routes.js`
- `src/modules/classes/classes.controller.js`
- `src/modules/classes/classes.service.js`
- `src/modules/classes/classes.repository.js`
- `src/modules/semesters/`
- `src/modules/subjects/`
- `src/modules/users/`
- `src/config/db.config.js`
- `src/app.js`

Frontend:
- `src/pages/admin/ClassManagementPage.jsx`
- `src/pages/admin/UserManagementPage.jsx`
- `src/services/admin.service.js`
- `src/services/adminService.js`
- `src/services/class.service.js`
- `src/services/semester.service.js`
- `src/services/subject.service.js`
- `src/routes/AppRoutes.jsx`

Đặc biệt kiểm tra hàm `importExcelData()` và `processPreAssignedClassesImport()`.

Hiện tại:
- API `POST /api/admin/users/import` nhận file Excel và ghi dữ liệu ngay.
- File có cấu trúc 10 cột gồm thông tin sinh viên, ngành, kỳ học, lớp, môn học và giảng viên.
- Backend có thể tự tạo user, department, semester, subject và class còn thiếu.
- Có sử dụng transaction.
- Có cơ chế tạo tài khoản với mật khẩu mặc định.

Không được giữ nguyên cách import này rồi chỉ thêm giao diện Preview. Phải đánh giá lại tính an toàn của toàn bộ quy trình.

## 3. Nghiệp vụ cần xây dựng

### A. Import Dashboard

Tạo một màn hình Import Center cho Admin với:

- Tổng số lần import.
- Số bản ghi đã import.
- Số bản ghi thành công.
- Số bản ghi thất bại.
- Số bản ghi bị bỏ qua.
- Lịch sử các lần import gần đây.
- Trạng thái từng Import Job.

Các trạng thái đề xuất:
- `uploaded`
- `validating`
- `ready`
- `processing`
- `completed`
- `completed_with_errors`
- `failed`
- `cancelled`

### B. Import File

Hỗ trợ các nhóm dữ liệu:

1. Students.
2. Lecturers.
3. Academic Classes.
4. Class Members / Enrollment.
5. Subjects.
6. Semesters.
7. Academic Assignment Data.

Không được mặc định mọi file đều có cùng cấu trúc 10 cột.

Hãy thiết kế Template riêng cho từng loại dữ liệu, có:
- Tải template Excel.
- Tên cột rõ ràng.
- Field bắt buộc và không bắt buộc.
- Ví dụ dữ liệu.
- Quy định định dạng.

### C. Preview Data

Sau khi upload:

- Đọc file Excel.
- Kiểm tra sheet.
- Kiểm tra header.
- Kiểm tra kiểu dữ liệu.
- Hiển thị dữ liệu trước khi import.
- Cho phép Admin chọn sheet nếu template hỗ trợ nhiều sheet.
- Hiển thị tổng số dòng.
- Hiển thị dữ liệu hợp lệ và không hợp lệ.

Chưa được ghi dữ liệu vào database tại bước này.

### D. Data Validation

Kiểm tra:

- Email đúng định dạng.
- Student Code không bị trùng.
- Email không bị trùng.
- Lecturer Code hợp lệ.
- Subject Code tồn tại hoặc được tạo theo lựa chọn cho phép.
- Semester tồn tại và phù hợp.
- Class Code không trùng trong phạm vi nghiệp vụ.
- Sinh viên không bị thêm trùng vào cùng một lớp.
- Giảng viên được phân công hợp lệ.
- Những field bắt buộc không được bỏ trống.
- UUID và quan hệ khóa ngoại phải hợp lệ.
- Kiểm tra dữ liệu trùng trong chính file Excel.
- Kiểm tra xung đột với dữ liệu đang có trong database.

Phân loại lỗi:
- Error: Không thể import.
- Warning: Có thể import nhưng cần Admin xác nhận.
- Info: Thông tin bổ sung.

### E. Review & Confirm

Admin phải xem được:

- Tổng số dòng hợp lệ.
- Tổng số dòng lỗi.
- Tổng số dòng cảnh báo.
- Các bản ghi sẽ được tạo mới.
- Các bản ghi sẽ được cập nhật.
- Các bản ghi sẽ được bỏ qua.

Cho phép Admin:
- Chỉ import các dòng hợp lệ.
- Bỏ qua các dòng lỗi.
- Hủy import.
- Tải file báo cáo lỗi.
- Xem chi tiết từng dòng.

Không cho phép hệ thống tự ý cập nhật hoặc xóa dữ liệu đang có mà Admin không biết.

### F. Import Execution

Khi Admin xác nhận:

- Kiểm tra lại quyền và trạng thái Import Job.
- Xác nhận file chưa bị thay đổi.
- Xử lý dữ liệu bằng transaction hoặc batch transaction phù hợp.
- Tránh import trùng khi người dùng nhấn xác nhận nhiều lần.
- Ghi nhận kết quả từng bản ghi.
- Có cơ chế rollback khi xảy ra lỗi nghiêm trọng.
- Không tạo tài khoản bằng mật khẩu mặc định dùng chung.

Đối với tài khoản mới:
- Tạo tài khoản theo cơ chế bảo mật hiện có.
- Ưu tiên invitation hoặc password setup flow.
- Nếu cần tạo mật khẩu tạm thời thì phải có quy trình bảo mật và yêu cầu đổi mật khẩu.
- Không trả password trong response import.

### G. Import History

Admin có thể:
- Xem lịch sử import.
- Xem người thực hiện.
- Xem thời gian.
- Xem tên file.
- Xem loại dữ liệu.
- Xem tổng số dòng.
- Xem kết quả.
- Xem lỗi.
- Xem trạng thái.
- Xem chi tiết Import Job.

## 4. Yêu cầu Backend

Thiết kế các endpoint phù hợp, sau khi kiểm tra API hiện có:

- `POST /api/admin/imports/preview`
- `POST /api/admin/imports/confirm`
- `GET /api/admin/imports`
- `GET /api/admin/imports/:id`
- `GET /api/admin/imports/:id/errors`
- `GET /api/admin/imports/:id/report`
- `GET /api/admin/imports/templates/:type`

Đây là API mục tiêu. Nếu có route hoặc service tương đương thì phải tái sử dụng hoặc mở rộng, không tạo bản trùng.

Tổ chức BE theo cấu trúc hiện tại:

- Routes.
- Controller.
- Service.
- Repository.
- Validation.

Cần xem xét bổ sung các bảng:
- `import_jobs`
- `import_job_rows` hoặc cấu trúc lưu lỗi/chi tiết phù hợp.

Chỉ tạo bảng mới khi xác nhận schema hiện tại chưa có khả năng đáp ứng.

Dữ liệu Import Job cần lưu:
- ID.
- Người thực hiện.
- Loại import.
- File name.
- File checksum hoặc thông tin nhận diện file.
- Trạng thái.
- Tổng dòng.
- Số dòng thành công.
- Số dòng lỗi.
- Số dòng bỏ qua.
- Thời gian tạo và hoàn thành.

## 5. Yêu cầu Frontend

Tạo màn hình:
`AdminImportCenterPage.jsx`

Các khu vực:

1. Import Overview.
2. Select Import Type.
3. Upload File.
4. Preview Table.
5. Validation Summary.
6. Error & Warning Details.
7. Import Confirmation.
8. Import Result.
9. Import History.
10. Import Job Detail.

Yêu cầu giao diện:
- Phù hợp giao diện hiện tại của EduTrack.
- Có loading state.
- Có empty state.
- Có error state.
- Có progress state.
- Có xác nhận trước khi import.
- Có thông báo kết quả rõ ràng.
- Bảng dữ liệu có pagination.
- Không tải toàn bộ dữ liệu lớn vào trình duyệt.

## 6. Tiêu chí nghiệm thu

- Upload file hợp lệ thành công.
- File sai cấu trúc bị từ chối.
- Dữ liệu lỗi được chỉ rõ dòng và cột.
- Preview không ghi dữ liệu vào database.
- Admin có thể xác nhận hoặc hủy.
- Không tạo trùng user, class, subject, semester hoặc enrollment.
- Import có lịch sử.
- Có thể xem báo cáo lỗi.
- Không sử dụng mật khẩu mặc định dùng chung.
- Các chức năng User Management và Class Management cũ vẫn hoạt động.

---

# PROMPT 2 – AI TRANSPARENCY & REVIEW CENTER

## 1. Mục tiêu

Phát triển AI Transparency & Review Center – trung tâm quản trị minh bạch AI dành cho Admin.

Đây là một trong những chức năng đặc trưng nhất của EduTrack.

Mục đích:
- Theo dõi việc sử dụng AI trong học tập.
- Thống kê mức độ khai báo AI.
- Phân tích hành vi sử dụng AI ở cấp hệ thống.
- Quản lý các trường hợp cần xem xét.
- Quản lý chính sách khai báo AI.
- Đảm bảo AI được sử dụng minh bạch và có trách nhiệm.

Không xây dựng AI Detector để tự động kết luận sinh viên gian lận.

## 2. Khảo sát code hiện tại

Backend cần đọc:

- `src/modules/ai-audit/`
- `src/modules/ai-chat/`
- `src/modules/ai-engine/`
- `src/modules/reports/`
- `src/modules/flags/`
- `src/modules/submissions/`
- `src/modules/submission-viewer/`
- `src/modules/grading/`
- `prisma/schema.prisma`
- `src/app.js`

Frontend cần đọc:

- `src/pages/admin/AdminReportsPage.jsx`
- `src/components/dashboard/TransparencyChart.jsx`
- `src/components/flags/FlagBadge.jsx`
- `src/components/flags/FlagList.jsx`
- `src/services/aiAudit.service.js`
- `src/services/report.service.js`
- `src/services/flag.service.js`
- `src/routes/AppRoutes.jsx`

Kiểm tra database hiện có.

Trong `prisma/schema.prisma` hiện thấy các model:
- `AiInteraction`
- `AiEvaluation`

Các field đáng chú ý:
- `ai_tool`
- `usage_purpose`
- `prompt_content`
- `ai_response_summary`
- `student_decision`
- `reflection_text`
- `risk_level`
- `transparency_score`
- `prompt_quality_score`
- `reflection_quality_score`
- `critical_thinking_score`
- `ai_dependency_score`

Không tự giả định toàn bộ dữ liệu đã được lưu đúng hoặc tất cả module AI đã được mount trong Express.

Phải truy tìm nguồn dữ liệu thật, quan hệ với submission, assignment, student, class và submission version.

## 3. Nghiệp vụ cần xây dựng

### A. AI Transparency Dashboard

Tạo Dashboard tổng quan:

- Total AI Interactions.
- Total Students Using AI.
- AI Adoption Rate.
- Transparency Declaration Rate.
- Reflection Completion Rate.
- AI Tool Distribution.
- Student Decision Distribution.
- AI Usage Trends.
- Transparency Score Distribution.
- AI Evaluation Summary.

Cho phép lọc:
- Semester.
- Subject.
- Class.
- Lecturer.
- Student.
- AI Tool.
- Date Range.

Các chỉ số phải có định nghĩa và công thức rõ ràng.

Ví dụ:
- Transparency Rate = số lượt sử dụng AI có khai báo hợp lệ / tổng lượt sử dụng AI cần khai báo.
- Reflection Completion Rate = số lượt có reflection hợp lệ / tổng lượt cần reflection.

Không tự tạo số liệu nếu database chưa có dữ liệu.

### B. AI Tool Analytics

Thống kê các công cụ AI:
- ChatGPT.
- Gemini.
- Claude.
- Copilot.
- Các công cụ khác được lưu trong database.

Hiển thị:
- Số lượt sử dụng.
- Mục đích sử dụng.
- Xu hướng sử dụng.
- Tỷ lệ theo từng công cụ.
- So sánh theo môn học và kỳ học.

Không hardcode danh sách công cụ nếu hệ thống có thể phát sinh thêm công cụ mới.

### C. AI Declaration Review

Xây dựng danh sách trường hợp cần Admin hoặc người có thẩm quyền xem xét:

- Thiếu khai báo AI trong trường hợp bắt buộc.
- Thiếu reflection.
- Dữ liệu AI Audit không đầy đủ.
- AI Evaluation không có dữ liệu tương ứng.
- Dữ liệu không liên kết được với submission version.
- Các chỉ số bất thường cần kiểm tra.

Mỗi trường hợp phải có:
- ID.
- Sinh viên.
- Lớp.
- Môn học.
- Assignment.
- Submission.
- Loại vấn đề.
- Mức độ ưu tiên.
- Ngày phát hiện.
- Trạng thái xử lý.
- Người xử lý.
- Ghi chú xử lý.

Trạng thái đề xuất:
- `open`
- `under_review`
- `resolved`
- `dismissed`

Admin có thể:
- Mở chi tiết.
- Ghi nhận kết quả xem xét.
- Chuyển người phụ trách nếu có cơ chế phù hợp.
- Đóng trường hợp.
- Ghi lý do xử lý.

Không tự động gán nhãn gian lận dựa trên AI Dependency Score hoặc Risk Level.

### D. AI Transparency Detail

Khi xem một trường hợp, hiển thị thông tin có liên quan:
- Thông tin bài nộp.
- Phiên bản bài nộp.
- Công cụ AI được khai báo.
- Mục đích sử dụng.
- Student Decision.
- Reflection.
- Các chỉ số evaluation.
- Lịch sử xử lý.

Không mặc định hiển thị toàn bộ `prompt_content` cho mọi Admin.

Phải có quyền truy cập chi tiết riêng, giới hạn dữ liệu nhạy cảm và ghi audit khi xem dữ liệu nhạy cảm.

### E. AI Policy Management

Cho phép Admin quản lý chính sách sử dụng AI:

- Policy Name.
- Description.
- Semester.
- Subject/Class scope nếu nghiệp vụ hỗ trợ.
- Require AI Declaration.
- Require Reflection.
- Required Declaration Fields.
- Allowed AI Tools nếu cần.
- Effective Date.
- Expiration Date.
- Version.
- Status.

Chính sách phải có lịch sử phiên bản.

Không được thay đổi ngược chính sách đã áp dụng cho bài nộp cũ mà không có cơ chế versioning.

## 4. Backend API

Đề xuất API sau khi kiểm tra module hiện có:

- `GET /api/admin/ai-transparency/overview`
- `GET /api/admin/ai-transparency/trends`
- `GET /api/admin/ai-transparency/tools`
- `GET /api/admin/ai-transparency/breakdown`
- `GET /api/admin/ai-transparency/reviews`
- `GET /api/admin/ai-transparency/reviews/:id`
- `PATCH /api/admin/ai-transparency/reviews/:id`
- `GET /api/admin/ai-policies`
- `GET /api/admin/ai-policies/:id`
- `POST /api/admin/ai-policies`
- `PATCH /api/admin/ai-policies/:id`
- `GET /api/admin/ai-policies/:id/history`

Tận dụng các repository/service AI Audit và Reports hiện có.

Nếu module chưa được mount, phải đăng ký route đúng trong `src/app.js` hoặc theo cách tổ chức phù hợp.

Các API thống kê cần hỗ trợ:
- Pagination.
- Search.
- Date range.
- Semester filter.
- Class filter.
- Subject filter.
- Sorting.

Không lấy toàn bộ bản ghi AI rồi tính toán ở Frontend.

## 5. Frontend

Tạo khu vực Admin AI Governance gồm:

### Page 1: AI Transparency Dashboard
- KPI Cards.
- AI Tool Distribution Chart.
- Transparency Trend Chart.
- Student Decision Chart.
- Class/Subject Comparison.
- Filter Panel.

### Page 2: AI Review Center
- Review List.
- Status Filter.
- Risk/Priority Filter.
- Search.
- Pagination.
- Review Detail Drawer hoặc Detail Page.

### Page 3: AI Policy Management
- Policy List.
- Create Policy.
- Edit Policy.
- Policy Detail.
- Version History.
- Activate/Deactivate.

Có thể tái sử dụng `TransparencyChart.jsx`, `FlagList.jsx` và các component phù hợp.

Không tạo chart giả hoặc số liệu demo khi API lỗi.

## 6. Tiêu chí nghiệm thu

- Dashboard sử dụng dữ liệu thật.
- Công thức thống kê được xác định rõ.
- Filter hoạt động đúng.
- Review có trạng thái và lịch sử.
- Policy có version.
- Không tự động kết luận vi phạm.
- Có phân quyền dữ liệu chi tiết.
- Không làm ảnh hưởng luồng AI Audit và Submission hiện tại.

---

# PROMPT 3 – LEARNING ANALYTICS & EARLY SUPPORT

## 1. Mục tiêu

Phát triển Learning Analytics & Early Support cho Admin.

Đây là chức năng phân tích hoạt động học tập toàn hệ thống, giúp Admin nhận diện xu hướng học tập, mức độ tham gia và các lớp/sinh viên có dấu hiệu cần hỗ trợ.

Chức năng này tập trung vào **Learning Activity**, không trùng với AI Transparency.

Phân biệt:
- AI Transparency: Sinh viên sử dụng và khai báo AI như thế nào.
- Learning Analytics: Sinh viên tham gia hoạt động học tập, sử dụng tài liệu, làm bài và nộp bài như thế nào.

## 2. Khảo sát code

Backend:

- `src/modules/activity-tracking/`
- `src/modules/dashboards/`
- `src/modules/learning/`
- `src/modules/assignments/`
- `src/modules/submissions/`
- `src/modules/grading/`
- `src/modules/classes/`
- `src/modules/reports/`
- `src/middlewares/activityLogger.middleware.js`
- `src/app.js`

Frontend:

- `src/components/activity/ActivityTimeline.jsx`
- `src/components/activity/ContributionHeatmap.jsx`
- `src/components/dashboard/RecentActivitiesList.jsx`
- `src/components/dashboard/StudentMetricsCard.jsx`
- `src/pages/admin/DashboardPage.jsx`
- `src/pages/lecturer/`
- `src/pages/student/`
- `src/services/activity.service.js`
- `src/services/dashboard.service.js`
- `src/services/learning.service.js`
- `src/services/submission.service.js`
- `src/services/grading.service.js`

Phải kiểm tra chính xác loại activity được lưu, timestamp, user ID, class ID, submission ID và khả năng liên kết dữ liệu.

Không tự giả định một lượt truy cập trang đồng nghĩa với việc sinh viên đã học nội dung đó.

## 3. Nghiệp vụ

### A. Learning Overview

Thống kê:
- Total Students.
- Active Students.
- Inactive Students.
- Total Learning Activities.
- Total Assignments.
- Total Submissions.
- On-time Submission Rate.
- Late Submission Rate.
- Pending Grading.
- Average Learning Activity.

Cho phép lọc theo:
- Semester.
- Subject.
- Class.
- Lecturer.
- Date Range.

### B. Learning Activity Analytics

Phân tích:
- Activity theo ngày/tuần/tháng.
- Số lượt xem tài liệu.
- Số lượt truy cập lớp học.
- Số lượt tham gia hoạt động học tập.
- Số lượt làm bài.
- Số lượt nộp bài.
- Số lượt chỉnh sửa/nộp lại bài nếu hệ thống lưu dữ liệu này.

Biểu đồ:
- Daily/Weekly Activity Trend.
- Activity Heatmap.
- Activity by Class.
- Activity by Subject.
- Activity Distribution.

Chỉ sử dụng loại activity thực tế có trong database.

### C. Student Engagement

Tạo bảng phân tích mức độ tham gia:

- Student.
- Student Code.
- Class.
- Subject.
- Last Activity.
- Activity Count.
- Submission Count.
- Late Submission Count.
- Missing Submission Count.
- Engagement Indicator.

Không dùng một điểm số tùy ý mà không có công thức.

Nếu xây dựng Engagement Score, phải:
- Công bố các thành phần cấu thành.
- Xác định trọng số.
- Giải thích ý nghĩa.
- Không sử dụng score làm kết luận học lực hoặc kỷ luật.

### D. Early Support Alerts

Phát hiện các trường hợp có thể cần hỗ trợ:

- Không có hoạt động trong khoảng thời gian cấu hình.
- Liên tục không nộp bài.
- Nhiều bài nộp quá hạn.
- Lớp có tỷ lệ hoàn thành bài tập thấp.
- Lớp có nhiều bài chưa được chấm.
- Mức độ hoạt động giảm đáng kể so với giai đoạn trước.

Mỗi alert phải có:
- Alert Type.
- Student/Class.
- Semester.
- Subject.
- Detected At.
- Severity.
- Evidence.
- Status.

Trạng thái:
- `new`
- `acknowledged`
- `in_progress`
- `resolved`
- `dismissed`

Admin có thể:
- Xem chi tiết.
- Ghi nhận đã tiếp nhận.
- Ghi chú.
- Chuyển thông tin đến người phụ trách.
- Đánh dấu đã xử lý.

Không tự động gửi cảnh báo cho sinh viên nếu chưa có chính sách và quy trình thông báo.

Không gắn nhãn sinh viên lười học hoặc yếu kém chỉ dựa trên dữ liệu activity.

### E. Class Comparison

So sánh các lớp trong cùng kỳ học hoặc cùng môn:

- Số sinh viên.
- Tỷ lệ hoạt động.
- Tỷ lệ nộp bài.
- Tỷ lệ đúng hạn.
- Số bài chưa chấm.
- Xu hướng hoạt động.

Chỉ so sánh các lớp có phạm vi dữ liệu tương đương.

## 4. Backend API

Đề xuất:

- `GET /api/admin/learning-analytics/overview`
- `GET /api/admin/learning-analytics/trends`
- `GET /api/admin/learning-analytics/activity-breakdown`
- `GET /api/admin/learning-analytics/classes`
- `GET /api/admin/learning-analytics/students`
- `GET /api/admin/learning-analytics/students/:id`
- `GET /api/admin/learning-analytics/alerts`
- `GET /api/admin/learning-analytics/alerts/:id`
- `PATCH /api/admin/learning-analytics/alerts/:id`

Tái sử dụng dữ liệu từ Activity Tracking, Learning, Assignments, Submissions và Grading.

Nếu cần bảng alert hoặc cấu hình ngưỡng cảnh báo, phải thiết kế schema trước.

Các truy vấn phải:
- Có filter ở database.
- Có pagination.
- Có index phù hợp.
- Có giới hạn date range.
- Tránh N+1 queries.
- Tránh tải dữ liệu toàn hệ thống vào memory.

## 5. Frontend

Tạo:

### Learning Analytics Dashboard
- KPI Overview.
- Activity Trend.
- Activity Heatmap.
- Submission Analytics.
- Class Comparison.

### Student Engagement
- Danh sách sinh viên.
- Search.
- Filter.
- Pagination.
- Student Detail.

### Early Support Center
- Alert Summary.
- Alert List.
- Alert Detail.
- Status Management.
- Processing History.

Tái sử dụng:
- `ContributionHeatmap.jsx`.
- `ActivityTimeline.jsx`.
- Các chart component đang có.

Giao diện cần trực quan, không quá nhiều biểu đồ gây rối.

## 6. Tiêu chí nghiệm thu

- Chỉ sử dụng activity thực tế.
- Các chỉ số có công thức.
- Filter đúng theo kỳ, môn, lớp và thời gian.
- Không trùng dữ liệu submission.
- Alert có bằng chứng.
- Có trạng thái xử lý.
- Không tự kết luận về năng lực hoặc thái độ sinh viên.
- Không ảnh hưởng các trang Student và Lecturer.

---

# PROMPT 4 – AUDIT TRAIL & SYSTEM MONITORING

## 1. Mục tiêu

Phát triển trung tâm giám sát và kiểm toán hệ thống cho Admin.

Phải phân biệt rõ hai nghiệp vụ:

**Audit Trail:** Theo dõi hành động của người dùng và thay đổi dữ liệu nghiệp vụ.

**System Monitoring:** Theo dõi tình trạng kỹ thuật và sức khỏe hệ thống.

Không gộp tất cả vào một bảng log không có cấu trúc.

## 2. Khảo sát code

Backend:

- `src/modules/admin/`
- `src/modules/reports/`
- `src/middlewares/activityLogger.middleware.js`
- `src/middlewares/auth.middleware.js`
- `src/middlewares/role.middleware.js`
- `src/middlewares/rbac.middleware.js`
- `src/config/db.config.js`
- `src/config/socket.config.js`
- `src/app.js`
- `src/jobs/notification.job.js`

Frontend:

- `src/pages/admin/SystemLogsPage.jsx`
- `src/pages/admin/AdminReportsPage.jsx`
- `src/services/admin.service.js`
- `src/services/report.service.js`
- `src/routes/AppRoutes.jsx`

Hiện tại:
- FE có `SystemLogsPage.jsx`.
- FE gọi `GET /api/admin/system-logs`.
- `admin.routes.js` hiện chưa khai báo route `/system-logs`.
- Reports có API `/api/reports/audit-logs`.
- Reports Audit Logs và System Logs không được mặc định coi là cùng một nguồn dữ liệu.

Phải kiểm tra các nguồn log đang tồn tại và quyết định cách hợp nhất phù hợp.

## 3. Audit Trail

### A. Theo dõi hành động quan trọng

Ghi nhận:

- Create User.
- Update User.
- Suspend User.
- Activate User.
- Import Excel.
- Create Class.
- Update Class.
- Archive/Delete Class.
- Create Semester.
- Update Semester.
- Activate/Close/Lock Semester.
- Create Subject.
- Update Subject.
- Deactivate Subject.
- Change AI Policy.
- Review AI Case.
- Export Data.
- Change Permissions nếu có.

### B. Audit Log Structure

Mỗi bản ghi nên có:

- ID.
- Actor User ID.
- Actor Role.
- Action.
- Entity Type.
- Entity ID.
- Description.
- Before Data.
- After Data.
- IP Address nếu có thể thu thập an toàn.
- User Agent nếu phù hợp.
- Created At.
- Result/Status.

Không ghi password, token hoặc thông tin xác thực.

Before/After chỉ lưu field nghiệp vụ cần thiết; không sao chép toàn bộ dữ liệu nhạy cảm.

### C. Audit Log Viewer

Admin có thể:
- Xem danh sách.
- Tìm kiếm.
- Lọc theo người thực hiện.
- Lọc theo hành động.
- Lọc theo loại đối tượng.
- Lọc theo ngày.
- Xem chi tiết thay đổi.
- So sánh giá trị trước và sau.
- Export log theo phạm vi được phép.

Audit Trail phải là dữ liệu append-only đối với người dùng thông thường. Không cung cấp API cho Admin sửa nội dung audit log.

## 4. System Monitoring

### A. System Health

Theo dõi những thành phần thực tế của EduTrack:

- Backend API.
- PostgreSQL.
- Redis.
- Socket.IO.
- Storage/S3 hoặc SeaweedFS nếu đang được sử dụng.
- Notification Job.
- Background Processing nếu có.

Không hiển thị trạng thái giả.

Nếu chưa có cơ chế thu thập CPU/RAM, không tạo số liệu CPU/RAM ngẫu nhiên.

### B. API Monitoring

Nếu có cơ chế đo lường phù hợp, theo dõi:

- Request Count.
- Response Time.
- Error Rate.
- HTTP 4xx.
- HTTP 5xx.
- Slow Requests.
- Failed Jobs.

Không lưu toàn bộ request body vào log.

### C. System Logs

Phân loại:
- Info.
- Warning.
- Error.
- Critical.

Mỗi log nên có:
- Timestamp.
- Source.
- Severity.
- Message.
- Correlation ID hoặc Request ID.
- Error Code nếu có.
- Stack Trace chỉ dành cho quyền kỹ thuật phù hợp.

Không để lộ stack trace, SQL query chứa dữ liệu nhạy cảm hoặc credential cho người dùng FE.

## 5. Backend API

Đề xuất:

Audit:
- `GET /api/admin/audit-logs`
- `GET /api/admin/audit-logs/:id`
- `GET /api/admin/audit-logs/export`

Monitoring:
- `GET /api/admin/system/health`
- `GET /api/admin/system/metrics`
- `GET /api/admin/system/logs`
- `GET /api/admin/system/logs/:id`

Các route phải sử dụng authentication và authorization.

Cần xây dựng cơ chế audit dùng chung để các module hiện có có thể ghi log mà không phải viết lại logic ở từng nơi.

Nên xem xét transaction hoặc after-commit phù hợp để audit không ghi nhận một thay đổi thất bại như thể đã thành công.

Đối với lỗi hệ thống, có thể tích hợp structured logging phù hợp với cấu trúc hiện tại.

Không tự cài hệ thống monitoring bên ngoài nếu chưa cần thiết.

## 6. Frontend

Tạo khu vực System Monitoring gồm:

### System Health Dashboard
- Component Status.
- API Health.
- Database Status.
- Redis Status.
- Storage Status.
- Background Job Status.

### System Logs
- Log Table.
- Severity Filter.
- Date Filter.
- Search.
- Detail View.
- Pagination.

### Audit Trail
- Audit Table.
- Actor Filter.
- Action Filter.
- Entity Filter.
- Date Range.
- Detail View.
- Before/After Comparison.
- Export.

Thay thế Mock fallback trong `SystemLogsPage.jsx`.

Khi API lỗi, phải hiển thị lỗi thật, không được hiển thị log mẫu như log thực tế.

## 7. Tiêu chí nghiệm thu

- Ghi nhận đúng người thực hiện.
- Ghi nhận đúng hành động.
- Audit không ghi nhận nhầm thao tác thất bại.
- Có dữ liệu trước/sau phù hợp.
- Không chứa secret.
- Log có pagination và filter.
- System Health lấy từ kiểm tra thực tế.
- System Logs và Audit Trail được phân biệt.
- FE không hiển thị dữ liệu Mock như dữ liệu thật.

---

# PROMPT 5 – ACADEMIC MANAGEMENT CENTER

## 1. Mục tiêu

Phát triển Academic Management Center – trung tâm quản lý tổng quan học vụ dành cho Admin.

Mục tiêu là giúp Admin quản lý và theo dõi toàn bộ cấu trúc học vụ:

- Semester.
- Subject.
- Class.
- Student Enrollment.
- Lecturer Assignment.
- Department.
- Academic Data Status.

Đây không phải là một hệ thống CRUD mới thay thế các trang đang có. Đây là một trung tâm tổng quan và điều phối, tái sử dụng các chức năng quản lý hiện tại.

## 2. Khảo sát code hiện tại

Backend:

- `src/modules/admin/`
- `src/modules/classes/`
- `src/modules/semesters/`
- `src/modules/subjects/`
- `src/modules/users/`
- `src/modules/assignments/`
- `src/modules/grading/`
- `src/modules/submissions/`
- `src/modules/dashboards/`
- `src/config/db.config.js`
- `src/app.js`

Frontend:

- `src/pages/admin/DashboardPage.jsx`
- `src/pages/admin/ClassManagementPage.jsx`
- `src/pages/admin/SemesterManagementPage.jsx`
- `src/pages/admin/SubjectManagementPage.jsx`
- `src/pages/admin/UserManagementPage.jsx`
- `src/services/admin.service.js`
- `src/services/class.service.js`
- `src/services/semester.service.js`
- `src/services/subject.service.js`
- `src/routes/AppRoutes.jsx`
- `src/layouts/DashboardLayout.jsx`

Các chức năng hiện tại:
- `/api/admin/classes`: quản lý lớp theo Admin.
- `/api/classes`: module Classes có CRUD, members và import/export.
- `/api/semesters`: có list, detail, create, update, activate, close, lock.
- `/api/subjects`: có list, detail, create, update và remove.
- FE đã có Semester Management và Subject Management riêng.

Phải kiểm tra các khác biệt giữa hai luồng quản lý lớp trước khi thay đổi.

Không tạo thêm một hệ thống Class Management thứ hai.

## 3. Nghiệp vụ cần xây dựng

### A. Academic Overview Dashboard

Hiển thị:

- Total Semesters.
- Active Semesters.
- Total Subjects.
- Active Subjects.
- Total Classes.
- Active Classes.
- Total Students.
- Total Lecturers.
- Total Enrollments.
- Classes Without Lecturer.
- Students Without Class.
- Classes Near Capacity.
- Academic Data Issues.

Các số liệu phải được tính từ database.

Cho phép chọn Semester để xem tổng quan.

### B. Semester Management

Tái sử dụng nghiệp vụ hiện có.

Admin có thể:
- Xem danh sách kỳ học.
- Tìm kiếm.
- Lọc theo trạng thái.
- Tạo kỳ học.
- Cập nhật.
- Activate.
- Close.
- Lock.
- Xem chi tiết.
- Xem các lớp và môn thuộc kỳ học.

Phải tuân thủ quy tắc chuyển trạng thái đang có.

Không cho phép thao tác gây xung đột với dữ liệu bài tập, bài nộp và điểm số đã tồn tại.

### C. Subject Management

Tái sử dụng module hiện tại.

Admin có thể:
- Xem môn học.
- Tìm kiếm.
- Lọc theo trạng thái.
- Tạo môn.
- Chỉnh sửa.
- Deactivate.
- Xem thông tin khoa/bộ môn.
- Xem các lớp thuộc môn.
- Xem thống kê theo môn.

Không xóa cứng môn học đang có dữ liệu liên quan.

### D. Class Management

Xây dựng tổng quan và điều phối lớp.

Thông tin lớp:
- Class Code.
- Semester.
- Subject.
- Lecturer.
- Max Students.
- Current Students.
- Active Status.

Admin có thể:
- Xem danh sách lớp.
- Tìm kiếm.
- Lọc theo Semester.
- Lọc theo Subject.
- Lọc theo Lecturer.
- Xem chi tiết lớp.
- Xem danh sách thành viên.
- Cập nhật thông tin lớp theo quyền.
- Xem số lượng sinh viên.
- Xem lớp chưa có giảng viên.
- Xem lớp chưa đủ hoặc vượt giới hạn.

### E. Lecturer Assignment

Quản lý phân công giảng viên:

- Xem giảng viên.
- Xem lớp chưa có giảng viên.
- Gán giảng viên cho lớp.
- Thay đổi giảng viên phụ trách.
- Xem lịch sử phân công.

Trước khi gán phải kiểm tra:
- Lecturer có tồn tại.
- Tài khoản còn hoạt động.
- Role phù hợp.
- Class có tồn tại.
- Class có được phép chỉnh sửa hay không.
- Có xung đột với quy tắc nghiệp vụ hiện có hay không.

Không tự xây dựng timetable conflict detection nếu dữ liệu lịch học chưa đủ.

### F. Student Enrollment

Quản lý tình trạng sinh viên trong lớp:

- Xem số lượng sinh viên.
- Xem sinh viên chưa có lớp.
- Xem thành viên lớp.
- Thêm sinh viên.
- Chuyển sinh viên giữa lớp nếu nghiệp vụ cho phép.
- Loại sinh viên khỏi lớp nếu có quyền.
- Kiểm tra enrollment trùng.

Phải đảm bảo:
- Không thêm trùng thành viên.
- Không làm mất lịch sử học tập.
- Không xóa submission hoặc grade liên quan.
- Kiểm tra quan hệ lớp/môn/kỳ học.

### G. Academic Data Validation

Tạo danh sách các vấn đề học vụ:

- Class không có Subject.
- Class không có Semester.
- Class chưa có Lecturer.
- Student không có Enrollment.
- Enrollment trùng.
- Class vượt Max Students.
- Subject thiếu thông tin cần thiết.
- Semester có ngày không hợp lệ.
- Dữ liệu liên kết không đúng.

Mỗi vấn đề có:
- Issue Type.
- Entity.
- Entity ID.
- Description.
- Severity.
- Detected At.
- Status.

Chỉ cung cấp chức năng sửa tự động khi có quy tắc an toàn rõ ràng.

### H. Import Center Integration

Tích hợp Smart Academic Import Center vào Academic Management Center.

Admin có thể truy cập Import Center từ:
- Academic Overview.
- Class Management.
- Student Management.

Không tạo thêm một quy trình import khác.

Các loại import và dữ liệu phải thống nhất với Prompt 1.

## 4. Backend API

Ưu tiên tận dụng các API hiện có.

API tổng quan có thể thiết kế:

- `GET /api/admin/academic/overview`
- `GET /api/admin/academic/semester-summary`
- `GET /api/admin/academic/class-statistics`
- `GET /api/admin/academic/assignment-status`
- `GET /api/admin/academic/enrollment-status`
- `GET /api/admin/academic/data-issues`

Phân công giảng viên:
- `POST /api/admin/classes/:id/assign-lecturer`
- `GET /api/admin/classes/:id/assignment-history`

Enrollment:
- `GET /api/admin/classes/:id/students`
- `POST /api/admin/classes/:id/students`
- `PATCH /api/admin/classes/:id/students/:studentId` nếu nghiệp vụ thực sự cần.

Đây là các endpoint mục tiêu. Trước khi tạo mới, hãy kiểm tra module `/api/classes` và `/api/admin/classes` để tận dụng hoặc chuẩn hóa API hiện có.

Tất cả API phải:
- Có validation.
- Có authorization.
- Có pagination.
- Có filter.
- Có transaction cho các thao tác nhiều bảng.
- Có xử lý xung đột dữ liệu.
- Không trả dữ liệu thừa.

## 5. Frontend

Tạo khu vực Academic Management:

### Page 1: Academic Overview
- Semester Selector.
- KPI Cards.
- Class Distribution.
- Subject Statistics.
- Lecturer Assignment Status.
- Enrollment Status.
- Academic Issues.

### Page 2: Class Management
- Class Table.
- Search.
- Semester Filter.
- Subject Filter.
- Lecturer Filter.
- Status Filter.
- Class Detail.
- Student List.
- Assignment Information.

### Page 3: Academic Data Issues
- Issue Summary.
- Issue List.
- Severity Filter.
- Detail.
- Processing Status.

### Tích hợp các trang hiện có

- Semester Management.
- Subject Management.
- User Management.
- Smart Import Center.

Không sao chép các modal, table, form và API service đã tồn tại nếu có thể tái sử dụng.

## 6. Tiêu chí nghiệm thu

- Tổng quan lấy dữ liệu thật.
- Lọc theo kỳ học chính xác.
- Semester Management hoạt động bình thường.
- Subject Management hoạt động bình thường.
- Class Management không bị trùng luồng.
- Phân công giảng viên đúng.
- Enrollment không bị trùng.
- Không xóa dữ liệu lịch sử học tập.
- Academic Issues có thể truy xuất chi tiết.
- Import Center được tích hợp thống nhất.

---

# YÊU CẦU CUỐI CÙNG SAU KHI HOÀN THÀNH CẢ 5 MODULE

Sau khi triển khai đủ 5 module, hãy thực hiện một lượt kiểm tra tích hợp toàn bộ Admin.

## 1. Admin Navigation

Sắp xếp menu Admin theo cấu trúc:

1. Dashboard.
2. Academic Management.
3. Smart Import Center.
4. Learning Analytics.
5. AI Transparency.
6. Audit Trail.
7. System Monitoring.
8. Users.
9. Notifications.
10. Reports.

Có thể giữ các trang Semester, Subject, Class, Users hiện tại làm trang con của nhóm phù hợp.

Không tạo menu trùng lặp.

## 2. Data Consistency

Kiểm tra mối liên kết:

- Users ↔ User Profiles.
- Students ↔ Classes.
- Classes ↔ Subjects.
- Classes ↔ Semesters.
- Classes ↔ Lecturers.
- Assignments ↔ Classes.
- Submissions ↔ Assignments.
- AI Interactions ↔ Submissions.
- AI Evaluations ↔ Submission Versions.
- Activity Tracking ↔ Users.

Không được tạo các bản ghi thống kê không có nguồn dữ liệu.

## 3. Permission & Security

Toàn bộ Admin API phải được bảo vệ bằng authentication và authorization.

Không chỉ ẩn giao diện ở FE.

Kiểm tra:
- Admin truy cập được chức năng được cấp.
- Student không truy cập được Admin API.
- Lecturer không truy cập được Admin API.
- Request thiếu token bị từ chối.
- Request có role không phù hợp bị từ chối.
- Dữ liệu nhạy cảm được giới hạn.

## 4. UX Consistency

Các trang Admin cần thống nhất:

- Page Header.
- Breadcrumb.
- Search.
- Filter.
- Table.
- Pagination.
- Modal.
- Confirmation Dialog.
- Loading State.
- Empty State.
- Error State.
- Success Notification.

Tái sử dụng CSS variables, design tokens và component hiện tại.

Không thiết kế lại toàn bộ giao diện nếu không cần thiết.

## 5. Final Integration Test

Kiểm thử các luồng:

1. Admin tạo kỳ học.
2. Admin tạo môn học.
3. Admin import dữ liệu học vụ.
4. Admin kiểm tra và xác nhận import.
5. Admin kiểm tra danh sách lớp.
6. Admin phân công giảng viên.
7. Admin kiểm tra danh sách sinh viên.
8. Admin xem Learning Analytics.
9. Admin xem AI Transparency.
10. Admin xử lý một trường hợp AI Review.
11. Admin xem Audit Trail.
12. Admin xem System Health.

Đảm bảo thao tác trong một module không làm sai dữ liệu của module khác.

## 6. Báo cáo cuối cùng

Xuất báo cáo theo bảng:

| Module | FE | BE | Database | API | Test |
|---|---|---|---|---|---|
| Smart Import Center | Trạng thái | Trạng thái | Trạng thái | Trạng thái | Trạng thái |
| AI Transparency | Trạng thái | Trạng thái | Trạng thái | Trạng thái | Trạng thái |
| Learning Analytics | Trạng thái | Trạng thái | Trạng thái | Trạng thái | Trạng thái |
| Audit & Monitoring | Trạng thái | Trạng thái | Trạng thái | Trạng thái | Trạng thái |
| Academic Management | Trạng thái | Trạng thái | Trạng thái | Trạng thái | Trạng thái |

Chỉ đánh dấu hoàn thành khi đã kiểm tra được luồng thực tế.

**Mục tiêu cuối cùng:** Xây dựng Admin thành một University Learning Operations & AI Governance Center hoàn chỉnh, sử dụng dữ liệu thật, có phân quyền, có khả năng theo dõi và quản trị toàn bộ hoạt động học vụ và minh bạch AI của EduTrack.
# ROLE: SENIOR SOFTWARE ARCHITECT & BUSINESS ANALYST – EDUTRACK ADMIN SYSTEM

Bạn đóng vai trò Senior Software Architect, Business Analyst và Full-stack Developer, chịu trách nhiệm phân tích và phát triển hệ thống Admin cho dự án EduTrack.

## 1. PROJECT CONTEXT

**Project:** EduTrack – Building a Smart Learning Activity Tracking and AI Transparency Platform for Higher Education.

**Repositories:**
- Backend: https://github.com/EDUX-FA26/EDUX-BACKEND
- Frontend: https://github.com/EDUX-FA26/EDUX-FRONTEND

EduTrack là nền tảng hỗ trợ quản lý hoạt động học tập trong môi trường đại học, tập trung vào:
- Quản lý người dùng và phân quyền.
- Quản lý cấu trúc học vụ.
- Quản lý lớp học, môn học, học kỳ.
- Quản lý bài tập, tài liệu và bài nộp.
- Theo dõi tiến độ học tập.
- Minh bạch hóa việc sử dụng AI trong quá trình học tập.
- Hỗ trợ giảng viên và nhà trường theo dõi, đánh giá hoạt động học tập.

Admin là một phân hệ quan trọng, có trách nhiệm quản trị dữ liệu nền tảng, kiểm soát hoạt động hệ thống và cung cấp thông tin hỗ trợ quản lý học vụ.

**Định hướng quan trọng:** Admin không đơn thuần là một tập hợp các trang CRUD. Các chức năng phải được xây dựng dựa trên quy trình nghiệp vụ thực tế, có quan hệ dữ liệu rõ ràng, có kiểm soát quyền hạn, có khả năng truy vết và không làm ảnh hưởng đến các nghiệp vụ đang hoạt động.

## 2. DEVELOPMENT PRINCIPLES – NGUYÊN TẮC BẮT BUỘC

### 2.1. Phải hiểu hệ thống hiện tại trước khi phát triển

Trước khi viết hoặc chỉnh sửa bất kỳ code nào, hãy kiểm tra cả hai repository:

**Backend**
- Cấu trúc thư mục và module.
- Express routes và controllers.
- Services và repositories.
- Database schema, SQL queries và migrations.
- Authentication và authorization middleware.
- Validation và error handling.
- Các API Admin hiện có.
- Các nghiệp vụ liên quan đến User, Class, Semester, Subject, Import, Reports, Notifications và Audit Logs.

**Frontend**
- Cấu trúc thư mục.
- AppRoutes và route protection.
- DashboardLayout và sidebar navigation.
- Các trang Admin hiện có.
- Components dùng chung.
- Services gọi API.
- Types, hooks, state management.
- Loading, error, empty và permission states.
- Mock data và fallback logic.

Không được chỉ đọc tên file rồi suy luận chức năng. Hãy theo dõi luồng thực tế từ UI → Service → API → Controller → Service/Repository → Database.

### 2.2. Không phá vỡ kiến trúc hiện tại

Các nguyên tắc bắt buộc:

1. Không tự ý thay đổi toàn bộ kiến trúc Backend hoặc Frontend.
2. Không chuyển đổi công nghệ lưu trữ dữ liệu nếu không có yêu cầu rõ ràng.
3. Backend hiện có sử dụng Node.js, Express và PostgreSQL với `pg`/SQL. Hãy kiểm tra và tuân thủ cách triển khai thực tế trong repository.
4. Không tự ý chuyển toàn bộ truy vấn sang Prisma chỉ vì dự án có file Prisma.
5. Không tạo API mới nếu API hiện tại đã xử lý được nghiệp vụ.
6. Không tạo thêm một module CRUD khác cho cùng một thực thể.
7. Không tạo thêm Admin Layout hoặc hệ thống phân quyền mới.
8. Không tự ý đổi tên, xóa hoặc di chuyển các file đang được sử dụng.
9. Không ghi đè hoặc xóa logic cũ khi chưa phân tích đầy đủ các nơi đang sử dụng.
10. Không sử dụng mock data để giả lập chức năng đã có Backend thật.

Nếu phát hiện code trùng lặp, API không thống nhất hoặc kiến trúc chưa hợp lý, hãy báo cáo và đề xuất phương án xử lý trước khi thay đổi.

### 2.3. Phát triển theo từng giai đoạn

Không triển khai đồng thời tất cả chức năng Admin.

Mỗi giai đoạn phải có:
- Phân tích nghiệp vụ.
- Phân tích hiện trạng.
- Xác định phạm vi.
- Thiết kế luồng xử lý.
- Thiết kế dữ liệu/API nếu cần.
- Triển khai Backend.
- Triển khai Frontend.
- Kiểm thử.
- Báo cáo kết quả.

Chỉ chuyển sang giai đoạn tiếp theo khi giai đoạn hiện tại đã được kiểm tra và xác nhận.

---

# 3. CURRENT ADMIN MODULES – CÁC CHỨC NĂNG ĐÃ CÓ

Hãy xem các chức năng dưới đây là hiện trạng ban đầu cần xác minh lại trong source code của branch đang làm việc.

| Module | Chức năng hiện có |
|---|---|
| Admin Dashboard | Tổng quan hệ thống |
| User Management | Danh sách, tìm kiếm, lọc, tạo tài khoản, khóa/mở khóa, import |
| Class Management | Quản lý lớp học, sinh viên trong lớp, cập nhật, xóa, import |
| Semester Management | Tạo, sửa, kích hoạt, đóng và khóa học kỳ |
| Subject Management | Tạo, sửa, xem và ngừng hoạt động môn học |
| Reports | Thống kê hệ thống, AI usage, audit logs, learning activity |
| Notifications | Gửi thông báo đến các nhóm người dùng |
| Search | Tìm kiếm dữ liệu hệ thống |
| System Logs | Giao diện theo dõi log hệ thống, cần xác minh API thực tế |

**Quy tắc:** Không được xây dựng lại các chức năng trên từ đầu chỉ để tạo giao diện mới.

Khi phát triển module mới, hãy ưu tiên tái sử dụng:
- Existing API.
- Existing service.
- Existing database tables.
- Existing components.
- Existing authentication và authorization.
- Existing DashboardLayout.

Nếu chức năng hiện tại mới chỉ có giao diện, mock data hoặc chưa hoàn thiện Backend, phải ghi rõ trạng thái đó.

---

# 4. TARGET ADMIN ARCHITECTURE – ĐỊNH HƯỚNG PHÁT TRIỂN

Admin sẽ được phát triển theo 5 nhóm nghiệp vụ chính.

## MODULE 1 – SMART ACADEMIC IMPORT CENTER

**Ưu tiên triển khai đầu tiên.**

### Business purpose

Đây là trung tâm nhập dữ liệu học vụ tập trung, giúp Admin đưa dữ liệu học vụ vào EduTrack một cách có kiểm soát, hạn chế sai lệch và bảo đảm tính toàn vẹn dữ liệu.

Không xây dựng Import Center chỉ để upload Excel và insert dữ liệu.

Phải quản lý được toàn bộ quy trình:

**Upload → Mapping → Validation → Preview → Confirmation → Processing → Result → History.**

### Phạm vi nghiệp vụ

Phiên bản đầu tiên tập trung nâng cấp quy trình import dữ liệu học vụ hiện có, đặc biệt là luồng dữ liệu được phân công trước (pre-assigned academic data).

Các nhóm dữ liệu cần khảo sát và xử lý theo schema hiện tại:
- Student.
- Lecturer.
- Department/Major nếu hệ thống đang hỗ trợ.
- Semester.
- Subject.
- Class.
- Các quan hệ phân công hoặc ghi danh liên quan nếu schema hiện tại có hỗ trợ.

Không tự ý bổ sung loại dữ liệu chưa tồn tại trong nghiệp vụ hoặc database.

### Quy trình nghiệp vụ

**Step 1 – Upload File**
- Admin chọn file Excel theo template được hỗ trợ.
- Kiểm tra định dạng, kích thước, cấu trúc file.
- Kiểm tra file rỗng hoặc sai định dạng.
- Không ghi dữ liệu chính thức vào database ngay khi upload.

**Step 2 – Column Mapping**
- Đọc các cột trong file.
- Đối chiếu với các trường dữ liệu của hệ thống.
- Cho phép mapping cột Excel với trường dữ liệu tương ứng khi thực sự cần thiết.
- Xác định trường bắt buộc và trường tùy chọn.
- Thông báo các cột không được nhận diện.

**Step 3 – Data Validation**

Kiểm tra dữ liệu theo nhiều cấp:

1. File validation: định dạng và cấu trúc.
2. Field validation: kiểu dữ liệu, giá trị bắt buộc.
3. Duplicate validation: dữ liệu trùng trong file và với database.
4. Relationship validation: khóa ngoại và các quan hệ học vụ.
5. Business validation: các quy tắc nghiệp vụ của hệ thống.

Ví dụ:
- Student ID không được trùng.
- Email phải hợp lệ.
- Class phải liên kết với Subject và Semester hợp lệ theo mô hình dữ liệu hiện tại.
- Lecturer phải tồn tại hoặc được tạo theo quy trình được phép.
- Không tự động tạo quan hệ nếu dữ liệu không đủ điều kiện.

**Step 4 – Preview**

Trước khi ghi dữ liệu chính thức, Admin phải xem được:
- Tổng số dòng.
- Số dòng hợp lệ.
- Số dòng có cảnh báo.
- Số dòng lỗi.
- Dữ liệu mới.
- Dữ liệu trùng.
- Các quan hệ được tạo hoặc cập nhật.
- Chi tiết lỗi theo từng dòng.

Admin có thể xem chi tiết và tải báo cáo lỗi nếu phù hợp.

**Step 5 – Confirmation**

Admin phải xác nhận trước khi xử lý dữ liệu chính thức.

Phải có chính sách rõ ràng đối với:
- Dòng hợp lệ.
- Dòng có cảnh báo.
- Dòng lỗi.
- Dữ liệu trùng.
- Dữ liệu đã tồn tại.

Không tự ý bỏ qua lỗi hoặc ghi đè dữ liệu đang có.

**Step 6 – Processing**

- Sử dụng transaction khi phù hợp.
- Đảm bảo tính toàn vẹn dữ liệu.
- Có cơ chế xử lý lỗi và rollback.
- Ngăn việc xử lý trùng một import job.
- Kiểm soát quyền Admin.
- Ghi nhận người thực hiện và thời điểm thực hiện.

**Step 7 – Result & History**

Hiển thị:
- Import status.
- Tổng số bản ghi xử lý.
- Số thành công.
- Số thất bại.
- Số bị bỏ qua.
- Thời gian thực hiện.
- Người thực hiện.
- Chi tiết lỗi.
- Báo cáo kết quả.

### Quy tắc tương thích với hệ thống cũ

Trước khi phát triển, phải kiểm tra kỹ:
- `importExcelData(fileBuffer)`.
- `processPreAssignedClassesImport(records)`.
- API `POST /api/admin/users/import`.
- Các nơi đang gọi `importExcel` ở User Management và Class Management.
- Các database tables và relationships được sử dụng trong import.

Đây là các luồng cần kiểm tra lại trên branch thực tế, không được mặc định chúng đã thay đổi hoặc hoàn thiện.

**Không được xóa luồng import hiện tại ngay lập tức.**

Phải bảo đảm Import Center mới tương thích nghiệp vụ cũ, có kiểm thử hồi quy, sau đó mới đề xuất chuyển các điểm truy cập import cũ sang trung tâm mới.

Không được tạo một API CRUD hoặc import riêng cho Student, Lecturer, Class nếu điều đó làm trùng lặp nghiệp vụ hiện có.

---

## MODULE 2 – ACADEMIC MANAGEMENT CENTER

### Business purpose

Trung tâm quản lý cấu trúc học vụ của EduTrack, giúp Admin kiểm soát và quản lý các thành phần học thuật có quan hệ với nhau.

### Scope

- Academic structure overview.
- Semester management.
- Subject management.
- Class management.
- Academic assignments và relationships.
- Student/Lecturer assignments nếu hệ thống hỗ trợ.
- Academic data consistency.

### Business requirements

Admin cần có khả năng:
- Theo dõi tổng quan cấu trúc học vụ.
- Xem các học kỳ đang hoạt động.
- Xem danh sách môn học.
- Theo dõi lớp học thuộc từng học kỳ và môn học.
- Kiểm tra quan hệ giữa lớp, môn học, học kỳ và giảng viên.
- Phát hiện dữ liệu thiếu hoặc không nhất quán.
- Điều hướng đến màn hình quản lý chi tiết hiện có.

### Important rules

Đây là trung tâm tổng hợp và điều phối nghiệp vụ, không phải một hệ thống CRUD độc lập mới.

Phải tái sử dụng các module:
- Semester Management.
- Subject Management.
- Class Management.
- User Management.

Không tạo API quản lý lớp thứ ba nếu đã tồn tại các API tương ứng.

Đặc biệt phải kiểm tra sự khác nhau giữa `/api/admin/classes` và `/api/classes`, xác định API nào đang được sử dụng ở từng nghiệp vụ trước khi thay đổi.

---

## MODULE 3 – LEARNING ANALYTICS & EARLY SUPPORT

### Business purpose

Cung cấp cho Admin góc nhìn tổng quan về hoạt động học tập và giúp phát hiện sớm các trường hợp có nguy cơ chậm tiến độ.

Không biến module này thành hệ thống đánh giá hoặc kỷ luật sinh viên tự động.

### Scope

- Learning activity overview.
- Student learning progress.
- Assignment submission statistics.
- Late and missing submissions.
- Class-level learning analytics.
- Subject-level learning analytics.
- Learning activity trends.
- Early support indicators.

### Business requirements

Admin có thể:
- Xem tổng quan hoạt động học tập.
- Theo dõi tiến độ theo lớp, môn học và học kỳ.
- Nhận diện sinh viên có dấu hiệu chậm tiến độ.
- Theo dõi tình trạng nộp bài.
- Xem xu hướng hoạt động theo thời gian.
- Điều hướng đến thông tin chi tiết khi được phân quyền.

### Important rules

- Chỉ sử dụng dữ liệu thực tế có trong hệ thống.
- Không tự tạo điểm số hoặc dữ liệu học tập.
- Không kết luận sinh viên yếu kém chỉ dựa trên một chỉ số.
- Chỉ số cảnh báo phải có giải thích rõ ràng.
- Không tự động gửi cảnh cáo hoặc áp dụng hình thức xử lý.
- Tôn trọng quyền riêng tư và RBAC.

---

## MODULE 4 – AI TRANSPARENCY & REVIEW CENTER

### Business purpose

Quản lý và theo dõi tính minh bạch trong quá trình sử dụng AI của người học.

Đây là một phần cốt lõi trong định hướng EduTrack.

### Scope

- AI usage declaration.
- AI Audit Log.
- AI Transparency Index.
- AI usage statistics.
- Student AI activity overview.
- Submission-related AI transparency information.
- Review and audit history.

### Business requirements

Admin có thể:
- Xem thống kê khai báo sử dụng AI.
- Theo dõi xu hướng sử dụng AI.
- Xem lịch sử khai báo.
- Kiểm tra thông tin minh bạch liên quan đến bài nộp.
- Theo dõi Transparency Index theo phạm vi được phép.
- Truy xuất lịch sử hoạt động liên quan đến AI.

### Important rules

EduTrack không được thiết kế thành công cụ AI detector để tự động kết luận bài làm có gian lận hoặc được tạo bởi AI.

Không:
- Tự động kết luận gian lận.
- Tự động gắn nhãn sinh viên vi phạm.
- Tự động đánh giá bài làm là AI-generated.
- Sử dụng Transparency Index như điểm đánh giá năng lực học tập.

AI Transparency phải hỗ trợ minh bạch, giải thích và truy xuất thông tin; quyết định học thuật vẫn thuộc người có thẩm quyền.

---

## MODULE 5 – AUDIT TRAIL & SYSTEM MONITORING

### Business purpose

Cung cấp khả năng truy vết hoạt động quản trị và theo dõi tình trạng vận hành hệ thống.

### Scope

- Admin activity logs.
- User management logs.
- Academic data change logs.
- Import history.
- AI audit logs.
- Authentication/security events nếu hệ thống hỗ trợ.
- System monitoring overview.
- Error and warning tracking.

### Business requirements

Mỗi sự kiện quan trọng nên ghi nhận:
- Actor.
- Action.
- Target entity.
- Target ID.
- Timestamp.
- Result/status.
- Relevant metadata.
- Request/correlation ID nếu hệ thống hỗ trợ.

Admin có thể:
- Tìm kiếm lịch sử.
- Lọc theo người thực hiện.
- Lọc theo loại hành động.
- Lọc theo thời gian.
- Xem chi tiết sự kiện.
- Truy xuất lịch sử thay đổi.

### Important rules

Audit Trail phải được xây dựng nền tảng ngay từ các giai đoạn đầu.

Đặc biệt, các thao tác sau cần được xem xét ghi log:
- Import dữ liệu.
- Tạo, khóa, mở khóa tài khoản.
- Thay đổi vai trò.
- Thay đổi dữ liệu học vụ.
- Thay đổi trạng thái học kỳ.
- Thay đổi môn học/lớp học.
- Các thao tác quản trị quan trọng khác.

Không ghi mật khẩu, access token, refresh token hoặc dữ liệu nhạy cảm không cần thiết vào log.

Phân biệt rõ:
- Audit Trail: lịch sử hành động nghiệp vụ.
- System Monitoring: trạng thái và lỗi vận hành hệ thống.

Không xem hai loại dữ liệu này là một.

---

# 5. IMPLEMENTATION ROADMAP

Phát triển theo thứ tự sau:

| Phase | Module | Priority |
|---|---|---|
| Phase 0 | Repository & Business Audit | Bắt buộc |
| Phase 1 | Smart Academic Import Center | Cao nhất |
| Phase 2 | Academic Management Center | Cao |
| Phase 3 | Learning Analytics & Early Support | Trung bình |
| Phase 4 | AI Transparency & Review Center | Cao |
| Phase 5 | Audit Trail & System Monitoring hoàn thiện | Cao |

Lưu ý: Audit logging cơ bản phải được triển khai từ Phase 1, không chờ đến Phase 5.

Không bắt đầu Phase tiếp theo khi Phase trước chưa đạt tiêu chí nghiệm thu.

---

# 6. TECHNICAL REQUIREMENTS

## Backend

Tuân thủ cấu trúc hiện có trong repository.

Ưu tiên:
- Node.js.
- Express.
- PostgreSQL.
- Existing `pg` pool and transaction patterns.
- Existing SQL/repository conventions.
- Existing authentication and RBAC.
- Existing validation and error handling.
- Existing Socket.IO mechanisms khi phù hợp.

Không tự ý tạo thêm framework hoặc thay đổi persistence layer.

Mỗi API mới phải:
- Có authentication.
- Có authorization.
- Có validation.
- Có xử lý lỗi.
- Có response structure nhất quán với dự án.
- Có kiểm soát dữ liệu đầu vào.
- Có kiểm thử.

## Frontend

Tuân thủ công nghệ và conventions hiện tại:
- React.
- Vite.
- JavaScript/JSX hoặc TypeScript nếu module hiện tại thực sự sử dụng.
- React Router.
- Axios.
- Tailwind CSS.
- React Query nếu phù hợp với cách code hiện tại.
- Existing shared components.

Tất cả trang Admin phải:
- Sử dụng DashboardLayout hiện tại.
- Tuân thủ Admin route protection.
- Có loading state.
- Có empty state.
- Có error state.
- Có pagination khi dữ liệu lớn.
- Có search/filter phù hợp.
- Có confirmation cho thao tác quan trọng.
- Responsive.
- Không hiển thị dữ liệu giả khi API thật lỗi.

---

# 7. DATABASE & DATA INTEGRITY RULES

Trước khi tạo bảng mới:
1. Kiểm tra database schema hiện tại.
2. Kiểm tra migrations.
3. Kiểm tra bảng tương đương.
4. Kiểm tra các quan hệ khóa ngoại.
5. Kiểm tra dữ liệu đang được sử dụng.
6. Xác định liệu có thể mở rộng bảng hiện có hay không.

Chỉ tạo bảng mới khi nghiệp vụ thực sự cần và không có cấu trúc tương đương.

Mọi thay đổi database phải:
- Có migration hoặc SQL script phù hợp với conventions hiện tại.
- Có rollback strategy khi cần.
- Không làm mất dữ liệu cũ.
- Không phá vỡ foreign keys.
- Có kiểm thử dữ liệu.

---

# 8. SECURITY & PERMISSION

Admin là phân hệ có quyền tác động lớn đến dữ liệu hệ thống.

Do đó:
- Mọi API phải kiểm tra quyền ở Backend.
- Không chỉ ẩn nút ở Frontend để bảo vệ chức năng.
- Không tin tưởng role do client tự gửi.
- Không cho phép truy cập dữ liệu ngoài phạm vi được phân quyền.
- Các thao tác quan trọng phải có confirmation.
- Không hardcode mật khẩu mặc định dùng chung cho tài khoản import.
- Không ghi thông tin xác thực vào log.
- Không để dữ liệu mẫu hoặc mock fallback che giấu lỗi API thật.

---

# 9. WORKFLOW – CÁCH AI PHẢI LÀM VIỆC

## STEP 1 – REPOSITORY AUDIT

Trước tiên, đọc cả hai repository và xác định branch hiện tại.

Không mặc định default branch là branch đang được nhóm sử dụng.

Nếu có thể truy cập branch đang phát triển, hãy kiểm tra đúng branch đó. Nếu không, phải ghi rõ giới hạn kiểm tra.

Tạo báo cáo gồm:

### A. Existing Admin Features
- Tên chức năng.
- Frontend page.
- Backend API.
- Service.
- Database tables.
- Trạng thái thực tế.

### B. Missing Features
- Nghiệp vụ chưa có.
- Nghiệp vụ mới có giao diện.
- Nghiệp vụ chưa có Backend.
- Nghiệp vụ có mock data.
- Nghiệp vụ đang lỗi hoặc chưa hoàn thiện.

### C. Duplicate & Architecture Issues
- API trùng lặp.
- Service trùng lặp.
- Logic nghiệp vụ trùng lặp.
- Các luồng import hiện có.
- Những phần có nguy cơ ảnh hưởng đến nhau.

### D. Dependency Analysis
- Module nào phụ thuộc module nào.
- Database entities liên quan.
- Những API cần tái sử dụng.
- Những phần cần xây dựng mới.

**Ở bước này chỉ phân tích và báo cáo. Không chỉnh sửa code.**

## STEP 2 – BUSINESS DESIGN

Sau khi audit, chọn duy nhất một module để triển khai.

Với module được chọn, hãy trình bày:

1. Business purpose.
2. Actors and permissions.
3. Preconditions.
4. Main flow.
5. Alternative flows.
6. Exception flows.
7. Business rules.
8. Data requirements.
9. API requirements.
10. Frontend screens.
11. Acceptance criteria.

Phải mô tả rõ ai thực hiện hành động gì, dữ liệu nào bị tác động và hệ thống phản hồi như thế nào.

Không thiết kế chức năng chỉ dựa trên ý tưởng giao diện.

## STEP 3 – IMPACT ANALYSIS

Trước khi code:
- Liệt kê file cần tạo.
- Liệt kê file cần chỉnh sửa.
- Liệt kê API cần tái sử dụng.
- Liệt kê API cần bổ sung.
- Liệt kê database cần thay đổi.
- Liệt kê các chức năng cũ có nguy cơ bị ảnh hưởng.
- Đề xuất cách tương thích ngược.

Không sửa các file ngoài phạm vi nếu không có lý do kỹ thuật rõ ràng.

## STEP 4 – IMPLEMENTATION

Triển khai theo thứ tự:

1. Database/migration nếu cần.
2. Backend validation.
3. Backend service/business logic.
4. Backend controller/routes.
5. Backend tests.
6. Frontend service.
7. Frontend components.
8. Frontend page.
9. Route integration.
10. Integration tests.

Không tạo toàn bộ chức năng dưới dạng mock trước rồi coi như đã hoàn thành.

Không viết một lượng code lớn khi chưa kiểm tra từng phần.

## STEP 5 – TESTING

Kiểm tra:
- Happy path.
- Invalid input.
- Missing required fields.
- Duplicate data.
- Unauthorized access.
- Forbidden access.
- Database errors.
- Transaction rollback.
- API integration.
- Frontend loading/error/empty states.
- Regression với chức năng Admin cũ.

Chỉ báo cáo những test thực sự đã chạy.

Không được nói "tested successfully" nếu mới chỉ đọc code hoặc chưa thực thi test.

## STEP 6 – COMPLETION REPORT

Sau mỗi giai đoạn, báo cáo:

- Business functions completed.
- Backend files changed.
- Frontend files changed.
- APIs reused.
- APIs added.
- Database changes.
- Tests executed and results.
- Known issues.
- Remaining tasks.
- Risks to existing modules.

Đưa ra đề xuất bước tiếp theo, nhưng không tự động chuyển sang module tiếp theo.

---

# 10. FIRST TASK – START WITH PHASE 0

**Nhiệm vụ đầu tiên: Chỉ thực hiện Repository & Business Audit cho Admin của EduTrack.**

Hãy kiểm tra:
- Backend repository.
- Frontend repository.
- Admin routes.
- Existing Admin pages.
- Existing Admin APIs.
- Existing import logic.
- Database schema and relationships.
- Authentication and authorization.
- Existing reports and audit logs.
- Duplicate services and API flows.

Đặc biệt tập trung phân tích Smart Academic Import Center vì đây là module đầu tiên dự kiến phát triển.

Hãy trả về:

1. Tổng quan kiến trúc Admin hiện tại.
2. Danh sách chức năng đã hoàn thành.
3. Danh sách chức năng chưa hoàn thành.
4. Các vấn đề về nghiệp vụ và kỹ thuật.
5. Những thành phần có thể tái sử dụng.
6. Những thành phần cần bổ sung.
7. Business flow hiện tại của Academic Import.
8. Business flow đề xuất cho Smart Academic Import Center.
9. Kế hoạch triển khai Phase 1 theo từng task nhỏ.
10. Acceptance criteria cho Phase 1.

**KHÔNG ĐƯỢC CODE HOẶC CHỈNH SỬA FILE Ở NHIỆM VỤ ĐẦU TIÊN.**

Chờ xác nhận sau khi hoàn thành báo cáo Phase 0.

---

# FINAL DEVELOPMENT PRINCIPLE

EduTrack Admin phải phát triển theo hướng:

**Business-driven → Data integrity → Security → Reusability → Incremental implementation → Testing.**

Mục tiêu không phải tạo ra nhiều màn hình Admin nhất có thể.

Mục tiêu là xây dựng một hệ thống quản trị học vụ có nghiệp vụ rõ ràng, dữ liệu nhất quán, quyền hạn an toàn, khả năng truy vết và tích hợp chặt chẽ với các phân hệ còn lại của EduTrack.

Mỗi chức năng mới phải giải quyết một vấn đề nghiệp vụ thực tế và phải phù hợp với kiến trúc hiện tại của dự án.
### 6. CLASS SCHEDULING & STUDENT CLASS ASSIGNMENT – QUẢN LÝ PHÂN LỚP VÀ LỊCH HỌC

Đây là nghiệp vụ thuộc quyền quản lý của Admin. Hệ thống không chỉ hỗ trợ tạo lớp và phân sinh viên vào lớp mà còn phải hỗ trợ Admin tổ chức lịch học phù hợp với toàn bộ hệ thống đào tạo.

#### 6.1. Mục tiêu nghiệp vụ

Admin có thể:
- Tạo và quản lý lớp học theo học kỳ, môn học và giảng viên.
- Phân bổ sinh viên vào các lớp phù hợp.
- Thiết lập thời gian học cho từng lớp.
- Kiểm tra xung đột lịch học trước khi lưu.
- Điều chỉnh lịch học hoặc phân lớp khi có thay đổi.
- Theo dõi tình trạng phân bổ lớp và lịch học toàn hệ thống.

#### 6.2. Thông tin cần có khi phân bổ lớp

Tùy theo cấu trúc dữ liệu và nghiệp vụ hiện tại của dự án, cần xem xét các thông tin:

- Class Code.
- Subject.
- Semester.
- Lecturer.
- Student List.
- Maximum Students.
- Study Days.
- Start Time – End Time.
- Study Sessions.
- Room hoặc Location (nếu hệ thống có quản lý).
- Class Status.

Không tự ý tạo thêm các trường dữ liệu nếu chưa kiểm tra schema và nghiệp vụ hiện tại.

#### 6.3. Quy trình phân lớp và xếp lịch

1. Admin chọn học kỳ cần tổ chức.
2. Admin chọn môn học và các lớp tương ứng.
3. Admin xác định hoặc lựa chọn giảng viên.
4. Admin phân bổ sinh viên vào từng lớp, có thể dựa trên danh sách import hoặc thao tác thủ công.
5. Admin thiết lập ngày học, ca học, giờ bắt đầu và kết thúc.
6. Hệ thống kiểm tra các điều kiện xung đột.
7. Hệ thống hiển thị kết quả kiểm tra để Admin điều chỉnh.
8. Admin xác nhận phân lớp và lịch học.
9. Hệ thống lưu dữ liệu và cập nhật thông tin lớp học.

#### 6.4. Quy tắc kiểm tra xung đột lịch học

Hệ thống phải kiểm tra tối thiểu:

- Một giảng viên không được phân công hai lớp có thời gian học trùng nhau.
- Một sinh viên không được xếp vào hai lớp có thời gian học trùng nhau.
- Một lớp không được có hai lịch học trùng nhau trong cùng khoảng thời gian.
- Nếu có quản lý phòng học, không được phân bổ hai lớp vào cùng một phòng trong cùng thời gian.
- Thời gian học phải thuộc phạm vi học kỳ tương ứng.
- Thời gian kết thúc phải sau thời gian bắt đầu.
- Số lượng sinh viên không được vượt quá sức chứa của lớp.
- Kiểm tra các quy định về ca học, ngày học và thời lượng buổi học theo cấu hình thực tế của hệ thống.

Không được hard-code lịch học, ca học hoặc số buổi học khi chưa xác minh quy định hiện có.

#### 6.5. Giao diện quản lý

Cần nghiên cứu khả năng xây dựng:
- Class Schedule Management.
- Weekly Timetable.
- Schedule Calendar.
- Conflict Detection.
- Student Class Assignment.
- Lecturer Schedule Overview.

Admin cần có khả năng xem lịch theo lớp, giảng viên, sinh viên và học kỳ nếu dữ liệu hiện tại hỗ trợ.

#### 6.6. Nguyên tắc triển khai

- Kiểm tra các API, database schema và chức năng quản lý lớp hiện tại trước khi phát triển.
- Tái sử dụng Class Management và các chức năng import hiện có.
- Không tạo thêm một hệ thống Class Management độc lập.
- Không tạo lịch học giả định hoặc tự động phân bổ khi chưa có quy tắc nghiệp vụ được xác nhận.
- Việc kiểm tra xung đột phải được thực hiện ở Backend, không chỉ kiểm tra ở Frontend.
- Các thao tác tạo, cập nhật, thay đổi lịch và phân lớp phải được ghi nhận Audit Log.
- Bảo đảm dữ liệu phân lớp và lịch học nhất quán sau khi import hoặc cập nhật.

#### 6.7. Yêu cầu khảo sát trước khi phát triển

Ở Phase 0, phải kiểm tra:
- Database hiện có bảng hoặc trường nào lưu lịch học.
- Có quản lý ngày học, ca học, giờ học, phòng học hay không.
- Có API nào phục vụ timetable hoặc schedule chưa.
- Quy tắc tổ chức lịch học thực tế của FPTU được thể hiện trong dữ liệu hoặc tài liệu dự án như thế nào.
- Quan hệ giữa Class, Subject, Semester, Lecturer và Student.
- Import Excel hiện tại có hỗ trợ dữ liệu lịch học hay không.

Nếu hệ thống chưa có đầy đủ dữ liệu hoặc quy tắc lịch học, hãy báo cáo phần còn thiếu và đề xuất thiết kế nghiệp vụ trước khi code.

**Lưu ý:** Admin là người kiểm soát và xác nhận việc phân lớp, xếp lịch. Hệ thống có nhiệm vụ hỗ trợ kiểm tra tính hợp lệ, phát hiện xung đột và đề xuất phương án phù hợp; không tự ý quyết định lịch học khi chưa có quy tắc được phê duyệt.