# Feature Removal Checklist: Decision Queue, Research Continuity, and RAG Chat

## 1. Mục tiêu

Thu gọn LunaCrypto để tập trung nguồn lực vào chất lượng phân tích thay vì duy
trì các lớp workflow không tạo đủ giá trị:

- Decision Queue.
- Research Continuity.
- RAG Chat / Research Chat.

Tài liệu này là checklist kiểm soát trước và trong quá trình loại bỏ. Không xem
việc xóa file là hoàn tất nếu dependency runtime, contract, dữ liệu, test và tài
liệu liên quan chưa được xử lý.

## 2. Nguyên tắc và ranh giới

- [ ] Không xóa hoặc làm suy giảm research engine cốt lõi.
- [ ] Giữ research runs và final reports.
- [ ] Giữ evidence, provenance, source quality, market snapshots và signal
      snapshots nếu chúng được dùng trực tiếp cho phân tích.
- [ ] Giữ scenario generation, scenario evaluation, risk, invalidation và
      confidence nếu chúng không phụ thuộc bắt buộc vào Decision Queue.
- [ ] Chỉ xóa phần queue/workbench của `scenario-decision`; không mặc định xóa
      toàn bộ Scenario Decision System.
- [ ] Không thay ba subsystem bị xóa bằng một framework hoặc abstraction mới.
- [ ] Không chỉnh tay generated API clients/contracts nếu project đã có lệnh
      generate; sửa source contract rồi regenerate.
- [ ] Không drop database tables trong cùng bước với việc ngừng runtime.
- [ ] Không trộn các thay đổi đang làm dở trong worktree vào đợt xóa này.

## 3. Quyết định cần chốt trước khi sửa code

- [ ] Xác nhận `Research Chat` bị xóa hoàn toàn, không giữ chế độ chat không RAG.
- [ ] Xác nhận Decision Queue chỉ là phần trình bày/điều phối đầu ra; liệt kê
      chính xác các field và method được phép xóa khỏi `scenario-decision`.
- [ ] Xác nhận dữ liệu Continuity cũ cần archive hay có thể xóa sau thời gian
      giữ lại.
- [ ] Chọn thời gian giữ database tables cũ (đề xuất: ít nhất một release ổn
      định sau khi ngừng ghi).
- [ ] Xác nhận API có consumer bên ngoài hay chỉ web app nội bộ sử dụng.
- [ ] Chốt cách xử lý URL cũ: trả `404/410` hay redirect về Research.
- [ ] Ghi lại baseline hiệu năng và chất lượng của một research run trước khi
      tháo subsystem để so sánh sau thay đổi.

## 4. Inventory: Decision Queue

### Web

- [ ] Rà và loại bỏ UI queue trong
      `apps/web/src/pages/ScenarioDecisionWorkbenchPage.tsx`.
- [ ] Rà service/DTO queue trong
      `apps/web/src/services/scenario-decision.ts`.
- [ ] Xóa type chỉ phục vụ queue trong `apps/web/src/types/index.ts`.
- [ ] Cập nhật hoặc xóa assertions tương ứng trong
      `apps/web/test/scenario-decision-workbench.test.ts`.
- [ ] Kiểm tra không còn navigation, badge, counter hoặc empty state trỏ tới
      Decision Queue.

### API

- [ ] Rà `apps/api/src/scenario-decision/scenario-decision-workbench.service.ts`;
      chỉ xóa logic queue, giữ logic phân tích còn giá trị.
- [ ] Rà `apps/api/src/scenario-decision/scenario-decision.types.ts` và xóa các
      type `DecisionQueue*` không còn consumer.
- [ ] Xóa queue fields/endpoints khỏi source API contract.
- [ ] Regenerate `apps/api/src/contracts/openapi.generated.ts` và
      `apps/web/src/services/generated/api-client.ts`.
- [ ] Cập nhật API contract tests mà không xóa coverage cho Scenario/analysis.

### Điều kiện hoàn tất

- [ ] Không còn `DecisionQueue` hoặc `decision_queue` trong source runtime.
- [ ] Scenario generation/evaluation vẫn chạy và có test.
- [ ] Report vẫn chứa scenario, risk và invalidation cần thiết.

## 5. Inventory: Research Continuity

### Runtime và integration

- [ ] Ngừng tạo continuity sau khi research job hoàn tất.
- [ ] Gỡ continuity context khỏi request/metadata gửi vào research engine.
- [ ] Gỡ dependency khỏi `jobs.module.ts`, `jobs.service.ts`,
      `research-job.processor.ts` và `research-worker.ts`.
- [ ] Gỡ dependency khỏi `research-runs.module.ts` và
      `research-runs.controller.ts`.
- [ ] Gỡ continuity health/settings khỏi `operations.module.ts` và
      `operations.service.ts`.
- [ ] Gỡ `ResearchContinuityModule` khỏi `app.module.ts`.
- [ ] Xóa script `start:continuity-scheduler` và toàn bộ biến môi trường
      `RESEARCH_CONTINUITY_*` sau khi xác nhận deployment không còn gọi chúng.

### API module

- [ ] Xóa controller, service, presenters, renderer, scheduler, repositories,
      DTO và types trong `apps/api/src/research-continuity/`.
- [ ] Xóa các endpoint `/research-continuity/**`.
- [ ] Xóa `GET/POST /research-runs/:id/continuity`.
- [ ] Xóa continuity schemas khỏi source OpenAPI contract rồi regenerate.
- [ ] Xóa repository methods khỏi journal interface/implementations sau khi
      không còn consumer.

### Web

- [ ] Xóa `ResearchContinuityPage.tsx`.
- [ ] Xóa `ResearchContinuityEntryDetailPage.tsx`.
- [ ] Xóa route, navigation và sidebar entry Continuity.
- [ ] Xóa continuity service calls, query keys và types.
- [ ] Xóa continuity panel/link khỏi `ResearchRunWorkspacePage.tsx`.
- [ ] Xóa CSS chỉ được Continuity sử dụng.

### Tests

- [ ] Xóa test chỉ kiểm tra Continuity module, UI, scheduler và repair.
- [ ] Sửa shared fake journal/test fixtures để không còn continuity state.
- [ ] Không xóa shared API tests không liên quan chỉ vì chúng nằm chung file.
- [ ] Thêm regression test chứng minh research job vẫn hoàn tất mà không tạo
      continuity hay mutate metadata bằng continuity context.

### Database và dữ liệu

- [ ] Dừng mọi thao tác ghi trước khi drop schema.
- [ ] Kiểm tra row count và dung lượng của các bảng:
  - `research_continuity_entries`
  - `research_continuity_states`
  - `research_continuity_debug_access_audits`
  - `research_continuity_repair_runs`
  - `research_continuity_workspace_settings`
- [ ] Kiểm tra foreign keys và cleanup scripts đang tham chiếu các bảng trên.
- [ ] Nếu cần giữ lịch sử, export snapshot có timestamp và checksum.
- [ ] Deploy một release không còn đọc/ghi Continuity nhưng vẫn giữ bảng.
- [ ] Chỉ tạo migration drop table sau thời gian quan sát đã chốt.
- [ ] Thứ tự drop phải tôn trọng foreign keys; migration phải có kế hoạch
      rollback hoặc ghi rõ là irreversible.

### Điều kiện hoàn tất

- [ ] Research run thành công không gọi bất kỳ Continuity service nào.
- [ ] Không còn worker/scheduler Continuity chạy trong deployment.
- [ ] Không còn endpoint, route hoặc navigation Continuity.
- [ ] Operations health không còn phụ thuộc bảng Continuity.
- [ ] Sau giai đoạn giữ dữ liệu, database không còn schema mồ côi.

## 6. Inventory: RAG Chat / Research Chat

### Phạm vi

RAG hiện tại là structured retrieval từ các artifact nội bộ, không phải vector
search/pgvector. Nó phụ thuộc đáng kể vào thesis, runs, scenarios, snapshots và
Continuity. Xóa RAG không đồng nghĩa xóa các artifact nguồn còn cần cho engine.

### API

- [ ] Xóa `ResearchChatModule` khỏi `app.module.ts`.
- [ ] Xóa controller, services, retriever, tools, context builder, memory
      repository, stream writer, symbol/workspace resolver, LLM wrapper và DTO
      trong `apps/api/src/research-chat/`.
- [ ] Xóa Research Chat endpoints và streaming event types khỏi source API
      contract rồi regenerate clients.
- [ ] Xóa config/env/secrets chỉ dành riêng cho Research Chat sau khi xác nhận
      chúng không được research engine sử dụng.
- [ ] Kiểm tra journal methods dùng bởi retriever/memory; chỉ xóa method không
      còn consumer, không xóa bảng artifact nguồn.

### Web

- [ ] Xóa `apps/web/src/pages/ResearchChatPage.tsx`.
- [ ] Xóa `apps/web/src/services/research-chat.ts`.
- [ ] Xóa route và navigation `RAG Chat`.
- [ ] Xóa query keys, types, local-storage keys và UI copy chỉ dành cho chat.
- [ ] Kiểm tra không còn deep link hoặc CTA mở Research Chat.

### Tests và dữ liệu

- [ ] Xóa `research-chat.service.test.ts` và
      `research-chat-agent.service.test.ts` sau khi module bị xóa.
- [ ] Xóa API/web contract assertions chỉ dành cho chat.
- [ ] Xác định Research Chat memory được lưu ở đâu và row count trước khi xóa.
- [ ] Không xóa thesis, research runs, scenarios, evidence, market snapshots hay
      signal snapshots chỉ vì retriever từng đọc chúng.

### Điều kiện hoàn tất

- [ ] Không còn `ResearchChat`, `research-chat`, `RAG Chat` hoặc `useRag` trong
      runtime source.
- [ ] Research engine không phụ thuộc Research Chat DTO hay context builder.
- [ ] Không còn endpoint hoặc navigation chat chết.

## 7. Contracts, generated code và consumers

- [ ] Liệt kê endpoint/type bị xóa trước khi đổi contract.
- [ ] Tìm consumer trong toàn monorepo, scripts và deployment configs.
- [ ] Kiểm tra có mobile/external client ngoài repository hay không.
- [ ] Cập nhật source OpenAPI/frontend contract.
- [ ] Chạy generator chính thức của project.
- [ ] Xác nhận generated files không chứa type/endpoint đã xóa.
- [ ] Kiểm tra backward compatibility; nếu có external consumer, deprecate trước
      khi remove hoặc phát hành breaking-version rõ ràng.

## 8. Trình tự triển khai đề xuất

### Phase 0 — Baseline và backup

- [ ] Chụp baseline test, build, API schema và một research run mẫu.
- [ ] Lưu database counts và quyết định archive.
- [ ] Kiểm tra deployment/process manager đang chạy worker nào.

### Phase 1 — Ngừng hành vi runtime

- [ ] Ngừng Continuity scheduler và post-run generation.
- [ ] Ngừng inject Continuity context.
- [ ] Bỏ Decision Queue khỏi luồng người dùng.
- [ ] Bỏ RAG Chat khỏi navigation và ngừng endpoint traffic.
- [ ] Chưa drop database tables.

### Phase 2 — Xóa code và contracts

- [ ] Xóa module/UI/service/tests theo inventory.
- [ ] Regenerate contracts và client.
- [ ] Dọn imports, scripts, env examples và health checks bị mồ côi.

### Phase 3 — Ổn định

- [ ] Chạy unit, integration, API contract và web tests.
- [ ] Build toàn monorepo.
- [ ] Smoke test research run từ đầu đến final report.
- [ ] Quan sát logs, error rate, job completion và thời gian chạy.

### Phase 4 — Dọn dữ liệu

- [ ] Chỉ thực hiện sau thời gian quan sát đã chốt.
- [ ] Export dữ liệu nếu cần.
- [ ] Chạy migration drop schema cũ.
- [ ] Xác minh backup/restore và cleanup scripts.

## 9. Verification bắt buộc

- [ ] Repository search không còn runtime references ngoài changelog/docs lịch sử.
- [ ] Typecheck API, web và AI service thành công.
- [ ] Unit/integration/contract tests thành công.
- [ ] Production build thành công.
- [ ] Research run mới hoàn tất và tạo final report hợp lệ.
- [ ] Evidence/provenance vẫn xuất hiện đúng trong báo cáo.
- [ ] Scenario, risk, invalidation và confidence vẫn hoạt động.
- [ ] Không có request tới endpoint đã xóa trong browser/network logs.
- [ ] Không có worker retry hoặc database error vì bảng/module cũ.
- [ ] Generated API schema/client đồng bộ với runtime.

## 10. Rollback

- [ ] Mỗi phase là một commit/PR độc lập, có thể revert riêng.
- [ ] Giữ database tables trong giai đoạn đầu để rollback application code.
- [ ] Ghi lại env/process settings cần khôi phục nếu bật lại runtime cũ.
- [ ] Không rollback bằng cách ghi đè worktree có thay đổi chưa commit.
- [ ] Sau khi drop database, rollback chỉ được coi là khả thi nếu archive/backup
      đã được kiểm tra restore.

## 11. Definition of Done

- [ ] Decision Queue, Research Continuity và RAG Chat không còn trong sản phẩm.
- [ ] Không còn runtime dependency, API surface, UI dead link, worker hoặc config
      mồ côi của ba subsystem.
- [ ] Dữ liệu và năng lực phân tích cốt lõi được giữ nguyên.
- [ ] Research pipeline đơn giản hơn và có baseline chứng minh không suy giảm
      chất lượng đầu ra.
- [ ] Database cũ đã được archive/drop theo quyết định đã duyệt.
- [ ] README, architecture docs, changelog và roadmap phản ánh đúng phạm vi sản
      phẩm mới.

