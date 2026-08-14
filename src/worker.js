const STORE_KEY = 'thesis:workspace';

const demoWorkspace = () => ({
  profile: { title: 'AI 導入對中小企業策略決策之影響', studentName: '王小明', supervisorName: '陳教授', targetDefense: '2026-12-18' },
  milestones: [
    { id: 'M-01', title: '研究缺口定稿', deadline: '2026-08-21', status: 'in_progress', deliverable: '一頁研究缺口聲明', approvalRequired: true },
    { id: 'M-02', title: '研究問題凍結', deadline: '2026-08-28', status: 'in_progress', deliverable: 'RQ vFinal', approvalRequired: true },
    { id: 'M-03', title: '理論架構', deadline: '2026-09-11', status: 'not_started', deliverable: '概念架構圖與假設', approvalRequired: true },
    { id: 'M-04', title: '研究方法 v1', deadline: '2026-09-25', status: 'not_started', deliverable: '方法章草稿', approvalRequired: true }
  ],
  decisions: [
    { id: 'D-001', topic: '研究問題', question: 'RQ2 是否保留「組織學習能力」作為中介變項？', options: ['保留中介變項', '刪除 RQ2，聚焦直接效果', '改為調節變項'], recommendation: '刪除 RQ2，聚焦直接效果', evidence: '初步文獻回顧顯示現有樣本數難以支持中介模型；聚焦後更符合研究缺口。', readingMinutes: 3, deadline: '2026-08-18', status: 'pending', response: '', createdAt: '2026-08-14T09:00:00.000Z', resolvedAt: null },
    { id: 'D-000', topic: '研究範圍', question: '研究對象是否限定台灣製造業中小企業？', options: ['限定台灣製造業中小企業', '擴大至服務業'], recommendation: '限定台灣製造業中小企業', evidence: '可取得的訪談對象與產業脈絡較一致。', readingMinutes: 2, deadline: '2026-08-12', status: 'approved', response: '同意，請在第一章說明此界定。', createdAt: '2026-08-08T09:00:00.000Z', resolvedAt: '2026-08-10T08:15:00.000Z' }
  ],
  actions: [
    { id: 'A-001', title: '依決策修訂第一章研究範圍', owner: '學生', deadline: '2026-08-17', status: 'open', sourceDecisionId: 'D-000' },
    { id: 'A-002', title: '整理研究缺口文獻矩陣', owner: '學生', deadline: '2026-08-20', status: 'open', sourceDecisionId: null }
  ],
  weeklyBrief: { weekOf: '2026-08-14', summary: '本週完成研究範圍界定與 18 篇核心文獻初篩；目前需確認研究問題的複雜度。', wins: ['研究對象已確認', '完成 18 篇文獻初篩'], risks: ['D-001 若未於 8/18 決定，研究缺口定稿可能延後'], nextSteps: ['收到 D-001 決策後修訂研究問題', '完成研究缺口一頁摘要'] }
});

async function workspace(env) {
  const saved = await env.THESIS_KV.get(STORE_KEY, 'json');
  if (saved) return saved;
  const seed = demoWorkspace();
  await env.THESIS_KV.put(STORE_KEY, JSON.stringify(seed));
  return seed;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const id = (prefix, items) => `${prefix}-${String(items.length + 1).padStart(3, '0')}`;

async function api(request, env, path) {
  let data = await workspace(env);
  if (request.method === 'GET' && path === '/api/workspace') return json(data);
  if (request.method === 'POST' && path === '/api/reset-demo') { data = demoWorkspace(); await env.THESIS_KV.put(STORE_KEY, JSON.stringify(data)); return json(data); }
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: '無效資料' }, 400);
  if (path === '/api/decisions' && request.method === 'POST') {
    const item = { id: id('D', data.decisions), topic: body.topic, question: body.question, options: body.options.filter(Boolean), recommendation: body.recommendation, evidence: body.evidence, readingMinutes: Number(body.readingMinutes) || 3, deadline: body.deadline, status: 'pending', response: '', createdAt: new Date().toISOString(), resolvedAt: null };
    data.decisions.unshift(item); await env.THESIS_KV.put(STORE_KEY, JSON.stringify(data)); return json(item, 201);
  }
  const decisionMatch = path.match(/^\/api\/decisions\/([^/]+)\/resolve$/);
  if (decisionMatch && request.method === 'PATCH') {
    const item = data.decisions.find(x => x.id === decisionMatch[1]); if (!item) return json({ error: '找不到決策' }, 404);
    item.status = body.status; item.response = body.response || ''; item.resolvedAt = new Date().toISOString();
    if (body.actionTitle) data.actions.unshift({ id: id('A', data.actions), title: body.actionTitle, owner: '學生', deadline: body.actionDeadline || item.deadline, status: 'open', sourceDecisionId: item.id });
    await env.THESIS_KV.put(STORE_KEY, JSON.stringify(data)); return json(item);
  }
  const milestoneMatch = path.match(/^\/api\/milestones\/([^/]+)$/);
  if (milestoneMatch && request.method === 'PATCH') { const item = data.milestones.find(x => x.id === milestoneMatch[1]); if (!item) return json({ error: '找不到里程碑' }, 404); item.status = body.status; await env.THESIS_KV.put(STORE_KEY, JSON.stringify(data)); return json(item); }
  const actionMatch = path.match(/^\/api\/actions\/([^/]+)$/);
  if (actionMatch && request.method === 'PATCH') { const item = data.actions.find(x => x.id === actionMatch[1]); if (!item) return json({ error: '找不到待辦' }, 404); item.status = body.status; await env.THESIS_KV.put(STORE_KEY, JSON.stringify(data)); return json(item); }
  return json({ error: '找不到 API' }, 404);
}

const html = `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>論文指導工作台</title><style>
:root{--ink:#192636;--muted:#657486;--line:#e3e9ee;--bg:#f5f7f8;--blue:#176b87;--green:#16845b;--yellow:#b77900;--red:#bf3d3d}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Noto Sans TC",sans-serif}header{background:#102b3b;color:white;padding:20px max(24px,calc((100vw - 1160px)/2));display:flex;justify-content:space-between;align-items:center}header h1{font-size:20px;margin:0}header small{opacity:.75}nav a{color:white;text-decoration:none;padding:8px 12px;border:1px solid #ffffff45;border-radius:7px;margin-left:8px}main{max-width:1160px;margin:26px auto;padding:0 20px}.hero{display:flex;justify-content:space-between;align-items:end;margin-bottom:22px}.hero h2{margin:0;font-size:27px}.hero p{margin:3px 0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.two{grid-template-columns:1.2fr .8fr}.card{background:white;border:1px solid var(--line);border-radius:12px;padding:18px}.card h3{margin:0 0 13px;font-size:16px}.stat{font-size:27px;font-weight:750}.muted{color:var(--muted);font-size:13px}.list{display:grid;gap:10px}.item{border-top:1px solid var(--line);padding:11px 0}.item:first-child{border:0;padding-top:0}.item-title{font-weight:680}.meta{color:var(--muted);font-size:13px;margin-top:3px}.badge{display:inline-block;font-size:12px;font-weight:700;border-radius:100px;padding:2px 8px}.green{color:var(--green);background:#e5f5ee}.yellow{color:var(--yellow);background:#fff4d8}.red{color:var(--red);background:#fce8e8}.blue{color:var(--blue);background:#e2f1f5}button{border:0;background:var(--blue);color:white;border-radius:7px;padding:8px 11px;font:inherit;cursor:pointer}button.secondary{background:white;color:var(--blue);border:1px solid #b8cbd3}button.danger{background:var(--red)}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}dialog{border:0;border-radius:13px;box-shadow:0 14px 50px #0004;width:min(600px,92vw);padding:23px}dialog::backdrop{background:#102b3b88}label{font-weight:650;display:block;margin-top:11px}input,textarea,select{font:inherit;width:100%;padding:8px;border:1px solid #bcc8d0;border-radius:7px;margin-top:4px}textarea{min-height:72px}.riskbar{height:8px;background:#edf0f2;border-radius:8px;overflow:hidden;margin:8px 0}.riskbar span{display:block;height:100%;background:var(--green)}.empty{padding:16px;color:var(--muted);text-align:center}@media(max-width:760px){.grid,.two{grid-template-columns:1fr}header{align-items:flex-start;gap:12px;flex-direction:column}.hero{align-items:flex-start;gap:12px;flex-direction:column}nav a:first-child{margin-left:0}}
</style></head><body><header><div><h1>論文指導工作台</h1></div><nav><a href="/student">學生工作台</a><a href="/supervisor">教授收件匣</a></nav></header><main id="app"><p id="loading">載入中…</p></main><dialog id="modal"></dialog><script>
window.onerror = function(msg, url, line, col, error) {
  var p = document.getElementById('loading') || document.querySelector('#app p');
  if (p) p.innerText = 'Syntax Error: ' + msg + ' (Line ' + line + ')';
};
window.onunhandledrejection = function(e) {
  var p = document.getElementById('loading') || document.querySelector('#app p');
  if (p) p.innerText = 'Async Error: ' + (e.reason ? e.reason.message || e.reason : 'Unknown');
};

var state, role = location.pathname.indexOf('supervisor') > -1 ? 'supervisor' : 'student';
var app = document.querySelector('#app'), modal = document.querySelector('#modal');

var esc = function(s) {
  var val = (s !== null && s !== void 0) ? String(s) : '';
  return val.replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
};
var date = function(s) {
  if (!s) return '';
  var parts = s.split('-');
  if (parts.length === 3) {
    return parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
  }
  return s;
};
var days = function(s) {
  if (!s) return 999;
  var target = new Date(s.replace(/-/g, '/') + ' 23:59:59').getTime();
  if (isNaN(target)) return 999;
  return Math.ceil((target - new Date().getTime()) / 86400000);
};
var risk = function(s) {
  var d = days(s);
  return d < 0 ? 'red' : (d <= 5 ? 'yellow' : 'green');
};
var tag = function(s, cls) {
  return '<span class="badge ' + (cls || 'blue') + '">' + esc(s) + '</span>';
};
var riskLabel = function(d) {
  var r = risk(d);
  return tag(r === 'red' ? '逾期' : (r === 'yellow' ? '5日內' : '進度穩定'), r);
};

async function call(url, opt) {
  opt = opt || {};
  var headers = opt.headers || {};
  headers['content-type'] = 'application/json';
  opt.headers = headers;
  const r = await fetch(url, opt);
  if (!r.ok) throw Error('儲存失敗');
  return r.json();
}
async function load() {
  try {
    state = await call('/api/workspace');
    render();
  } catch(e) {
    var p = document.getElementById('loading') || document.querySelector('#app p');
    if (p) p.innerText = 'Error: ' + e.message;
  }
}
function render() {
  role === 'supervisor' ? supervisor() : student();
}

function student() {
  var pending = state.decisions.filter(function(x) { return x.status === 'pending'; });
  var open = state.actions.filter(function(x) { return x.status === 'open'; });
  var riskMs = state.milestones.filter(function(x) { return risk(x.deadline) !== 'green' && x.status !== 'done'; });
  
  var msHtml = state.milestones.map(function(m) {
    return '<div class="item"><div class="item-title">' + esc(m.id) + ' · ' + esc(m.title) + ' ' + riskLabel(m.deadline) + '</div><div class="meta">截止 ' + date(m.deadline) + ' · ' + esc(m.deliverable) + (m.approvalRequired ? ' · 需教授確認' : '') + '</div><div class="actions"><select onchange="setMilestone(\'' + m.id + '\',this.value)" style="width:auto;margin:0"><option value="not_started" ' + (m.status === 'not_started' ? 'selected' : '') + '>尚未開始</option><option value="in_progress" ' + (m.status === 'in_progress' ? 'selected' : '') + '>進行中</option><option value="done" ' + (m.status === 'done' ? 'selected' : '') + '>已完成</option><option value="blocked" ' + (m.status === 'blocked' ? 'selected' : '') + '>受阻</option></select></div></div>';
  }).join('');

  var winsHtml = state.weeklyBrief.wins.map(function(x) { return '<li>' + esc(x) + '</li>'; }).join('');
  var nextStepsHtml = state.weeklyBrief.nextSteps.map(function(x) { return '<li>' + esc(x) + '</li>'; }).join('');

  var decHtml = state.decisions.map(function(d) {
    var statMap = {'pending': '待回覆', 'approved': '已同意', 'alternative': '採替代方案', 'discussion': '需討論'};
    return '<div class="item"><div class="item-title">' + esc(d.id) + ' · ' + esc(d.topic) + ' ' + tag(statMap[d.status] || d.status, d.status === 'pending' ? 'yellow' : 'green') + '</div><div>' + esc(d.question) + '</div><div class="meta">教授閱讀約 ' + d.readingMinutes + ' 分鐘 · 截止 ' + date(d.deadline) + '</div>' + (d.response ? '<div class="meta">教授：' + esc(d.response) + '</div>' : '') + '</div>';
  }).join('');

  var actHtml = open.map(function(a) {
    return '<div class="item"><div class="item-title">' + esc(a.title) + ' ' + riskLabel(a.deadline) + '</div><div class="meta">截止 ' + date(a.deadline) + (a.sourceDecisionId ? ' · ' + a.sourceDecisionId : '') + '</div><div class="actions"><button class="secondary" onclick="doneAction(\'' + a.id + '\')">完成</button></div></div>';
  }).join('');
  if (open.length === 0) actHtml = '<div class="empty">暫無待辦</div>';

  app.innerHTML = '<section class="hero"><div><h2>你好，' + esc(state.profile.studentName) + '</h2><p>' + esc(state.profile.title) + ' · 目標口試 ' + date(state.profile.targetDefense) + '</p></div><button onclick="decisionForm()">＋ 提出決策請求</button></section><section class="grid"><div class="card"><div class="stat">' + pending.length + '</div><div class="muted">等待教授決策</div></div><div class="card"><div class="stat">' + open.length + '</div><div class="muted">未完成待辦</div></div><div class="card"><div class="stat">' + riskMs.length + '</div><div class="muted">黃／紅燈里程碑</div></div></section><section class="grid two" style="margin-top:16px"><div class="card"><h3>Thesis Roadmap</h3><div class="list">' + msHtml + '</div></div><div class="card"><h3>本週 Brief</h3><p>' + esc(state.weeklyBrief.summary) + '</p><div class="muted">本週完成</div><ul>' + winsHtml + '</ul><div class="muted">下一步</div><ul>' + nextStepsHtml + '</ul></div></section><section class="grid two" style="margin-top:16px"><div class="card"><h3>Decision Log</h3><div class="list">' + decHtml + '</div></div><div class="card"><h3>我的 Action Items</h3><div class="list">' + actHtml + '</div></div></section>';
}

function supervisor() {
  var pending = state.decisions.filter(function(x) { return x.status === 'pending'; }).sort(function(a, b) { return a.deadline.localeCompare(b.deadline); });
  var mins = pending.reduce(function(a, x) { return a + x.readingMinutes; }, 0);
  var overdue = pending.filter(function(x) { return risk(x.deadline) === 'red'; }).length;

  var inboxHtml = pending.map(function(d) {
    return '<div class="item"><div class="item-title">' + esc(d.id) + ' · ' + esc(d.topic) + ' ' + riskLabel(d.deadline) + '</div><div style="font-size:17px;margin-top:4px">' + esc(d.question) + '</div><p><b>學生建議：</b>' + esc(d.recommendation) + '</p><div class="meta">依據：' + esc(d.evidence) + '<br>閱讀約 ' + d.readingMinutes + ' 分鐘 · 請於 ' + date(d.deadline) + ' 前回覆</div><div class="actions"><button onclick="resolve(\'' + d.id + '\',\'approved\')">同意建議</button><button class="secondary" onclick="resolve(\'' + d.id + '\',\'alternative\')">選擇替代方案</button><button class="secondary" onclick="resolve(\'' + d.id + '\',\'discussion\')">需要討論</button></div></div>';
  }).join('');
  if (pending.length === 0) inboxHtml = '<div class="empty">目前沒有待決策事項。</div>';

  var risksHtml = state.weeklyBrief.risks.map(esc).join('；');

  app.innerHTML = '<section class="hero"><div><h2>' + esc(state.profile.supervisorName) + '，您好</h2><p>只看需要您決定的事；每一筆都有學生建議與閱讀時間。</p></div><div>' + tag('預估閱讀 ' + mins + ' 分鐘', 'blue') + '</div></section><section class="grid"><div class="card"><div class="stat">' + pending.length + '</div><div class="muted">待您決策</div></div><div class="card"><div class="stat">' + mins + ' 分</div><div class="muted">預估總閱讀時間</div></div><div class="card"><div class="stat">' + overdue + '</div><div class="muted">已逾截止日</div></div></section><section class="card" style="margin-top:16px"><h3>待決策收件匣</h3><div class="list">' + inboxHtml + '</div></section><section class="card" style="margin-top:16px"><h3>學生本週摘要</h3><p>' + esc(state.weeklyBrief.summary) + '</p><div class="muted">目前風險：' + risksHtml + '</div></section>';
}

function decisionForm() {
  modal.innerHTML = '<form method="dialog"><h3>提出 Decision Request</h3><p class="muted">讓教授可在幾分鐘內做出清楚決定。</p><label>主題<input name="topic" required placeholder="例如：研究問題"></label><label>要教授決定什麼？<textarea name="question" required></textarea></label><label>學生建議<input name="recommendation" required></label><label>選項（以｜分隔）<input name="options" placeholder="保留｜刪除｜調整"></label><label>證據／理由<textarea name="evidence" required></textarea></label><label>預估閱讀分鐘<input name="minutes" type="number" value="3" min="1" max="30"></label><label>希望回覆截止日<input name="deadline" type="date" required></label><div class="actions"><button value="cancel" class="secondary">取消</button><button id="send">送出請求</button></div></form>';
  modal.showModal();
  modal.querySelector('form').addEventListener('submit', async function(e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    var f = new FormData(e.target);
    var opts = f.get('options') || '';
    await call('/api/decisions', {
      method: 'POST',
      body: JSON.stringify({
        topic: f.get('topic'),
        question: f.get('question'),
        recommendation: f.get('recommendation'),
        options: opts.split('｜'),
        evidence: f.get('evidence'),
        readingMinutes: f.get('minutes'),
        deadline: f.get('deadline')
      })
    });
    modal.close();
    await load();
  });
}

function resolve(decisionId, status) {
  var d = state.decisions.find(function(x) { return x.id === decisionId; });
  var titleMap = {'approved': '同意學生建議', 'alternative': '採替代方案', 'discussion': '安排討論'};
  modal.innerHTML = '<form method="dialog"><h3>' + titleMap[status] + '</h3><p>' + esc(d.question) + '</p><label>教授回覆（可選）<textarea name="response" placeholder="給學生的一句指示"></textarea></label><label>建立學生後續待辦（可選）<input name="actionTitle" placeholder="例如：依此方向修訂研究問題"></label><label>待辦截止日<input name="actionDeadline" type="date" value="' + d.deadline + '"></label><div class="actions"><button value="cancel" class="secondary">取消</button><button>確認回覆</button></div></form>';
  modal.showModal();
  modal.querySelector('form').addEventListener('submit', async function(e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    var f = new FormData(e.target);
    await call('/api/decisions/' + decisionId + '/resolve', {
      method: 'PATCH',
      body: JSON.stringify({
        status: status,
        response: f.get('response'),
        actionTitle: f.get('actionTitle'),
        actionDeadline: f.get('actionDeadline')
      })
    });
    modal.close();
    await load();
  });
}

window.setMilestone = async function(id, status) {
  await call('/api/milestones/' + id, { method: 'PATCH', body: JSON.stringify({ status: status }) });
  await load();
};
window.doneAction = async function(id) {
  await call('/api/actions/' + id, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
  await load();
};

load();
</script></body></html>`;
export default { async fetch(request, env) { const url = new URL(request.url); if (url.pathname.startsWith('/api/')) return api(request, env, url.pathname); return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }); } };
