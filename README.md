# 論文指導工作台（Phase 1 MVP）

單一學生與單一指導教授的非同步論文指導工具。採 Cloudflare Workers + KV，沒有外部資料庫、帳號系統或建置步驟。

## 入口

- `/student`：學生工作台（里程碑、提出決策、待辦、週報）
- `/supervisor`：教授收件匣（待決策、閱讀時間、截止日、快速回覆）

根路徑 `/` 可選擇角色。首次開啟會建立可直接操作的示範資料；資料保存在 KV 後，同一個 namespace 的資料會持續存在。

## 今天可驗證的功能

1. 學生建立 Decision Request，附建議、選項、證據與閱讀時間。
2. 教授在收件匣按「同意建議」、「選擇替代方案」或「需要討論」完成回覆。
3. 已完成決策自動進入 Decision Log，並可把後續工作建立成 Action Item。
4. 里程碑依截止日顯示綠／黃／紅風險，學生可更新狀態。
5. Weekly Brief 彙整本週進度、風險、待教授決策與下一步。

## 部署至 Cloudflare

1. 建立 KV namespace：`npx wrangler kv namespace create THESIS_KV`
2. 將輸出的 `id` 填入 `wrangler.jsonc` 的 `kv_namespaces[0].id`。
3. 安裝並驗證：`npm install`、`npm run check`。
4. 登入 Cloudflare 後部署：`npx wrangler login`、`npm run deploy`。

OpenClaw 可直接接手以上專案執行安裝與部署。若想有一組全新的示範資料，呼叫 `POST /api/reset-demo`；正式分享前建議由 OpenClaw 在 Worker 層加上 Cloudflare Access 或簡單密碼保護。

## KV 資料 schema

資料集中存於 key `thesis:workspace`，便於單一學生 MVP 維運與匯出：

```json
{
  "profile": { "title": "...", "studentName": "...", "supervisorName": "..." },
  "milestones": [{ "id": "M-01", "title": "...", "deadline": "YYYY-MM-DD", "status": "in_progress|done|blocked", "deliverable": "...", "approvalRequired": true }],
  "decisions": [{ "id": "D-001", "topic": "...", "question": "...", "options": ["..."], "recommendation": "...", "evidence": "...", "readingMinutes": 3, "deadline": "YYYY-MM-DD", "status": "pending|approved|alternative|discussion", "response": "...", "createdAt": "ISO", "resolvedAt": "ISO" }],
  "actions": [{ "id": "A-001", "title": "...", "owner": "學生|教授", "deadline": "YYYY-MM-DD", "status": "open|done", "sourceDecisionId": "D-001" }],
  "weeklyBrief": { "weekOf": "YYYY-MM-DD", "summary": "...", "wins": ["..."], "risks": ["..."], "nextSteps": ["..."] }
}
```

## Phase 2（刻意未做）

帳號／多校、多學生、檔案與 PDF、Zotero／Scholar、AI 寫作與引用、付款。
