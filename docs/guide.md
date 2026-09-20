Tạo 1 folder tên là seaweedfs cùng cấp với src rồi trong đó tạo 1 file tên là s3.json
Sau đó tạo .env với docker-compose.yml cùng cấp src
Add 3 cái trong phần key chỗ docs
Open Docker, open cmd ở backend rồi nhập
docker compose up -d

# Lưu ý: Kéo code xong npm install

# Rule Coding

Hiện tại code không dùng ORM nên không khai báo entity trong code nên flow sẽ theo như thế này

Express.js
↓
Route
↓
Controller
↓
Service
↓
Repository
↓
pg Pool
↓
Neon PostgreSQL

Không cần đi qua model =>

PostgreSQL/Neon → quản lý tables, columns, foreign keys, constraints, indexes...
Repository + pg Pool → CRUD và query SQL
Service → business logic + thuật toán
Controller → API request/response
