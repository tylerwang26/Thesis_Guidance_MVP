const SESSION_COOKIE = 'tg_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;

function nowIso() {
  return new Date().toISOString();
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });
}

function html(content, status = 200, extraHeaders = {}) {
  return new Response(content, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...extraHeaders
    }
  });
}

function bad(message, status = 400) {
  return json({ error: message }, status);
}

function parseCookies(req) {
  const raw = req.headers.get('cookie') || '';
  const out = {};
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${SESSION_TTL_SECONDS}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  return sha256(`${salt}:${password}`);
}

async function getJsonKV(env, key) {
  return env.THESIS_KV.get(key, 'json');
}

async function putJsonKV(env, key, value) {
  await env.THESIS_KV.put(key, JSON.stringify(value));
}

function normEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function esc(s) {
  const val = s === null || s === undefined ? '' : String(s);
  return val.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${randomHex(4)}`;
}

function zdate(s) {
  if (!s) return '';
  const p = s.split('-');
  if (p.length === 3) return `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日`;
  return s;
}

function daysLeft(s) {
  if (!s) return 999;
  const t = new Date(s.replace(/-/g, '/') + ' 23:59:59').getTime();
  if (isNaN(t)) return 999;
  return Math.ceil((t - Date.now()) / 86400000);
}

function risk(deadline) {
  const d = daysLeft(deadline);
  if (d < 0) return 'red';
  if (d <= 5) return 'yellow';
  return 'green';
}

function riskText(deadline) {
  const r = risk(deadline);
  if (r === 'red') return '逾期';
  if (r === 'yellow') return '5日內';
  return '進度穩定';
}

async function getSession(req, env) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await getJsonKV(env, `v2:session:${token}`);
  if (!session) return null;
  if (!session.expiresAt || Date.now() > session.expiresAt) {
    await env.THESIS_KV.delete(`v2:session:${token}`);
    return null;
  }
  const user = await getJsonKV(env, `v2:user:${session.userId}`);
  if (!user) return null;
  return { token, user };
}

async function requireSession(req, env) {
  const sess = await getSession(req, env);
  if (!sess) return { error: bad('請先登入', 401) };
  return { session: sess };
}

async function getWorkspaceForUser(env, user) {
  const ref = await getJsonKV(env, `v2:user_workspace:${user.id}`);
  if (!ref || !ref.workspaceId) return null;
  return getJsonKV(env, `v2:workspace:${ref.workspaceId}`);
}

async function saveWorkspace(env, workspace) {
  workspace.updatedAt = nowIso();
  await putJsonKV(env, `v2:workspace:${workspace.id}`, workspace);
}

async function sendLinePush(env, to, text) {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || !to) return { ok: false, skipped: true };
  const body = {
    to,
    messages: [{ type: 'text', text: String(text || '').slice(0, 4500) }]
  };
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

function canAccessWorkspace(user, workspace) {
  if (!user || !workspace) return false;
  if (user.role === 'professor' && workspace.professorId === user.id) return true;
  if (user.role === 'student' && workspace.studentIds && workspace.studentIds.indexOf(user.id) >= 0) return true;
  return false;
}

function defaultWorkspaceForProfessor(user, profileInput = {}) {
  return {
    id: id('ws'),
    professorId: user.id,
    studentIds: [],
    profile: {
      title: profileInput.title || '尚未設定題目',
      school: profileInput.school || '',
      department: profileInput.department || '',
      researchFocus: profileInput.researchFocus || '',
      targetDefense: profileInput.targetDefense || '',
      studentName: profileInput.studentName || '',
      supervisorName: user.name
    },
    milestones: [
      { id: 'M-01', title: '研究缺口定稿', deadline: '', status: 'not_started', deliverable: '一頁研究缺口聲明', approvalRequired: true },
      { id: 'M-02', title: '研究問題凍結', deadline: '', status: 'not_started', deliverable: 'RQ vFinal', approvalRequired: true },
      { id: 'M-03', title: '理論架構', deadline: '', status: 'not_started', deliverable: '概念架構圖與假設', approvalRequired: true },
      { id: 'M-04', title: '研究方法 v1', deadline: '', status: 'not_started', deliverable: '方法章草稿', approvalRequired: true }
    ],
    decisions: [],
    actions: [],
    weeklyBrief: {
      weekOf: '',
      summary: '',
      wins: [],
      risks: [],
      nextSteps: []
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
}

function parseJsonOrNull(request) {
  return request.json().catch(() => null);
}

async function handleApi(request, env, path) {
  const method = request.method;

  if (path === '/api/health') {
    return json({ ok: true, at: nowIso() });
  }

  if (path === '/api/auth/register' && method === 'POST') {
    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const email = normEmail(body.email);
    const password = String(body.password || '');
    const role = body.role === 'professor' ? 'professor' : 'student';
    const name = String(body.name || '').trim();
    if (!email || !password || !name) return bad('name/email/password 必填');
    if (password.length < 8) return bad('密碼至少 8 碼');

    const exists = await getJsonKV(env, `v2:user_email:${email}`);
    if (exists && exists.userId) return bad('此 Email 已註冊', 409);

    const userId = id('u');
    const salt = randomHex(8);
    const passwordHash = await hashPassword(password, salt);
    const user = {
      id: userId,
      email,
      name,
      role,
      salt,
      passwordHash,
      lineUserId: '',
      lineNotifyEnabled: false,
      createdAt: nowIso()
    };

    await putJsonKV(env, `v2:user:${userId}`, user);
    await putJsonKV(env, `v2:user_email:${email}`, { userId });

    if (role === 'professor') {
      const ws = defaultWorkspaceForProfessor(user, {
        title: body.title,
        school: body.school,
        department: body.department,
        researchFocus: body.researchFocus,
        targetDefense: body.targetDefense,
        studentName: ''
      });
      await saveWorkspace(env, ws);
      await putJsonKV(env, `v2:user_workspace:${user.id}`, { workspaceId: ws.id });
    }

    const token = randomHex(24);
    await putJsonKV(env, `v2:session:${token}`, {
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
    });

    return json({ ok: true, user: { id: user.id, role: user.role, email: user.email, name: user.name } }, 201, {
      'set-cookie': setSessionCookie(token)
    });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const email = normEmail(body.email);
    const password = String(body.password || '');

    const ref = await getJsonKV(env, `v2:user_email:${email}`);
    if (!ref || !ref.userId) return bad('帳號或密碼錯誤', 401);
    const user = await getJsonKV(env, `v2:user:${ref.userId}`);
    if (!user) return bad('帳號或密碼錯誤', 401);

    const passwordHash = await hashPassword(password, user.salt);
    if (passwordHash !== user.passwordHash) return bad('帳號或密碼錯誤', 401);

    const token = randomHex(24);
    await putJsonKV(env, `v2:session:${token}`, {
      userId: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
    });

    return json({ ok: true, user: { id: user.id, role: user.role, email: user.email, name: user.name } }, 200, {
      'set-cookie': setSessionCookie(token)
    });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const sess = await getSession(request, env);
    if (sess && sess.token) {
      await env.THESIS_KV.delete(`v2:session:${sess.token}`);
    }
    return json({ ok: true }, 200, {
      'set-cookie': clearSessionCookie()
    });
  }

  if (path === '/api/me' && method === 'GET') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    const workspace = await getWorkspaceForUser(env, user);
    return json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        lineUserId: user.lineUserId || '',
        lineNotifyEnabled: !!user.lineNotifyEnabled
      },
      workspaceId: workspace ? workspace.id : null
    });
  }

  if (path === '/api/me/line' && method === 'PATCH') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const user = gate.session.user;
    user.lineUserId = String(body.lineUserId || '').trim();
    user.lineNotifyEnabled = !!body.lineNotifyEnabled;
    await putJsonKV(env, `v2:user:${user.id}`, user);
    return json({ ok: true, lineUserId: user.lineUserId, lineNotifyEnabled: user.lineNotifyEnabled });
  }

  if (path === '/api/invites' && method === 'POST') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    if (user.role !== 'professor') return bad('僅教授可建立邀請', 403);

    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('教授尚未建立 workspace', 400);

    const code = `INV-${randomHex(4).toUpperCase()}`;
    const invite = {
      code,
      workspaceId: workspace.id,
      professorId: user.id,
      createdAt: nowIso(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14,
      usedBy: null
    };
    await putJsonKV(env, `v2:invite:${code}`, invite);
    return json({ ok: true, invite });
  }

  if (path === '/api/invites/accept' && method === 'POST') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    if (user.role !== 'student') return bad('僅學生可接受邀請', 403);

    const body = await parseJsonOrNull(request);
    if (!body || !body.code) return bad('請提供邀請碼');
    const code = String(body.code || '').trim().toUpperCase();
    const invite = await getJsonKV(env, `v2:invite:${code}`);
    if (!invite) return bad('邀請碼不存在', 404);
    if (invite.expiresAt < Date.now()) return bad('邀請碼已過期', 400);

    const workspace = await getJsonKV(env, `v2:workspace:${invite.workspaceId}`);
    if (!workspace) return bad('workspace 不存在', 404);

    if (workspace.studentIds.indexOf(user.id) < 0) workspace.studentIds.push(user.id);
    if (!workspace.profile.studentName) workspace.profile.studentName = user.name;
    await saveWorkspace(env, workspace);
    invite.usedBy = user.id;
    invite.usedAt = nowIso();
    await putJsonKV(env, `v2:invite:${code}`, invite);
    await putJsonKV(env, `v2:user_workspace:${user.id}`, { workspaceId: workspace.id });
    return json({ ok: true, workspaceId: workspace.id });
  }

  if (path === '/api/workspace' && method === 'GET') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('尚未加入任何 workspace', 404);
    if (!canAccessWorkspace(user, workspace)) return bad('無權限', 403);

    const pendingCount = workspace.decisions.filter((x) => x.status === 'pending').length;
    return json({ workspace, pendingCount });
  }

  if (path === '/api/profile' && method === 'PATCH') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const user = gate.session.user;
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('尚未加入 workspace', 404);
    if (!canAccessWorkspace(user, workspace)) return bad('無權限', 403);

    const p = workspace.profile;
    p.title = String(body.title || p.title || '');
    p.school = String(body.school || p.school || '');
    p.department = String(body.department || p.department || '');
    p.researchFocus = String(body.researchFocus || p.researchFocus || '');
    p.targetDefense = String(body.targetDefense || p.targetDefense || '');
    if (user.role === 'student') p.studentName = user.name;
    if (user.role === 'professor') p.supervisorName = user.name;

    await saveWorkspace(env, workspace);
    return json({ ok: true, profile: p });
  }

  if (path === '/api/weekly-brief' && method === 'PATCH') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    if (user.role !== 'student') return bad('僅學生可更新週報', 403);

    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('尚未加入 workspace', 404);

    workspace.weeklyBrief = {
      weekOf: String(body.weekOf || workspace.weeklyBrief.weekOf || ''),
      summary: String(body.summary || workspace.weeklyBrief.summary || ''),
      wins: Array.isArray(body.wins) ? body.wins.map((x) => String(x || '')).filter(Boolean) : workspace.weeklyBrief.wins,
      risks: Array.isArray(body.risks) ? body.risks.map((x) => String(x || '')).filter(Boolean) : workspace.weeklyBrief.risks,
      nextSteps: Array.isArray(body.nextSteps) ? body.nextSteps.map((x) => String(x || '')).filter(Boolean) : workspace.weeklyBrief.nextSteps
    };
    await saveWorkspace(env, workspace);

    const professor = await getJsonKV(env, `v2:user:${workspace.professorId}`);
    if (professor && professor.lineNotifyEnabled && professor.lineUserId) {
      await sendLinePush(env, professor.lineUserId, `學生 ${user.name} 已更新週報\n題目：${workspace.profile.title || '-'}\n本週摘要：${workspace.weeklyBrief.summary || '-'}`);
    }

    return json({ ok: true, weeklyBrief: workspace.weeklyBrief });
  }

  if (path === '/api/decisions' && method === 'POST') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    if (user.role !== 'student') return bad('僅學生可提出決策請求', 403);

    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('尚未加入 workspace', 404);

    const item = {
      id: id('D'),
      topic: String(body.topic || ''),
      question: String(body.question || ''),
      options: Array.isArray(body.options) ? body.options.map((x) => String(x || '')).filter(Boolean) : [],
      recommendation: String(body.recommendation || ''),
      evidence: String(body.evidence || ''),
      readingMinutes: Math.max(1, Number(body.readingMinutes) || 3),
      deadline: String(body.deadline || ''),
      status: 'pending',
      response: '',
      createdAt: nowIso(),
      resolvedAt: null,
      createdBy: user.id
    };
    workspace.decisions.unshift(item);
    await saveWorkspace(env, workspace);

    const professor = await getJsonKV(env, `v2:user:${workspace.professorId}`);
    if (professor && professor.lineNotifyEnabled && professor.lineUserId) {
      await sendLinePush(env, professor.lineUserId, `新 Decision Request\n學生：${user.name}\n主題：${item.topic}\n問題：${item.question}\n截止：${item.deadline || '-'}`);
    }

    return json(item, 201);
  }

  const resolveMatch = path.match(/^\/api\/decisions\/([^/]+)\/resolve$/);
  if (resolveMatch && method === 'PATCH') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    if (user.role !== 'professor') return bad('僅教授可回覆決策', 403);

    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('尚未加入 workspace', 404);

    const decisionId = resolveMatch[1];
    const decision = workspace.decisions.find((x) => x.id === decisionId);
    if (!decision) return bad('找不到決策', 404);

    decision.status = String(body.status || 'approved');
    decision.response = String(body.response || '');
    decision.resolvedAt = nowIso();
    decision.resolvedBy = user.id;

    if (body.actionTitle) {
      workspace.actions.unshift({
        id: id('A'),
        title: String(body.actionTitle),
        owner: '學生',
        deadline: String(body.actionDeadline || decision.deadline || ''),
        status: 'open',
        sourceDecisionId: decision.id
      });
    }

    await saveWorkspace(env, workspace);
    return json(decision);
  }

  const milestoneMatch = path.match(/^\/api\/milestones\/([^/]+)$/);
  if (milestoneMatch && method === 'PATCH') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('尚未加入 workspace', 404);

    const item = workspace.milestones.find((x) => x.id === milestoneMatch[1]);
    if (!item) return bad('找不到里程碑', 404);
    item.status = String(body.status || item.status || 'not_started');
    await saveWorkspace(env, workspace);
    return json(item);
  }

  const actionMatch = path.match(/^\/api\/actions\/([^/]+)$/);
  if (actionMatch && method === 'PATCH') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    const body = await parseJsonOrNull(request);
    if (!body) return bad('無效資料');
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) return bad('尚未加入 workspace', 404);

    const item = workspace.actions.find((x) => x.id === actionMatch[1]);
    if (!item) return bad('找不到待辦', 404);
    item.status = String(body.status || item.status || 'open');
    await saveWorkspace(env, workspace);
    return json(item);
  }

  if (path === '/api/dev/reset-demo' && method === 'POST') {
    const gate = await requireSession(request, env);
    if (gate.error) return gate.error;
    const user = gate.session.user;
    if (user.role !== 'professor') return bad('僅教授可重設', 403);
    const ws = defaultWorkspaceForProfessor(user, { title: '示範題目' });
    await saveWorkspace(env, ws);
    await putJsonKV(env, `v2:user_workspace:${user.id}`, { workspaceId: ws.id });
    return json({ ok: true, workspaceId: ws.id });
  }

  return bad('找不到 API', 404);
}

function authPage() {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thesis Guidance</title><style>
:root{--bg:#f3f6f8;--ink:#172432;--line:#d8e0e8;--blue:#146784}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif;color:var(--ink)}main{max-width:980px;margin:30px auto;padding:0 16px;display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px}h1{font-size:24px;margin:0 0 10px}h2{font-size:18px;margin:0 0 10px}input,select,button,textarea{font:inherit}input,select,textarea{width:100%;padding:8px;border:1px solid #b7c5d0;border-radius:8px;margin:6px 0 10px}button{border:0;background:var(--blue);color:#fff;border-radius:8px;padding:9px 12px;cursor:pointer}.muted{color:#607284;font-size:13px}#msg{max-width:980px;margin:0 auto 14px;padding:0 16px;color:#b03030}@media(max-width:760px){main{grid-template-columns:1fr}}</style></head><body><main><section class="card"><h1>論文指導工作台</h1><p class="muted">Phase A+B：登入、邀請、決策、里程碑、週報、LINE 通知</p><h2>登入</h2><label>Email<input id="loginEmail" type="email"></label><label>密碼<input id="loginPassword" type="password"></label><button onclick="login()">登入</button></section><section class="card"><h2>註冊</h2><label>姓名<input id="regName"></label><label>Email<input id="regEmail" type="email"></label><label>密碼（至少8碼）<input id="regPassword" type="password"></label><label>角色<select id="regRole"><option value="student">學生</option><option value="professor">教授</option></select></label><label>學生邀請碼（學生可填）<input id="inviteCode" placeholder="INV-XXXX"></label><button onclick="register()">建立帳號</button></section></main><div id="msg"></div><script>
function show(m){document.getElementById('msg').innerText=m||''}
function req(url,opt){opt=opt||{};return fetch(url,Object.assign({headers:{'content-type':'application/json'}},opt)).then(async r=>{let j={};try{j=await r.json()}catch(e){};if(!r.ok)throw new Error((j&&j.error)||'request failed');return j;});}
function login(){req('/api/auth/login',{method:'POST',body:JSON.stringify({email:document.getElementById('loginEmail').value,password:document.getElementById('loginPassword').value})}).then(()=>location.href='/dashboard').catch(e=>show('登入失敗：'+e.message));}
function register(){var role=document.getElementById('regRole').value;req('/api/auth/register',{method:'POST',body:JSON.stringify({name:document.getElementById('regName').value,email:document.getElementById('regEmail').value,password:document.getElementById('regPassword').value,role:role})}).then(async()=>{if(role==='student'){var code=document.getElementById('inviteCode').value.trim();if(code){await req('/api/invites/accept',{method:'POST',body:JSON.stringify({code:code})});}}location.href='/dashboard';}).catch(e=>show('註冊失敗：'+e.message));}
</script></body></html>`;
}

function dashboardShell(user, workspace, pendingCount) {
  const isStudent = user.role === 'student';
  const pending = workspace ? workspace.decisions.filter((x) => x.status === 'pending') : [];
  const resolved = workspace ? workspace.decisions.filter((x) => x.status !== 'pending') : [];
  const actions = workspace ? workspace.actions.filter((x) => x.status === 'open') : [];
  const milestones = workspace ? workspace.milestones : [];

  const inviteSection = user.role === 'professor'
    ? `<div class="card"><h3>學生邀請</h3><div class="muted">產生邀請碼，給學生註冊後加入</div><button onclick="createInvite()">產生邀請碼</button><div id="inviteOut" class="muted" style="margin-top:8px"></div></div>`
    : `<div class="card"><h3>加入教授 workspace</h3><input id="acceptCode" placeholder="INV-XXXX"><button onclick="acceptInvite()">加入</button></div>`;

  const lineSection = user.role === 'professor'
    ? `<div class="card"><h3>LINE 通知設定</h3><label>LINE User ID<input id="lineUserId" value="${esc(user.lineUserId || '')}" placeholder="Uxxxxxxxx"></label><label><input id="lineEnabled" type="checkbox" ${user.lineNotifyEnabled ? 'checked' : ''} style="width:auto"> 啟用更新通知</label><button onclick="saveLine()">儲存 LINE 設定</button><div class="muted">更新事件：新決策請求、週報更新</div></div>`
    : '';

  const decisionForm = isStudent
    ? `<div class="card"><h3>提出 Decision Request</h3><input id="dTopic" placeholder="主題"><textarea id="dQuestion" placeholder="要教授決定什麼"></textarea><input id="dRec" placeholder="學生建議"><input id="dOpts" placeholder="選項，以｜分隔"><textarea id="dEvi" placeholder="證據/理由"></textarea><input id="dMins" type="number" min="1" max="30" value="3"><input id="dDeadline" type="date"><button onclick="createDecision()">送出</button></div>`
    : '';

  const pendingHtml = pending.map((d) => `<div class="item"><b>${esc(d.topic)}</b> · ${esc(d.id)} <span class="badge ${risk(d.deadline)}">${riskText(d.deadline)}</span><div>${esc(d.question)}</div><div class="muted">截止 ${esc(zdate(d.deadline))} · ${esc(d.readingMinutes)} 分鐘</div>${!isStudent ? `<div class="row"><button onclick="resolve('${esc(d.id)}','approved')">同意建議</button><button class="sec" onclick="resolve('${esc(d.id)}','alternative')">替代方案</button><button class="sec" onclick="resolve('${esc(d.id)}','discussion')">需討論</button></div><input id="resp_${esc(d.id)}" placeholder="教授回覆（可選）"><input id="act_${esc(d.id)}" placeholder="後續 Action（可選）"><input id="actd_${esc(d.id)}" type="date">` : ''}</div>`).join('') || '<div class="muted">目前無待決策</div>';

  const resolvedHtml = resolved.map((d) => `<div class="item"><b>${esc(d.topic)}</b> · ${esc(d.id)} <span class="badge blue">${esc(d.status)}</span><div>${esc(d.question)}</div><div class="muted">教授回覆：${esc(d.response || '-')}</div></div>`).join('') || '<div class="muted">尚無已完成決策</div>';

  const actionsHtml = actions.map((a) => `<div class="item"><b>${esc(a.title)}</b> <span class="badge ${risk(a.deadline)}">${riskText(a.deadline)}</span><div class="muted">截止 ${esc(zdate(a.deadline))}</div>${isStudent ? `<button class="sec" onclick="doneAction('${esc(a.id)}')">完成</button>` : ''}</div>`).join('') || '<div class="muted">暫無待辦</div>';

  const milestonesHtml = milestones.map((m) => `<div class="item"><b>${esc(m.id)} ${esc(m.title)}</b> <span class="badge ${risk(m.deadline)}">${riskText(m.deadline)}</span><div class="muted">截止 ${esc(zdate(m.deadline || '未設定'))}</div><select onchange="setMilestone('${esc(m.id)}',this.value)"><option value="not_started" ${m.status==='not_started'?'selected':''}>尚未開始</option><option value="in_progress" ${m.status==='in_progress'?'selected':''}>進行中</option><option value="done" ${m.status==='done'?'selected':''}>已完成</option><option value="blocked" ${m.status==='blocked'?'selected':''}>受阻</option></select></div>`).join('') || '<div class="muted">尚無里程碑</div>';

  const wb = workspace ? workspace.weeklyBrief : { weekOf: '', summary: '', wins: [], risks: [], nextSteps: [] };
  const profile = workspace ? workspace.profile : {};

  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard</title><style>
:root{--bg:#f4f7f9;--ink:#1a2735;--line:#d9e2e9;--blue:#156d8a;--muted:#607284;--red:#b83d3d;--yellow:#b17900;--green:#157f59}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 system-ui,-apple-system,"Noto Sans TC",sans-serif}header{background:#102b3b;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}main{max-width:1160px;margin:20px auto;padding:0 16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.two{grid-template-columns:1fr 1fr}.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px}.item{border-top:1px solid var(--line);padding:10px 0}.item:first-child{border-top:0;padding-top:0}.muted{color:var(--muted);font-size:13px}.badge{display:inline-block;border-radius:999px;padding:2px 8px;font-size:12px;font-weight:700}.red{color:var(--red);background:#fce9e9}.yellow{color:var(--yellow);background:#fff5dc}.green{color:var(--green);background:#e7f6ef}.blue{color:#1d5d8b;background:#e4f0fb}.row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}button{border:0;background:var(--blue);color:#fff;border-radius:8px;padding:8px 11px;cursor:pointer}button.sec{background:#fff;color:var(--blue);border:1px solid #bfd0dc}input,textarea,select{width:100%;padding:8px;border:1px solid #b8c6d0;border-radius:8px;margin-top:6px;margin-bottom:8px;font:inherit}textarea{min-height:70px}ul{margin:6px 0 0 18px;padding:0}@media(max-width:900px){.grid,.two{grid-template-columns:1fr}}</style></head><body><header><div><b>${esc(user.name)}</b>（${esc(user.role)}）</div><div><button class="sec" onclick="logout()">登出</button></div></header><main><div id="msg" class="muted"></div><section class="grid"><div class="card"><div style="font-size:26px;font-weight:700">${pendingCount || 0}</div><div class="muted">待決策</div></div><div class="card"><div style="font-size:26px;font-weight:700">${actions.length}</div><div class="muted">未完成待辦</div></div><div class="card"><div style="font-size:26px;font-weight:700">${milestones.filter((m)=>risk(m.deadline)!=='green'&&m.status!=='done').length}</div><div class="muted">黃/紅燈里程碑</div></div></section><section class="grid two" style="margin-top:14px"><div class="card"><h3>Workspace Profile</h3><input id="pTitle" value="${esc(profile.title || '')}" placeholder="論文題目"><input id="pSchool" value="${esc(profile.school || '')}" placeholder="學校"><input id="pDept" value="${esc(profile.department || '')}" placeholder="系所"><input id="pFocus" value="${esc(profile.researchFocus || '')}" placeholder="研究方向"><label>目標口試日<input id="pDefense" type="date" value="${esc(profile.targetDefense || '')}"></label><button onclick="saveProfile()">儲存基本資料</button></div>${inviteSection}</section>${lineSection?`<section style="margin-top:14px">${lineSection}</section>`:''}${decisionForm?`<section style="margin-top:14px">${decisionForm}</section>`:''}<section class="grid two" style="margin-top:14px"><div class="card"><h3>待決策收件匣</h3>${pendingHtml}</div><div class="card"><h3>Decision Log</h3>${resolvedHtml}</div></section><section class="grid two" style="margin-top:14px"><div class="card"><h3>里程碑</h3>${milestonesHtml}</div><div class="card"><h3>Action Items</h3>${actionsHtml}</div></section><section class="card" style="margin-top:14px"><h3>Weekly Brief</h3><label>週別<input id="wbWeek" type="date" value="${esc(wb.weekOf||'')}"></label><textarea id="wbSummary" placeholder="本週摘要">${esc(wb.summary||'')}</textarea><input id="wbWins" value="${esc((wb.wins||[]).join('｜'))}" placeholder="本週完成，以｜分隔"><input id="wbRisks" value="${esc((wb.risks||[]).join('｜'))}" placeholder="風險，以｜分隔"><input id="wbNext" value="${esc((wb.nextSteps||[]).join('｜'))}" placeholder="下一步，以｜分隔">${isStudent?'<button onclick="saveWeekly()">儲存週報（會通知教授）</button>':'<div class="muted">僅學生可更新週報</div>'}</section></main><script>
function show(m){document.getElementById('msg').innerText=m||''}
function req(url,opt){opt=opt||{};return fetch(url,Object.assign({headers:{'content-type':'application/json'}},opt)).then(async r=>{let j={};try{j=await r.json()}catch(e){};if(!r.ok)throw new Error((j&&j.error)||'request failed');return j;});}
function reload(){location.reload()}
function logout(){req('/api/auth/logout',{method:'POST'}).then(()=>location.href='/').catch(e=>show(e.message))}
function saveProfile(){req('/api/profile',{method:'PATCH',body:JSON.stringify({title:val('pTitle'),school:val('pSchool'),department:val('pDept'),researchFocus:val('pFocus'),targetDefense:val('pDefense')})}).then(()=>{show('已儲存');reload()}).catch(e=>show(e.message))}
function createInvite(){req('/api/invites',{method:'POST'}).then(r=>{document.getElementById('inviteOut').innerText='邀請碼：'+r.invite.code+'（14天有效）';}).catch(e=>show(e.message))}
function acceptInvite(){req('/api/invites/accept',{method:'POST',body:JSON.stringify({code:val('acceptCode')})}).then(()=>{show('加入成功');reload()}).catch(e=>show(e.message))}
function saveLine(){req('/api/me/line',{method:'PATCH',body:JSON.stringify({lineUserId:val('lineUserId'),lineNotifyEnabled:document.getElementById('lineEnabled').checked})}).then(()=>show('LINE 設定已更新')).catch(e=>show(e.message))}
function createDecision(){req('/api/decisions',{method:'POST',body:JSON.stringify({topic:val('dTopic'),question:val('dQuestion'),recommendation:val('dRec'),options:val('dOpts').split('｜').filter(Boolean),evidence:val('dEvi'),readingMinutes:Number(val('dMins')||3),deadline:val('dDeadline')})}).then(()=>{show('已送出');reload()}).catch(e=>show(e.message))}
function resolve(id,status){req('/api/decisions/'+id+'/resolve',{method:'PATCH',body:JSON.stringify({status:status,response:val('resp_'+id),actionTitle:val('act_'+id),actionDeadline:val('actd_'+id)})}).then(()=>{show('已回覆');reload()}).catch(e=>show(e.message))}
function setMilestone(id,status){req('/api/milestones/'+id,{method:'PATCH',body:JSON.stringify({status:status})}).then(()=>show('里程碑已更新')).catch(e=>show(e.message))}
function doneAction(id){req('/api/actions/'+id,{method:'PATCH',body:JSON.stringify({status:'done'})}).then(()=>reload()).catch(e=>show(e.message))}
function saveWeekly(){req('/api/weekly-brief',{method:'PATCH',body:JSON.stringify({weekOf:val('wbWeek'),summary:val('wbSummary'),wins:val('wbWins').split('｜').filter(Boolean),risks:val('wbRisks').split('｜').filter(Boolean),nextSteps:val('wbNext').split('｜').filter(Boolean)})}).then(()=>{show('週報已更新並通知教授');reload()}).catch(e=>show(e.message))}
function val(id){var el=document.getElementById(id);return el?el.value:''}
</script></body></html>`;
}

async function handlePage(request, env, path) {
  const sess = await getSession(request, env);
  if (!sess) return html(authPage());

  if (path === '/dashboard' || path === '/') {
    const user = sess.user;
    const workspace = await getWorkspaceForUser(env, user);
    if (!workspace) {
      return html(`<!doctype html><html><body style="font-family:sans-serif;padding:20px"><h2>尚未加入 workspace</h2><p>學生請使用邀請碼加入；教授請先建立帳號後登入。</p><p><a href="/">回首頁</a></p></body></html>`);
    }
    if (!canAccessWorkspace(user, workspace)) return html('<h1>403</h1>', 403);
    const pendingCount = workspace.decisions.filter((x) => x.status === 'pending').length;
    return html(dashboardShell(user, workspace, pendingCount));
  }

  return html('<h1>Not Found</h1>', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url.pathname);
    }
    return handlePage(request, env, url.pathname);
  }
};
