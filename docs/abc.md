# **Phân tích logic Phần B – EDUX Multi-Tenant Migration 007**

Mình đã kiểm tra code trên GitHub, tập trung vào branch [`feature/007-assessment-learning`](https://github.com/EDUX-FA26/EDUX-BACKEND/tree/feature/007-assessment-learning?utm_source=chatgpt.com).

Vì bạn đã hoàn thành Phần A, Phần B không phải xây dựng lại tính năng học tập. **Nhiệm vụ chính là giữ nguyên các tính năng đang hoạt động, nhưng đảm bảo mọi dữ liệu học tập thuộc đúng trường và người dùng.**

## **1. Hiểu logic tổng thể trước khi code**

Một Student có thể học tại hai trường:

**User X**

Một tài khoản đăng nhập, một JWT

**Trường A**

student

Deck A

Test A · Streak A

Study Plan A · Todo A

**Trường B**

student

Deck B

Test B · Streak B

Study Plan B · Todo B

Dữ liệu học tập hai trường phải cách ly

**Focus Sessions / Preferences**

Dữ liệu cá nhân toàn tài khoản User X, không tách theo trường

### **Luồng kiểm tra bắt buộc**

\#chatgpt-mermaid-\_r_vs\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_vs\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_vs\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_vs\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_vs\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_vs\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_vs\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_vs\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_vs\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_vs\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_vs\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_vs\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_vs\_ p{margin:0;}#chatgpt-mermaid-\_r_vs\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_vs\_ .label text,#chatgpt-mermaid-\_r_vs\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ .node rect,#chatgpt-mermaid-\_r_vs\_ .node circle,#chatgpt-mermaid-\_r_vs\_ .node ellipse,#chatgpt-mermaid-\_r_vs\_ .node polygon,#chatgpt-mermaid-\_r_vs\_ .node path{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ .rough-node .label text,#chatgpt-mermaid-\_r_vs\_ .node .label text,#chatgpt-mermaid-\_r_vs\_ .image-shape .label,#chatgpt-mermaid-\_r_vs\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_vs\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ .rough-node .label,#chatgpt-mermaid-\_r_vs\_ .node .label,#chatgpt-mermaid-\_r_vs\_ .image-shape .label,#chatgpt-mermaid-\_r_vs\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_vs\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_vs\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_vs\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_vs\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_vs\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_vs\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_vs\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_vs\_ .labelBkg{background-color:rgba(0, 0, 0, 0.5);}#chatgpt-mermaid-\_r_vs\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_vs\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_vs\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_vs\_ .icon-shape,#chatgpt-mermaid-\_r_vs\_ .image-shape{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_vs\_ .icon-shape p,#chatgpt-mermaid-\_r_vs\_ .image-shape p{background-color:rgb(0, 0, 0);padding:2px;}#chatgpt-mermaid-\_r_vs\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_vs\_ .image-shape .label rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_vs\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_vs\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_vs\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_vs\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_vs\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_vs\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_vs\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_vs\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_vs\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_vs\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_vs\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_vs\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_vs\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_vs\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ .node rect,#chatgpt-mermaid-\_r_vs\_ .node circle,#chatgpt-mermaid-\_r_vs\_ .node ellipse,#chatgpt-mermaid-\_r_vs\_ .node polygon,#chatgpt-mermaid-\_r_vs\_ .node path{fill:rgb(0, 40, 77);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_vs\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_vs\_ .mermaid-decision .label-container{fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_vs\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_vs\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_vs\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Request + JWT + X-School-IdauthenticaterequireSchoolContextMembership hợp lệ?403 Forbiddenreq.tenantauthorizeSchoolRolesRole hợp lệ?ControllerService: kiểm tra quyền tàinguyênRepository: SQL giới hạnschool_idPostgreSQLKhôngCóKhôngCó

**Hai lớp bảo vệ quan trọng:**

- **Service:** Student có được học Deck này không? Lecturer có được sửa Deck này không? Todo có đúng của Student không?
- **Repository:** Dữ liệu đó có thuộc `req.tenant.schoolId` không?

Chỉ kiểm tra một trong hai là chưa đủ.

## **2. Phân tích 5 module và logic cần triển khai**

**Module 1 — Flashcards**

Quản lý Deck, Card, Topic, chia sẻ Deck cho lớp và ghi nhận kết quả ôn tập.

Đây là module nền tảng vì Flashcards được sử dụng bởi Test, Learning và Study Plan.

Logic tạo Deck

\#chatgpt-mermaid-\_r_107\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_107\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_107\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_107\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_107\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_107\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_107\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_107\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_107\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_107\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_107\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_107\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_107\_ p{margin:0;}#chatgpt-mermaid-\_r_107\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_107\_ .label text,#chatgpt-mermaid-\_r_107\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ .node rect,#chatgpt-mermaid-\_r_107\_ .node circle,#chatgpt-mermaid-\_r_107\_ .node ellipse,#chatgpt-mermaid-\_r_107\_ .node polygon,#chatgpt-mermaid-\_r_107\_ .node path{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ .rough-node .label text,#chatgpt-mermaid-\_r_107\_ .node .label text,#chatgpt-mermaid-\_r_107\_ .image-shape .label,#chatgpt-mermaid-\_r_107\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_107\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ .rough-node .label,#chatgpt-mermaid-\_r_107\_ .node .label,#chatgpt-mermaid-\_r_107\_ .image-shape .label,#chatgpt-mermaid-\_r_107\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_107\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_107\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_107\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_107\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_107\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_107\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_107\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_107\_ .labelBkg{background-color:rgba(0, 0, 0, 0.5);}#chatgpt-mermaid-\_r_107\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_107\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_107\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_107\_ .icon-shape,#chatgpt-mermaid-\_r_107\_ .image-shape{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_107\_ .icon-shape p,#chatgpt-mermaid-\_r_107\_ .image-shape p{background-color:rgb(0, 0, 0);padding:2px;}#chatgpt-mermaid-\_r_107\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_107\_ .image-shape .label rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_107\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_107\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_107\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_107\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_107\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_107\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_107\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_107\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_107\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_107\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_107\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_107\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_107\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_107\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_107\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_107\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ .node rect,#chatgpt-mermaid-\_r_107\_ .node circle,#chatgpt-mermaid-\_r_107\_ .node ellipse,#chatgpt-mermaid-\_r_107\_ .node polygon,#chatgpt-mermaid-\_r_107\_ .node path{fill:rgb(0, 40, 77);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_107\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_107\_ .mermaid-decision .label-container{fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_107\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_107\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_107\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Lecturer tạo DeckXác thực School ContextKiểm tra role theo trườngKiểm tra Subject thuộc trườngKiểm tra Class nếu cóINSERT Deck kèm school_idTrả về Deck

Ví dụ một Lecturer ở Trường A tạo Deck Toán. Deck đó phải thuộc Trường A. Sau đó Student Trường B không được tìm thấy Deck đó dù biết UUID.

**Logic đọc Deck cần phân biệt:**

| Người dùng     | Quyền truy cập Deck                                                       |
| -------------- | ------------------------------------------------------------------------- |
| `school_admin` | Quản lý Deck thuộc trường hiện tại theo chính sách                        |
| `lecturer`     | Quản lý Deck mình sở hữu hoặc được cấp quyền                              |
| `student`      | Học Deck public trong trường hoặc Deck được chia sẻ cho lớp mình tham gia |

Điều quan trọng: `is_public = true` **không có nghĩa là public trên tất cả các trường**. Public ở đây phải được hiểu trong phạm vi trường hiện tại, trừ khi Tech Lead quy định mô hình chia sẻ liên trường riêng.

**Code hiện tại có vấn đề:**

Trong `flashcards.repository.js`, hàm `findDecks()` mới lọc theo `role`, `userId`, `subject_id`, `class_id`, chưa dùng `schoolId`.

Trong `flashcards.service.js`, `_checkViewAccess()` sử dụng `user.role` Legacy. Hàm này cũng chưa kiểm tra đầy đủ Student được chia sẻ Deck thông qua bảng `flashcard_deck_class_access`.

Cách sửa logic

Service nên nhận:

```
async getDeckById(deckId, user, tenant) {
  const deck = await FlashcardsRepository.findDeckById(
    deckId,
    tenant.schoolId
  );

  if (!deck) {
    throw new Error('DECK_NOT_FOUND');
  }

  // Kiểm tra quyền dựa vào tenant.role và class membership.
  await this.checkDeckAccess(deck, user.id, tenant);

  return deck;
}
```

Repository nên có điều kiện tương đương:

```
SELECT fd.*
FROM flashcard_decks fd
WHERE fd.id = $1
  AND fd.school_id = $2
  AND fd.is_active = true;
```

Đây là ví dụ áp dụng khi bảng thực tế có cột `school_id`, cần đối chiếu kết quả kiểm tra Neon trước khi code.

**Các hàm cần sửa trước:** `findDecks`, `findDeckById`, `createDeck`, `updateDeck`, `deleteDeck`, `setClassAccess`, `submitReview`, `getStudyQueue`, `upsertSchedule`.

Cần kiểm tra Topic/Flashcard thuộc Deck cùng trường và toàn bộ `class_ids` trước khi thay quyền chia sẻ. Review/Schedule phải được tách đúng trường thông qua khóa trường trực tiếp hoặc quan hệ được xác minh; không tự sửa UNIQUE constraint.

**Module 2 — Flashcards Test**

Sinh viên bắt đầu bài kiểm tra, trả lời, nộp bài, nhận điểm và có thể được tăng Streak.

Trong `flashcardsTest.service.js`, logic hiện tại là:

\#chatgpt-mermaid-\_r_10r\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_10r\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_10r\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_10r\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_10r\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_10r\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_10r\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_10r\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_10r\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_10r\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_10r\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_10r\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_10r\_ p{margin:0;}#chatgpt-mermaid-\_r_10r\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_10r\_ .label text,#chatgpt-mermaid-\_r_10r\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ .node rect,#chatgpt-mermaid-\_r_10r\_ .node circle,#chatgpt-mermaid-\_r_10r\_ .node ellipse,#chatgpt-mermaid-\_r_10r\_ .node polygon,#chatgpt-mermaid-\_r_10r\_ .node path{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ .rough-node .label text,#chatgpt-mermaid-\_r_10r\_ .node .label text,#chatgpt-mermaid-\_r_10r\_ .image-shape .label,#chatgpt-mermaid-\_r_10r\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_10r\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ .rough-node .label,#chatgpt-mermaid-\_r_10r\_ .node .label,#chatgpt-mermaid-\_r_10r\_ .image-shape .label,#chatgpt-mermaid-\_r_10r\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_10r\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_10r\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_10r\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_10r\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_10r\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_10r\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_10r\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_10r\_ .labelBkg{background-color:rgba(0, 0, 0, 0.5);}#chatgpt-mermaid-\_r_10r\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_10r\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_10r\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_10r\_ .icon-shape,#chatgpt-mermaid-\_r_10r\_ .image-shape{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_10r\_ .icon-shape p,#chatgpt-mermaid-\_r_10r\_ .image-shape p{background-color:rgb(0, 0, 0);padding:2px;}#chatgpt-mermaid-\_r_10r\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_10r\_ .image-shape .label rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_10r\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_10r\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_10r\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_10r\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_10r\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_10r\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_10r\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_10r\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_10r\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_10r\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_10r\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_10r\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_10r\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_10r\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ .node rect,#chatgpt-mermaid-\_r_10r\_ .node circle,#chatgpt-mermaid-\_r_10r\_ .node ellipse,#chatgpt-mermaid-\_r_10r\_ .node polygon,#chatgpt-mermaid-\_r_10r\_ .node path{fill:rgb(0, 40, 77);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_10r\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_10r\_ .mermaid-decision .label-container{fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_10r\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_10r\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_10r\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Student chọn DeckcreateTestLấy câu hỏi từ FlashcardsStudent làm bàisubmitTestChấm đáp ánLưu Test Answers + ResultĐúng = 50%?Gọi Learning StreakKhông tăng StreakCóKhông

Phần nghiệp vụ chấm điểm này đã có, bạn nên giữ nguyên.

**Những chỗ phải bổ sung:**

- Khi tạo Test: xác minh Deck thuộc trường, Student có quyền học và lưu Test với School Context.
- Khi GET Test: kiểm tra cả `test.user_id` và `school_id`.
- Khi Submit: kiểm tra Test thuộc đúng Student, đúng trường, chưa nộp, các câu trả lời thuộc đúng Test.
- Khi xem Result: chỉ Student sở hữu Test trong trường đó được xem, trừ quyền quản lý đã được định nghĩa.
- Khi gọi Learning Streak: truyền `schoolId` đã xác minh, không chỉ `userId` và `deckId`.

Ví dụ:

```
await LearningStreakService.recordFlashcardTestCompletion({
  schoolId: tenant.schoolId,
  userId: user.id,
  deckId: test.deck_id,
  testId,
  score: finalScore,
  percentage
});
```

**Một vấn đề cần sửa thêm:** Code đang lưu Test Answers rồi cập nhật Test Result bằng các thao tác riêng, sau đó bắt lỗi cập nhật Streak và chỉ ghi log. Bạn nên kiểm tra lại yêu cầu consistency và transaction để tránh trường hợp bài kiểm tra đã nộp nhưng tiến độ không được ghi nhận, hoặc hai request nộp bài đồng thời.

**Module 3 — Learning**

Quản lý Learning Profile, Streak, Activity, Heatmap, Topic Analytics và Study Plan.

Đây là module phức tạp nhất của Phần B.

### **3.1. Learning Streak**

Hiện tại hệ thống quản lý Streak theo User và Subject.

Logic Multi-Tenant cần xác định:

- User X học ở Trường A thì chỉ tăng Streak của Trường A.
- User X học ở Trường B thì chỉ tăng Streak của Trường B.
- Khôi phục Streak ở Trường A không được dùng nhầm trạng thái hoặc hạn mức của Trường B.
- `getAllSubjectStreaks`, `getSubjectStreak`, Activity và Heatmap chỉ trả dữ liệu của trường hiện tại.

Trong `learning.repository.js`, các hàm đọc và cập nhật Streak đang chủ yếu dựa vào `user_id`, `subject_id`. Bạn phải bổ sung trường vào toàn bộ chuỗi xử lý chứ không chỉ endpoint GET.

**Lưu ý quan trọng về Database:** SQL lịch sử có UNIQUE `(user_id, subject_id)`. Nếu yêu cầu thực tế cần khóa `(school_id, user_id, subject_id)`, thay đổi constraint phải do Tech Lead thống nhất.

### **3.2. Study Plan**

Luồng hiện tại:

\#chatgpt-mermaid-\_r_11a\_{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;fill:rgb(237, 237, 237);}@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}@keyframes dash{to{stroke-dashoffset:0;}}#chatgpt-mermaid-\_r_11a\_ .edge-animation-slow{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 50s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_11a\_ .edge-animation-fast{stroke-dasharray:9,5!important;stroke-dashoffset:900;animation:dash 20s linear infinite;stroke-linecap:round;}#chatgpt-mermaid-\_r_11a\_ .error-icon{fill:rgb(48, 48, 48);}#chatgpt-mermaid-\_r_11a\_ .error-text{fill:rgb(237, 237, 237);stroke:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ .edge-thickness-normal{stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ .edge-thickness-thick{stroke-width:3.5px;}#chatgpt-mermaid-\_r_11a\_ .edge-pattern-solid{stroke-dasharray:0;}#chatgpt-mermaid-\_r_11a\_ .edge-thickness-invisible{stroke-width:0;fill:none;}#chatgpt-mermaid-\_r_11a\_ .edge-pattern-dashed{stroke-dasharray:3;}#chatgpt-mermaid-\_r_11a\_ .edge-pattern-dotted{stroke-dasharray:2;}#chatgpt-mermaid-\_r_11a\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_11a\_ .marker.cross{stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_11a\_ svg{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:16px;}#chatgpt-mermaid-\_r_11a\_ p{margin:0;}#chatgpt-mermaid-\_r_11a\_ .label{font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ .cluster-label text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ .cluster-label span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ .cluster-label span p{background-color:transparent;}#chatgpt-mermaid-\_r_11a\_ .label text,#chatgpt-mermaid-\_r_11a\_ span{fill:rgb(237, 237, 237);color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ .node rect,#chatgpt-mermaid-\_r_11a\_ .node circle,#chatgpt-mermaid-\_r_11a\_ .node ellipse,#chatgpt-mermaid-\_r_11a\_ .node polygon,#chatgpt-mermaid-\_r_11a\_ .node path{fill:rgb(9, 23, 44);stroke:rgb(31, 78, 148);stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ .rough-node .label text,#chatgpt-mermaid-\_r_11a\_ .node .label text,#chatgpt-mermaid-\_r_11a\_ .image-shape .label,#chatgpt-mermaid-\_r_11a\_ .icon-shape .label{text-anchor:middle;}#chatgpt-mermaid-\_r_11a\_ .node .katex path{fill:#000;stroke:#000;stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ .rough-node .label,#chatgpt-mermaid-\_r_11a\_ .node .label,#chatgpt-mermaid-\_r_11a\_ .image-shape .label,#chatgpt-mermaid-\_r_11a\_ .icon-shape .label{text-align:center;}#chatgpt-mermaid-\_r_11a\_ .node.clickable{cursor:pointer;}#chatgpt-mermaid-\_r_11a\_ .root .anchor path{fill:rgb(175, 175, 175)!important;stroke-width:0;stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_11a\_ .arrowheadPath{fill:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_11a\_ .edgePath .path{stroke:rgb(175, 175, 175);stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ .flowchart-link{stroke:rgb(175, 175, 175);fill:none;}#chatgpt-mermaid-\_r_11a\_ .edgeLabel{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_11a\_ .edgeLabel p{background-color:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_11a\_ .edgeLabel rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_11a\_ .labelBkg{background-color:rgba(0, 0, 0, 0.5);}#chatgpt-mermaid-\_r_11a\_ .cluster rect{fill:rgb(48, 48, 48);stroke:rgba(255, 255, 255, 0.15);stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ .cluster text{fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ .cluster span{color:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ div.mermaidTooltip{position:absolute;text-align:center;max-width:200px;padding:2px;font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";font-size:12px;background:rgb(48, 48, 48);border:1px solid rgba(255, 255, 255, 0.15);border-radius:2px;pointer-events:none;z-index:100;}#chatgpt-mermaid-\_r_11a\_ .flowchartTitleText{text-anchor:middle;font-size:18px;fill:rgb(237, 237, 237);}#chatgpt-mermaid-\_r_11a\_ rect.text{fill:none;stroke-width:0;}#chatgpt-mermaid-\_r_11a\_ .icon-shape,#chatgpt-mermaid-\_r_11a\_ .image-shape{background-color:rgb(0, 0, 0);text-align:center;}#chatgpt-mermaid-\_r_11a\_ .icon-shape p,#chatgpt-mermaid-\_r_11a\_ .image-shape p{background-color:rgb(0, 0, 0);padding:2px;}#chatgpt-mermaid-\_r_11a\_ .icon-shape .label rect,#chatgpt-mermaid-\_r_11a\_ .image-shape .label rect{opacity:0.5;background-color:rgb(0, 0, 0);fill:rgb(0, 0, 0);}#chatgpt-mermaid-\_r_11a\_ .label-icon{display:inline-block;height:1em;overflow:visible;vertical-align:-0.125em;}#chatgpt-mermaid-\_r_11a\_ .node .label-icon path{fill:currentColor;stroke:revert;stroke-width:revert;}#chatgpt-mermaid-\_r_11a\_ .node .neo-node{stroke:rgb(31, 78, 148);}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].node rect,#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].cluster rect,#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].node polygon{stroke:url(#chatgpt-mermaid-\_r_11a\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].swimlane.cluster rect{filter:none;}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].node path{stroke:url(#chatgpt-mermaid-\_r_11a\_-gradient);stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].node .outer-path{filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].node .neo-line path{stroke:rgb(31, 78, 148);filter:none;}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].node circle{stroke:url(#chatgpt-mermaid-\_r_11a\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].node circle .state-start{fill:#000000;}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].icon-shape .icon{fill:url(#chatgpt-mermaid-\_r_11a\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_11a\_ [data-look="neo"].icon-shape .icon-neo path{stroke:url(#chatgpt-mermaid-\_r_11a\_-gradient);filter:drop-shadow( 1px 2px 2px rgba(185,185,185,1));}#chatgpt-mermaid-\_r_11a\_ .node text{font-size:14px;font-weight:600;letter-spacing:normal;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_11a\_ .edgeLabels text{font-size:13px;font-weight:600;letter-spacing:-0.08px;fill:rgb(153, 206, 255);}#chatgpt-mermaid-\_r_11a\_ .node tspan[font-weight="normal"],#chatgpt-mermaid-\_r_11a\_ .edgeLabels tspan[font-weight="normal"]{font-weight:600;}#chatgpt-mermaid-\_r_11a\_ .edgeLabel .label rect{opacity:1;rx:13px;ry:13px;fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ .node rect,#chatgpt-mermaid-\_r_11a\_ .node circle,#chatgpt-mermaid-\_r_11a\_ .node ellipse,#chatgpt-mermaid-\_r_11a\_ .node polygon,#chatgpt-mermaid-\_r_11a\_ .node path{fill:rgb(0, 40, 77);stroke:rgba(255, 255, 255, 0.1);stroke-width:1px;}#chatgpt-mermaid-\_r_11a\_ .node rect{rx:16px;ry:16px;}#chatgpt-mermaid-\_r_11a\_ .mermaid-decision .label-container{fill:rgb(0, 14, 26);stroke:rgb(26, 62, 95);stroke-dasharray:2,2;}#chatgpt-mermaid-\_r_11a\_ .edgePaths .flowchart-link{stroke:rgb(175, 175, 175);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round;}#chatgpt-mermaid-\_r_11a\_ .marker{fill:rgb(175, 175, 175);stroke:rgb(175, 175, 175);}#chatgpt-mermaid-\_r_11a\_ :root{--mermaid-font-family:-apple-system-body,ui-sans-serif,-apple-system,system-ui,"Segoe UI",Helvetica,"Apple Color Emoji",Arial,sans-serif,"Segoe UI Emoji","Segoe UI Symbol";}Student chọn SubjectTopic AnalyticsPhân tích điểm yếuGenerate Study PlanStudy Plan DaysSinh câu hỏi AIStudent SubmitLưu Progress + Result

Bạn cần kiểm tra School Context ở **tất cả** bước:

- Subject được chọn phải thuộc trường hiện tại và Student có quyền học.
- Analytics không lấy Review/Test/Grade của trường khác.
- Study Plan phải thuộc đúng Student và trường.
- Study Plan Day phải thuộc Plan cùng trường.
- AI chỉ dùng nội dung đã được kiểm tra quyền theo trường.
- Submit và Result phải kiểm tra Student sở hữu Plan, kể cả khi truyền đúng UUID của một Plan Day ở trường khác.

Trong `studyPlanner.repository.js`, `createOrGetPlan()` đang tìm, tạo và lấy Plan theo `studentId`, `subjectId`, `startsOn` mà chưa có `schoolId`.

Đặc biệt nhánh `force = true` đang xóa Plan cũ trước khi tạo lại. Phải giới hạn đúng trường và Student, đồng thời bảo đảm hành vi thay thế Plan đã được phép, không vô tình xóa tiến độ lịch sử.

**Module 4 — Todos**

Quản lý việc cần làm của Student, liên kết Subject, Topic, Deck và Study Plan.

Ví dụ Student học Toán ở Trường A và Vật lý ở Trường B:

- Todo ôn Toán chỉ hiển thị trong Trường A.
- Todo ôn Vật lý chỉ hiển thị trong Trường B.
- Student ở Trường B không thể chỉnh sửa Todo Trường A bằng UUID.
- Không được gắn Deck Trường A vào Todo Trường B.

Hàm `resolveReferences()` trong `todos.service.js` đang làm một số bước kiểm tra liên kết. Bạn cần bổ sung School Context để kiểm tra **mọi tài nguyên tham chiếu cùng trường**.

Trong `todos.repository.js`, các hàm `insert`, `findViewById`, `update`, `delete`, `list` chưa giới hạn đầy đủ theo `school_id`.

Ví dụ cập nhật đúng phạm vi:

```
UPDATE todos
SET title = $1,
    updated_at = NOW()
WHERE id = $2
  AND user_id = $3
  AND school_id = $4
RETURNING *;
```

Ngoài CRUD, logic `createFromStudyPlan()` cần bảo đảm idempotency: gọi nhiều lần cho cùng một ngày học thì không tạo nhiều Todo. Khóa chống trùng và việc kiểm tra bản ghi tồn tại đều phải xét đúng phạm vi trường, đồng thời lưu ý UNIQUE index Legacy hiện có.

**Module 5 — Focus**

Quản lý phiên tập trung, thời gian học, lịch sử và cài đặt cá nhân.

Module này **khác bốn module trên**.

Theo phân công:

- `focus_sessions`: dùng chung cho tài khoản User.
- `focus_preferences`: dùng chung cho tài khoản User.
- Không thêm `school_id` vào hai bảng này.

Code hiện tại đã có hướng xử lý đúng: Focus Session được truy vấn theo `user_id`, và `findLinkableTodo()` kiểm tra Todo có thuộc User không.

Bạn chủ yếu cần kiểm tra trường hợp Focus gắn với Todo sau khi Todos đã được tách theo trường, cùng với ý nghĩa của thống kê Focus. Không tự giới hạn toàn bộ Focus theo `school_id`.

## **3. Những vấn đề mình phát hiện thêm trong code**

Ngoài phần Multi-Tenant, có ba điểm đáng lưu ý:

| Vị trí                       | Phát hiện                                                                                   | Cần làm                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `learningStreak.service.js`  | Có hai khai báo `recordFlashcardTestCompletion()` trong cùng object, khoảng dòng 295 và 441 | Kiểm tra và hợp nhất logic; khai báo sau sẽ ghi đè khai báo trước        |
| `flashcardsTest.service.js`  | Khi cập nhật Streak lỗi, code chỉ `console.error`                                           | Xác định chính sách đồng bộ Test/Streak và xử lý lỗi rõ ràng             |
| `studyPlanner.repository.js` | `force = true` có logic xóa và tạo lại Study Plan                                           | Giới hạn đúng trường, kiểm tra ảnh hưởng đến Progress và dữ liệu lịch sử |

Điểm đầu tiên khá quan trọng: **nếu bạn chỉ sửa hàm Streak đầu tiên thì runtime vẫn sử dụng hàm thứ hai**.

## **4. Thứ tự code phù hợp nhất**

Mình khuyên bạn triển khai theo các giai đoạn sau:

Lộ trình triển khai

Bước 1/6

## **Flashcards**

flashcards.routes.js → controller → service → repository

Sửa phân quyền Deck, Subject, Class, Topic trước; sau đó Review và Schedule.

&#x20;TrướcTiếp theo&#x20;

## **5. Test nghiệm thu Multi-Tenant**

Giả sử:

- User X là Student ở Trường A và Trường B.
- User Y là Student khác, chỉ thuộc Trường A.
- Lecturer Z quản lý một số lớp của Trường A.

| Test                                          | Kết quả mong đợi                  |
| --------------------------------------------- | --------------------------------- |
| User X chọn Trường A, GET Deck                | Chỉ có Deck được phép xem trong A |
| User X chọn Trường B, GET Deck UUID của A     | Không tiết lộ dữ liệu             |
| User X ở B, Submit Test UUID thuộc A          | Bị từ chối                        |
| User X ở A, GET Streak                        | Chỉ trả Streak của A              |
| User X ở B, GET Study Plan                    | Chỉ trả Plan của B                |
| User X ở B, DELETE Todo thuộc A               | Không xóa được                    |
| User Y truy cập Todo của X trong A            | Không truy cập được               |
| Lecturer Z sửa Deck ngoài phạm vi quản lý     | Bị từ chối                        |
| User X xem Focus Preferences                  | Vẫn thấy cài đặt toàn User        |
| User X gọi tạo Todo từ một Plan Day nhiều lần | Không tạo trùng                   |

Trường hợp truy cập tài nguyên bằng UUID của trường khác, bạn có thể trả `404` để không tiết lộ sự tồn tại của tài nguyên, theo quy ước lỗi của Backend.

## **6. Bắt đầu code từ đâu?**

Bước đầu tiên nên làm là **kiểm tra schema thực tế trên Neon&#x20;**`dev-multi-tenant`, dùng script đọc metadata mà bạn đã gửi ở tin nhắn trước.

Sau đó bắt đầu sửa `flashcards` theo đúng thứ tự:

1. Routes: Authentication, School Context, Role.
2. Controller: truyền User và Tenant Context.
3. Service: kiểm tra quyền Deck, Subject và Class.
4. Repository: giới hạn SQL theo `school_id`.
5. Test: Student và Lecturer ở hai trường.

Đừng sửa đồng loạt cả năm module ngay, vì `flashcards-test`, `learning` và `todos` đều phụ thuộc một phần vào Flashcards.

**Kết luận:** Trong Phần B, `flashcards` và `learning` cần nhiều công sức nhất; `flashcards-test` và `todos` cần sửa logic liên kết và quyền; còn `focus` chủ yếu rà soát, không đổi mô hình dữ liệu.

Mình đã đọc code từ GitHub nhưng chưa có kết quả schema Neon đang chạy, nên những thay đổi liên quan khóa UNIQUE hay bổ sung cột vẫn cần được xác minh và thống nhất với Tech Lead.