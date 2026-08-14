# 論文指導工作台（Phase A+B）

可實際使用的「學生 x 指導教授」非同步論文協作工具，部署在 Cloudflare Workers + KV。

## 目前已完成（A+B）

1. 帳號註冊 / 登入 / 登出（學生、教授角色）
2. 雙向邀請：教授可邀請學生、學生也可邀請教授加入同一個 workspace
3. 工作流：
   - 學生提出 Decision Request
   - 教授在收件匣同意 / 替代方案 / 討論並可建立 Action Item
   - 里程碑狀態更新、Action 完成、Decision Log
4. Weekly Brief 更新
5. 教授 LINE 通知（新決策請求、學生更新週報）

## 入口

- `/`：登入 / 註冊
- `/dashboard`：登入後主工作台（依角色顯示）
- `/api/*`：JSON API

## 主要 API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `PATCH /api/me/line`
- `POST /api/invites`
- `POST /api/invites/accept`
- `GET /api/workspace`
- `PATCH /api/profile`
- `PATCH /api/weekly-brief`
- `POST /api/decisions`
- `PATCH /api/decisions/:id/resolve`
- `PATCH /api/milestones/:id`
- `PATCH /api/actions/:id`

## 環境變數

- `LINE_CHANNEL_ACCESS_TOKEN`：教授 LINE 推播用（可先不設）

> 教授需在 Dashboard 的「LINE 通知設定」填 `LINE User ID` 並開啟通知。

## 部署

1. 建立 KV namespace：
   - `npx wrangler kv namespace create THESIS_KV`
2. 將 namespace id 填入 `wrangler.jsonc` 的 `kv_namespaces[0].id`
3. 安裝與檢查：
   - `npm install`
   - `npm run check`
4. 部署：
   - `npm run deploy`

## 測試建議流程

1. 教授註冊
2. 教授建立邀請碼
3. 學生註冊並輸入邀請碼加入
4. 學生發 Decision Request
5. 教授回覆並建立 Action Item
6. 學生更新 Weekly Brief，驗證教授 LINE 通知
