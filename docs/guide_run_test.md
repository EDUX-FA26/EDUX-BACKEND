1. Chạy tất cả các test trong một thư mục cụ thể (Ví dụ: thư mục assignments)

bash
npx jest test/assignments/

2. Chạy một file test cụ thể (Ví dụ: classes.test.js)

bash
npx jest test/classes/classes.test.js

3. Chạy test tuần tự và đảm bảo tắt hết connection sau khi chạy xong (Khuyên dùng giống CI) Bởi vì cấu trúc của chúng ta có dùng chung connection của DB (pg-pool), nếu bạn chạy lệnh có thể bị treo cổng. Để chắc chắn tiến trình kết thúc sạch sẽ, bạn thêm cờ --runInBand (chạy tuần tự không phân luồng) và --forceExit (ép tắt sau khi test xong):

bash
npx jest test/assignments/ --runInBand --forceExit

4. Dùng qua npm script (Nếu đã config trong package.json) Nếu bạn muốn dùng lệnh npm run test, bạn có thể nối thêm đường dẫn bằng cách chèn -- vào trước:

bash
npm run test -- test/assignments/assignments.test.js

💡 Mẹo: Nếu bạn muốn giao diện test hiện ra chi tiết xem test nào pass/fail ở từng dòng (không bị nén lại), hãy thêm cờ --verbose:

bash
npx jest test/assignments/ --verbose
