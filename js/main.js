/* global supabase */
(function () {
  const THEME_KEY = "ldpr_theme";
  const VISION_KEY = "ldpr_vision_mode";
  const VISION_SETTINGS_KEY = "ldpr_vision_settings";
  
  const ROLES = { USER: "user", ADMIN: "admin" };
  const STATUS_LABELS = { new: "Новое", in_progress: "В работе", closed: "Завершено" };
  const STATUS_CLASSES = { new: "status-new", in_progress: "status-progress", closed: "status-closed" };
  const TOPICS = {
    question: "Вопрос депутату",
    complaint: "Жалоба на ЖКХ",
    social_help: "Помощь в соцзащите",
    suggestion: "Общее предложение",
  };
  
  function sb() { if (!window.__SUPABASE__) throw new Error("Supabase клиент не инициализирован."); return window.__SUPABASE__; }
  function nowIso() { return new Date().toISOString(); }
  function formatDate(iso) { return new Date(iso).toLocaleString("ru-RU"); }
  function ensureNoError(error, fallback) { if (error) throw new Error(error.message || fallback); }
  function mapTicket(r) { return { id: r.id, userId: r.user_id, subject: r.subject, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at }; }
  function mapMessage(r) { return { id: r.id, ticketId: r.ticket_id, senderId: r.sender_id, senderRole: r.sender_role, content: r.content, attachment: r.attachment || null, createdAt: r.created_at }; }
  function mapProfile(p, u) { return { id: p.id, name: p.name || u.user_metadata.full_name || "Пользователь", email: p.email || u.email || "", role: p.role || ROLES.USER, phone: p.phone || "", address: p.address || "" }; }
  
  // ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
  async function getSession() { const { data, error } = await sb().auth.getSession(); ensureNoError(error, "Не удалось получить сессию"); return data.session || null; }
  async function getAuthUser() { const { data, error } = await sb().auth.getUser(); ensureNoError(error, "Не удалось получить пользователя"); return data.user || null; }
  async function getProfile(id) { const { data, error } = await sb().from("profiles").select("*").eq("id", id).maybeSingle(); ensureNoError(error, "Не удалось получить профиль"); return data; }
  
  async function ensureProfile(user, payload) {
    const existing = await getProfile(user.id);
    if (existing) return mapProfile(existing, user);
    const { data, error } = await sb().from("profiles").insert({
      id: user.id, name: payload && payload.name ? payload.name : (user.user_metadata.full_name || "Пользователь"),
      email: payload && payload.email ? payload.email : (user.email || ""), phone: payload && payload.phone ? payload.phone : "",
      address: payload && payload.address ? payload.address : "", role: payload && payload.role ? payload.role : ROLES.USER,
    }).select("*").single();
    ensureNoError(error, "Не удалось создать профиль");
    return mapProfile(data, user);
  }
  
  async function getSessionUser() { const s = await getSession(); if (!s) return null; const u = await getAuthUser(); if (!u) return null; return ensureProfile(u); }
  async function logout() { await sb().auth.signOut(); location.href = "index.html"; }
  
  async function requireRole(role) {
    const user = await getSessionUser();
    if (!user) { location.href = "index.html"; return null; }
    if (user.role !== role) { location.href = user.role === ROLES.ADMIN ? "admin-dashboard.html" : "user-dashboard.html"; return null; }
    return user;
  }
  
  async function fetchUserTickets(uid) { const { data, error } = await sb().from("tickets").select("*").eq("user_id", uid).order("created_at", { ascending: false }); ensureNoError(error, "Не удалось загрузить обращения"); return (data || []).map(mapTicket); }
  async function fetchAllTickets() { const { data, error } = await sb().from("tickets").select("*").order("created_at", { ascending: false }); ensureNoError(error, "Не удалось загрузить обращения"); return (data || []).map(mapTicket); }
  async function fetchMessagesByTicket(tid) { const { data, error } = await sb().from("messages").select("*").eq("ticket_id", tid).order("created_at", { ascending: true }); ensureNoError(error, "Не удалось загрузить сообщения"); return (data || []).map(mapMessage); }
  async function fetchProfilesMap() { const { data, error } = await sb().from("profiles").select("*"); ensureNoError(error, "Не удалось загрузить профили"); const m = {}; (data || []).forEach(function (p) { m[p.id] = p; }); return m; }
  
  function csvEscape(v) { const s = String(v == null ? "" : v); return '"' + s.replace(/"/g, '""') + '"'; }
  function parseDateOnly(value, eod) { if (!value) return null; const d = new Date(value + (eod ? "T23:59:59.999" : "T00:00:00.000")); return isNaN(d.getTime()) ? null : d; }
  
  // ========== ТЕМА ==========
  function applyTheme(theme) { 
    document.body.classList.remove("theme-dark", "theme-light"); 
    document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
    if (document.body.classList.contains("vision-impaired")) {
      applyVisionFilters();
    }
  }
  
  function initThemeToggle() {
    const saved = localStorage.getItem(THEME_KEY) || "dark"; 
    applyTheme(saved); 
    if (document.getElementById("themeToggleBtn")) return;
    const btn = document.createElement("button"); 
    btn.id = "themeToggleBtn"; 
    btn.className = "theme-toggle-btn"; 
    btn.type = "button";
    function setLabel(theme) { btn.textContent = theme === "light" ? "🌙 Темная" : "☀️ Светлая"; }
    setLabel(saved); 
    btn.addEventListener("click", function () { 
      const c = document.body.classList.contains("theme-light") ? "light" : "dark"; 
      const n = c === "light" ? "dark" : "light"; 
      applyTheme(n); 
      localStorage.setItem(THEME_KEY, n); 
      setLabel(n); 
    });
    document.body.appendChild(btn);
  }
  
  // ========== РЕЖИМ ДЛЯ СЛАБОВИДЯЩИХ ==========
  let visionPanel = null;
  
  function getVisionSettings() {
    const defaults = { enabled: false, mode: "none", fontSize: 100, letterSpacing: 0 };
    try {
      const saved = localStorage.getItem(VISION_SETTINGS_KEY);
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch(e) {}
    return defaults;
  }
  
  function saveVisionSettings(settings) {
    localStorage.setItem(VISION_SETTINGS_KEY, JSON.stringify(settings));
  }
  
  function applyVisionFilters() {
    const settings = getVisionSettings();
    if (!settings.enabled) return;
    
    document.body.classList.remove("vision-none", "vision-contrast", "vision-bw", "vision-invert");
    
    switch(settings.mode) {
      case "contrast":
        document.body.classList.add("vision-contrast");
        break;
      case "bw":
        document.body.classList.add("vision-bw");
        break;
      case "invert":
        document.body.classList.add("vision-invert");
        break;
      case "none":
      default:
        document.body.classList.add("vision-none");
        break;
    }
    
    document.body.style.fontSize = settings.fontSize + "%";
    document.body.style.letterSpacing = settings.letterSpacing + "px";
  }
  
  function applyVisionMode(enabled) {
    const settings = getVisionSettings();
    settings.enabled = enabled;
    saveVisionSettings(settings);
    
    if (enabled) {
      document.body.classList.add("vision-impaired");
      applyVisionFilters();
      showVisionPanel();
    } else {
      document.body.classList.remove("vision-impaired", "vision-none", "vision-contrast", "vision-bw", "vision-invert");
      document.body.style.fontSize = "";
      document.body.style.letterSpacing = "";
      hideVisionPanel();
    }
  }
  
  function showVisionPanel() {
    if (visionPanel) return;
    visionPanel = document.createElement("div");
    visionPanel.id = "visionPanel";
    visionPanel.className = "vision-panel";
    visionPanel.innerHTML = `
      <div class="vision-panel-header">
        <span>🔍 Режим для слабовидящих</span>
        <button id="closeVisionPanelBtn" class="vision-panel-close">✕</button>
      </div>
      <div class="vision-panel-content">
        <div class="vision-control-group">
          <label>🎨 Цветовой режим:</label>
          <div class="vision-buttons">
            <button data-vision-mode="none" class="vision-mode-btn">Нет</button>
            <button data-vision-mode="contrast" class="vision-mode-btn">Контраст</button>
            <button data-vision-mode="bw" class="vision-mode-btn">Ч/Б</button>
            <button data-vision-mode="invert" class="vision-mode-btn">Инверсия</button>
          </div>
        </div>
        <div class="vision-control-group">
          <label>📏 Размер шрифта:</label>
          <div class="vision-buttons">
            <button data-font-size="80" class="vision-size-btn">A-</button>
            <button data-font-size="100" class="vision-size-btn active">A</button>
            <button data-font-size="120" class="vision-size-btn">A+</button>
            <button data-font-size="150" class="vision-size-btn">A++</button>
            <button data-font-size="180" class="vision-size-btn">A+++</button>
          </div>
        </div>
        <div class="vision-control-group">
          <label>📐 Межбуквенный интервал:</label>
          <div class="vision-buttons">
            <button data-letter-spacing="0" class="vision-spacing-btn active">Нет</button>
            <button data-letter-spacing="1" class="vision-spacing-btn">Малый</button>
            <button data-letter-spacing="2" class="vision-spacing-btn">Средний</button>
            <button data-letter-spacing="3" class="vision-spacing-btn">Большой</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(visionPanel);
    
    visionPanel.querySelectorAll("[data-vision-mode]").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-vision-mode");
        const settings = getVisionSettings();
        settings.mode = mode;
        saveVisionSettings(settings);
        applyVisionFilters();
        visionPanel.querySelectorAll("[data-vision-mode]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    
    visionPanel.querySelectorAll("[data-font-size]").forEach(btn => {
      btn.addEventListener("click", () => {
        const size = parseInt(btn.getAttribute("data-font-size"));
        const settings = getVisionSettings();
        settings.fontSize = size;
        saveVisionSettings(settings);
        document.body.style.fontSize = size + "%";
        visionPanel.querySelectorAll("[data-font-size]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    
    visionPanel.querySelectorAll("[data-letter-spacing]").forEach(btn => {
      btn.addEventListener("click", () => {
        const spacing = parseInt(btn.getAttribute("data-letter-spacing"));
        const settings = getVisionSettings();
        settings.letterSpacing = spacing;
        saveVisionSettings(settings);
        document.body.style.letterSpacing = spacing + "px";
        visionPanel.querySelectorAll("[data-letter-spacing]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
    
    document.getElementById("closeVisionPanelBtn").addEventListener("click", () => hideVisionPanel());
    
    const settings = getVisionSettings();
    visionPanel.querySelector(`[data-vision-mode="${settings.mode}"]`)?.classList.add("active");
    visionPanel.querySelector(`[data-font-size="${settings.fontSize}"]`)?.classList.add("active");
    visionPanel.querySelector(`[data-letter-spacing="${settings.letterSpacing}"]`)?.classList.add("active");
  }
  
  function hideVisionPanel() {
    if (visionPanel) {
      visionPanel.remove();
      visionPanel = null;
    }
  }
  
  function initVisionToggle() {
    const settings = getVisionSettings();
    applyVisionMode(settings.enabled);
    
    if (document.getElementById("visionToggleBtn")) return;
    const btn = document.createElement("button");
    btn.id = "visionToggleBtn";
    btn.className = "vision-toggle-btn";
    btn.type = "button";
    btn.innerHTML = "👁️ Режим для слабовидящих";
    btn.addEventListener("click", function () {
      const isOn = document.body.classList.contains("vision-impaired");
      applyVisionMode(!isOn);
    });
    document.body.appendChild(btn);
  }
  
  // ========== РАБОТА С ВЛОЖЕНИЯМИ ==========
  function normalizeAttachment(a) { if (!a) return null; if (typeof a === "string") return { name: a, type: "", isImage: false, dataUrl: "" }; return { name: a.name || "Файл", type: a.type || "", isImage: Boolean(a.isImage), dataUrl: a.dataUrl || "" }; }
  
  function renderAttachmentHtml(att) {
    const a = normalizeAttachment(att); if (!a) return "";
    if (a.isImage && a.dataUrl) return '<div class="mt-1 text-xs opacity-90"><p>Вложение: ' + a.name + '</p><a class="image-open-link" href="' + a.dataUrl + '"><img src="' + a.dataUrl + '" alt="' + a.name + '" class="mt-2 rounded-md border border-slate-200 max-h-40 w-auto object-contain bg-white" /></a><a class="image-open-link text-blue-700 underline" href="' + a.dataUrl + '">Открыть изображение</a></div>';
    if (a.dataUrl) return '<div class="mt-1 text-xs opacity-90"><p>Вложение: ' + a.name + '</p><a class="text-blue-700 underline" href="' + a.dataUrl + '" download="' + a.name + '">Скачать файл</a></div>';
    return '<p class="text-xs opacity-80 mt-1">Вложение: ' + a.name + "</p>";
  }
  
  function toAttachment(file) {
    if (!file) return Promise.resolve(null);
    const base = { name: file.name, type: file.type || "", isImage: Boolean(file.type && file.type.indexOf("image/") === 0), dataUrl: "" };
    return new Promise(function (resolve) { const r = new FileReader(); r.onload = function (e) { const dataUrl = typeof e.target.result === "string" ? e.target.result : ""; if (!dataUrl) return resolve(base); base.dataUrl = dataUrl; resolve(base); }; r.onerror = function () { resolve(base); }; r.readAsDataURL(file); });
  }
  
  // ========== СТРАНИЦЫ ==========
  function initLoginPage() {
    const form = document.getElementById("loginForm"); const errorBox = document.getElementById("errorBox"); if (!form) return;
    getSessionUser().then(function (sess) { if (sess) location.href = sess.role === ROLES.ADMIN ? "admin-dashboard.html" : "user-dashboard.html"; }).catch(function () {});
    form.addEventListener("submit", async function (event) {
      event.preventDefault(); errorBox.classList.add("hidden");
      try {
        const email = document.getElementById("email").value.trim(); const password = document.getElementById("password").value;
        const { data, error } = await sb().auth.signInWithPassword({ email: email, password: password }); ensureNoError(error, "Неверный email или пароль"); if (!data.user) throw new Error("Не удалось авторизоваться");
        const profile = await ensureProfile(data.user, { email: email }); location.href = profile.role === ROLES.ADMIN ? "admin-dashboard.html" : "user-dashboard.html";
      } catch (err) { errorBox.textContent = err.message || "Ошибка входа"; errorBox.classList.remove("hidden"); }
    });
  }
  
  function initRegisterPage() {
    const form = document.getElementById("registerForm"); const errorBox = document.getElementById("errorBox"); if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault(); errorBox.classList.add("hidden");
      const name = document.getElementById("name").value.trim(); const email = document.getElementById("email").value.trim(); const phone = document.getElementById("phone").value.trim();
      const password = document.getElementById("password").value; const passwordConfirm = document.getElementById("passwordConfirm").value; const address = document.getElementById("address").value.trim();
      if (password.length < 6) { errorBox.textContent = "Пароль должен быть не менее 6 символов"; errorBox.classList.remove("hidden"); return; }
      if (password !== passwordConfirm) { errorBox.textContent = "Пароли не совпадают"; errorBox.classList.remove("hidden"); return; }
      try {
        const { data, error } = await sb().auth.signUp({ email: email, password: password, options: { data: { full_name: name } } }); ensureNoError(error, "Не удалось зарегистрировать пользователя");
        if (!data.user) throw new Error("Пользователь не создан");
        await ensureProfile(data.user, { name: name, email: email, phone: phone, address: address, role: ROLES.USER });
        const session = await getSession();
        if (!session) { errorBox.textContent = "Регистрация выполнена. Подтвердите email и войдите."; errorBox.classList.remove("hidden"); form.reset(); return; }
        location.href = "user-dashboard.html";
      } catch (err) { errorBox.textContent = err.message || "Ошибка регистрации"; errorBox.classList.remove("hidden"); }
    });
  }
  
  async function initUserPage() {
    let currentUser = await requireRole(ROLES.USER); if (!currentUser) return;
    document.getElementById("logoutBtn").addEventListener("click", function () { logout().catch(function () {}); });
    document.getElementById("userGreeting").textContent = "Здравствуйте, " + currentUser.name;
    const subjectEl = document.getElementById("ticketSubject"); subjectEl.innerHTML = Object.keys(TOPICS).map(function (k) { return '<option value="' + k + '">' + TOPICS[k] + "</option>"; }).join("");
    let activeTicketId = null; let selectedAttachment = null;
    function open(id) { document.getElementById(id).classList.remove("hidden"); }
    function close(id) { document.getElementById(id).classList.add("hidden"); }
    document.getElementById("openCreateTicketModalBtn").addEventListener("click", function () { open("createTicketModal"); });
    document.getElementById("openProfileModalBtn").addEventListener("click", async function () {
      const p = await getProfile(currentUser.id); const authUser = await getAuthUser();
      if (p && authUser) { const fresh = mapProfile(p, authUser); document.getElementById("profileName").value = fresh.name || ""; document.getElementById("profileEmail").value = fresh.email || ""; document.getElementById("profilePhone").value = fresh.phone || ""; document.getElementById("profileAddress").value = fresh.address || ""; }
      open("profileModal");
    });
    document.getElementById("closeProfileModalBtn").addEventListener("click", function () { close("profileModal"); });
    document.getElementById("closeCreateTicketModalBtn").addEventListener("click", function () { close("createTicketModal"); });
    document.getElementById("closeTicketChatModalBtn").addEventListener("click", function () { close("ticketChatModal"); });
    document.getElementById("attachmentInput").addEventListener("change", function (e) {
      const f = e.target.files[0]; if (!f) { selectedAttachment = null; document.getElementById("attachmentName").textContent = "Файл не выбран"; return; }
      selectedAttachment = { name: f.name, type: f.type || "", isImage: Boolean((f.type || "").indexOf("image/") === 0), dataUrl: "" };
      document.getElementById("attachmentName").textContent = selectedAttachment.isImage ? "Изображение: " + selectedAttachment.name : "Файл: " + selectedAttachment.name;
    });
    async function renderTickets() {
      const own = await fetchUserTickets(currentUser.id); const list = document.getElementById("ticketsList");
      if (!own.length) { list.innerHTML = '<p class="text-gray-500">У вас пока нет обращений.</p>'; return; }
      const firstByTicket = {}; for (let i = 0; i < own.length; i += 1) { const msgs = await fetchMessagesByTicket(own[i].id); firstByTicket[own[i].id] = msgs[0] || null; }
      list.innerHTML = own.map(function (t) { const first = firstByTicket[t.id]; return '<button class="w-full text-left bg-white p-4 rounded-xl shadow hover:shadow-md transition" data-ticket-id="' + t.id + '"><div class="flex items-center justify-between gap-2"><h3 class="font-semibold text-blue-900">' + TOPICS[t.subject] + '</h3><span class="status-pill ' + STATUS_CLASSES[t.status] + '">' + STATUS_LABELS[t.status] + '</span></div><p class="text-sm text-gray-500 mt-1">' + formatDate(t.createdAt) + '</p><p class="text-gray-700 mt-2">' + ((first && first.content) ? first.content.slice(0, 120) : "Без текста") + "</p></button>"; }).join("");
      list.querySelectorAll("[data-ticket-id]").forEach(function (btn) { btn.addEventListener("click", function () { openChat(btn.getAttribute("data-ticket-id")); }); });
    }
    async function openChat(ticketId) {
      activeTicketId = ticketId;
      const tickets = await fetchUserTickets(currentUser.id); const ticket = tickets.find(function (t) { return t.id === ticketId; }); if (!ticket) return;
      const messages = await fetchMessagesByTicket(ticketId);
      document.getElementById("chatTitle").textContent = TOPICS[ticket.subject] + " • " + STATUS_LABELS[ticket.status];
      document.getElementById("chatMessages").innerHTML = messages.map(function (m) { return '<div class="chat-bubble ' + (m.senderRole === ROLES.ADMIN ? "chat-admin" : "chat-user") + '"><p>' + m.content + "</p>" + renderAttachmentHtml(m.attachment) + '<p class="text-[11px] opacity-70 mt-1">' + formatDate(m.createdAt) + "</p></div>"; }).join("");
      open("ticketChatModal");
    }
    document.getElementById("createTicketForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      try {
        const content = document.getElementById("ticketMessage").value.trim(); if (!content) return;
        const subject = document.getElementById("ticketSubject").value; const file = document.getElementById("attachmentInput").files[0] || null; const attachment = file ? await toAttachment(file) : selectedAttachment;
        const { data: t, error: te } = await sb().from("tickets").insert({ user_id: currentUser.id, subject: subject, status: "new" }).select("*").single(); ensureNoError(te, "Не удалось создать обращение");
        const { error: me } = await sb().from("messages").insert({ ticket_id: t.id, sender_id: currentUser.id, sender_role: ROLES.USER, content: content, attachment: attachment || {} }); ensureNoError(me, "Не удалось отправить сообщение");
        e.target.reset(); selectedAttachment = null; document.getElementById("attachmentName").textContent = "Файл не выбран"; close("createTicketModal"); await renderTickets();
      } catch (_error) { alert("Не удалось сохранить обращение."); }
    });
    document.getElementById("sendUserMessageForm").addEventListener("submit", async function (e) {
      e.preventDefault(); if (!activeTicketId) return;
      const input = document.getElementById("userChatInput"); const content = input.value.trim(); if (!content) return;
      const { error } = await sb().from("messages").insert({ ticket_id: activeTicketId, sender_id: currentUser.id, sender_role: ROLES.USER, content: content, attachment: {} }); ensureNoError(error, "Не удалось отправить сообщение");
      input.value = ""; await openChat(activeTicketId); await renderTickets();
    });
    document.getElementById("profileForm").addEventListener("submit", async function (e) {
      e.preventDefault();
      const u = { name: document.getElementById("profileName").value.trim(), email: document.getElementById("profileEmail").value.trim(), phone: document.getElementById("profilePhone").value.trim(), address: document.getElementById("profileAddress").value.trim() };
      try {
        const { error: ae } = await sb().auth.updateUser({ email: u.email, data: { full_name: u.name } }); ensureNoError(ae, "Не удалось обновить email");
        const { data, error } = await sb().from("profiles").update({ name: u.name, email: u.email, phone: u.phone, address: u.address }).eq("id", currentUser.id).select("*").single(); ensureNoError(error, "Не удалось обновить профиль");
        currentUser = mapProfile(data, await getAuthUser()); document.getElementById("userGreeting").textContent = "Здравствуйте, " + currentUser.name; close("profileModal"); alert("Профиль обновлен.");
      } catch (err) { alert(err.message || "Ошибка обновления профиля."); }
    });
    await renderTickets();
  }
  
  async function initAdminPage() {
    const admin = await requireRole(ROLES.ADMIN); if (!admin) return;
    document.getElementById("logoutBtn").addEventListener("click", function () { logout().catch(function () {}); });
    const topicFilter = document.getElementById("topicFilter"); topicFilter.innerHTML = '<option value="all">Все темы</option>' + Object.keys(TOPICS).map(function (k) { return '<option value="' + k + '">' + TOPICS[k] + "</option>"; }).join("");
    let openedTicketId = null; let adminSelectedAttachment = null;
    function open(id) { document.getElementById(id).classList.remove("hidden"); }
    function close(id) { document.getElementById(id).classList.add("hidden"); }
    document.getElementById("closeAdminTicketModalBtn").addEventListener("click", function () { close("adminTicketModal"); });
    document.getElementById("adminAttachmentInput").addEventListener("change", function (e) {
      const f = e.target.files[0]; if (!f) { adminSelectedAttachment = null; document.getElementById("adminAttachmentName").textContent = "Файл не выбран"; return; }
      adminSelectedAttachment = { name: f.name, type: f.type || "", isImage: Boolean((f.type || "").indexOf("image/") === 0), dataUrl: "" };
      document.getElementById("adminAttachmentName").textContent = adminSelectedAttachment.isImage ? "Изображение: " + adminSelectedAttachment.name : "Файл: " + adminSelectedAttachment.name;
    });
    async function getRows() {
      const profilesById = await fetchProfilesMap(); const tickets = await fetchAllTickets(); const rows = [];
      for (let i = 0; i < tickets.length; i += 1) { const messages = await fetchMessagesByTicket(tickets[i].id); rows.push({ ticket: tickets[i], user: profilesById[tickets[i].userId] || null, first: messages[0] || null, messages: messages }); }
      return rows;
    }
    function filterRowsByPeriod(rows, fromValue, toValue) {
      const fromDate = parseDateOnly(fromValue, false); const toDate = parseDateOnly(toValue, true);
      return rows.filter(function (row) { const created = new Date(row.ticket.createdAt); if (fromDate && created < fromDate) return false; if (toDate && created > toDate) return false; return true; });
    }
    function exportPeriodReportCsv(rows, fromValue, toValue) {
      const lines = [["Дата", "ФИО", "Email", "Тема", "Статус", "ID обращения"].map(csvEscape).join(";")];
      rows.forEach(function (row) { lines.push([formatDate(row.ticket.createdAt), row.user ? row.user.name : "-", row.user ? row.user.email : "-", TOPICS[row.ticket.subject] || row.ticket.subject, STATUS_LABELS[row.ticket.status] || row.ticket.status, row.ticket.id].map(csvEscape).join(";")); });
      const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" }); const link = document.createElement("a");
      link.href = URL.createObjectURL(blob); link.download = "otchet_obrasheniya_" + ((fromValue || "start") + "_to_" + (toValue || "end")) + ".csv"; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
    }
    async function renderTable() {
      const status = document.getElementById("statusFilter").value; const topic = document.getElementById("topicFilter").value; const search = document.getElementById("searchFilter").value.trim().toLowerCase();
      const fromValue = document.getElementById("reportDateFrom").value; const toValue = document.getElementById("reportDateTo").value;
      const rows = filterRowsByPeriod(await getRows(), fromValue, toValue).filter(function (r) { const sOk = status === "all" || r.ticket.status === status; const tOk = topic === "all" || r.ticket.subject === topic; const qOk = !search || (r.user && ((r.user.name || "").toLowerCase().includes(search) || (r.user.email || "").toLowerCase().includes(search))); return sOk && tOk && qOk; });
      const tbody = document.getElementById("ticketsTbody");
      if (!rows.length) { tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-gray-500">Ничего не найдено</td></tr>'; return; }
      tbody.innerHTML = rows.map(function (r) { return "<tr class='border-b'><td class='p-3'>" + formatDate(r.ticket.createdAt) + "</td><td class='p-3'>" + (r.user ? r.user.name : "-") + "</td><td class='p-3'>" + (r.user ? r.user.email : "-") + "<tr><td class='p-3'>" + TOPICS[r.ticket.subject] + "</td><td class='p-3'>" + ((r.first && r.first.content) ? r.first.content.slice(0, 70) : "") + "</td><td class='p-3'><span class='status-pill " + STATUS_CLASSES[r.ticket.status] + "'>" + STATUS_LABELS[r.ticket.status] + "</span><td><td class='p-3'><button class='px-3 py-1 bg-blue-700 text-white rounded hover:bg-blue-800' data-open-ticket='" + r.ticket.id + "'>Открыть</button></td></tr>"; }).join("");
      tbody.querySelectorAll("[data-open-ticket]").forEach(function (btn) { btn.addEventListener("click", function () { openTicket(btn.getAttribute("data-open-ticket")); }); });
    }
    async function openTicket(ticketId) {
      const row = (await getRows()).find(function (r) { return r.ticket.id === ticketId; }); if (!row) return; openedTicketId = ticketId;
      document.getElementById("adminTicketMeta").innerHTML = "<p><strong>Автор:</strong> " + (row.user ? row.user.name : "-") + "</p><p><strong>Email:</strong> " + (row.user ? row.user.email : "-") + "</p><p><strong>Телефон:</strong> " + (row.user ? row.user.phone : "-") + "</p><p><strong>Тема:</strong> " + TOPICS[row.ticket.subject] + "</p><p><strong>Создано:</strong> " + formatDate(row.ticket.createdAt) + "</p>";
      document.getElementById("adminChatHistory").innerHTML = row.messages.map(function (m) { return '<div class="chat-bubble ' + (m.senderRole === ROLES.ADMIN ? "chat-admin" : "chat-user") + '"><p>' + m.content + "</p>" + renderAttachmentHtml(m.attachment) + "<p class='text-[11px] opacity-70 mt-1'>" + formatDate(m.createdAt) + "</p></div>"; }).join("");
      const st = document.getElementById("adminStatusSelect"); st.innerHTML = '<option value="new">Новое</option><option value="in_progress">В работе</option><option value="closed">Завершено</option>'; st.value = row.ticket.status; open("adminTicketModal");
    }
    document.getElementById("downloadPeriodReportBtn").addEventListener("click", async function () { const fromValue = document.getElementById("reportDateFrom").value; const toValue = document.getElementById("reportDateTo").value; const rows = filterRowsByPeriod(await getRows(), fromValue, toValue); if (!rows.length) return alert("За выбранный период обращений не найдено."); exportPeriodReportCsv(rows, fromValue, toValue); });
    document.getElementById("downloadTicketPdfBtn").addEventListener("click", async function () {
      if (!openedTicketId) return; if (!window.pdfMake) return alert("Библиотека PDF не загружена.");
      const row = (await getRows()).find(function (r) { return r.ticket.id === openedTicketId; }); if (!row) return;
      const content = [{ text: "ЛДПР - Выгрузка переписки по обращению", style: "header" }, { text: "Дата выгрузки: " + formatDate(nowIso()), margin: [0, 0, 0, 4] }, { text: "ФИО: " + (row.user ? row.user.name : "-"), margin: [0, 0, 0, 2] }, { text: "Email: " + (row.user ? row.user.email : "-"), margin: [0, 0, 0, 2] }, { text: "Телефон: " + (row.user ? row.user.phone : "-"), margin: [0, 0, 0, 2] }, { text: "Тема: " + TOPICS[row.ticket.subject], margin: [0, 0, 0, 2] }, { text: "Статус: " + STATUS_LABELS[row.ticket.status], margin: [0, 0, 0, 10] }];
      row.messages.forEach(function (m) { content.push({ text: (m.senderRole === ROLES.ADMIN ? "Администратор" : "Пользователь") + " (" + formatDate(m.createdAt) + ")", bold: true }); content.push({ text: m.content || "", margin: [0, 0, 0, 4] }); });
      window.pdfMake.createPdf({ pageSize: "A4", pageMargins: [40, 40, 40, 40], content: content, defaultStyle: { font: "Roboto", fontSize: 11, color: "#111827" }, styles: { header: { fontSize: 16, bold: true, margin: [0, 0, 0, 10] } } }).download("obrashenie_" + row.ticket.id + ".pdf");
    });
    document.getElementById("adminReplyForm").addEventListener("submit", async function (e) {
      e.preventDefault(); if (!openedTicketId) return;
      const content = document.getElementById("adminReplyInput").value.trim(); if (!content) return;
      try {
        const file = document.getElementById("adminAttachmentInput").files[0] || null; const attachment = file ? await toAttachment(file) : adminSelectedAttachment;
        const { error: me } = await sb().from("messages").insert({ ticket_id: openedTicketId, sender_id: admin.id, sender_role: ROLES.ADMIN, content: content, attachment: attachment || {} }); ensureNoError(me, "Не удалось отправить ответ");
        const { error: te } = await sb().from("tickets").update({ status: document.getElementById("adminStatusSelect").value }).eq("id", openedTicketId); ensureNoError(te, "Не удалось обновить статус");
        document.getElementById("adminReplyInput").value = ""; document.getElementById("adminReplyForm").reset(); adminSelectedAttachment = null; document.getElementById("adminAttachmentName").textContent = "Файл не выбран"; await renderTable(); await openTicket(openedTicketId);
      } catch (_error) { alert("Не удалось отправить ответ администратора."); }
    });
    document.getElementById("statusFilter").addEventListener("change", function () { renderTable().catch(function () {}); });
    document.getElementById("topicFilter").addEventListener("change", function () { renderTable().catch(function () {}); });
    document.getElementById("searchFilter").addEventListener("input", function () { renderTable().catch(function () {}); });
    document.getElementById("reportDateFrom").addEventListener("change", function () { renderTable().catch(function () {}); });
    document.getElementById("reportDateTo").addEventListener("change", function () { renderTable().catch(function () {}); });
    await renderTable();
  }
  
  function initInlineImageViewer() {
    if (!document.getElementById("imagePreviewModal")) {
      var modal = document.createElement("div"); modal.id = "imagePreviewModal"; modal.className = "fixed inset-0 bg-black/80 hidden items-center justify-center p-4 z-[100]";
      modal.innerHTML = '<div class="relative max-w-5xl w-full flex items-center justify-center"><button id="imagePreviewCloseBtn" class="absolute top-2 right-2 bg-white text-slate-900 rounded px-3 py-1 font-semibold">Закрыть</button><img id="imagePreviewImg" src="" alt="preview" class="max-h-[90vh] w-auto object-contain rounded" /></div>'; document.body.appendChild(modal);
    }
    var modalEl = document.getElementById("imagePreviewModal"); var imgEl = document.getElementById("imagePreviewImg"); var closeBtn = document.getElementById("imagePreviewCloseBtn");
    if (!modalEl || !imgEl || !closeBtn) return;
    function closeViewer() { modalEl.classList.add("hidden"); modalEl.classList.remove("flex"); imgEl.src = ""; }
    closeBtn.addEventListener("click", closeViewer); modalEl.addEventListener("click", function (e) { if (e.target === modalEl) closeViewer(); }); document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeViewer(); });
    document.addEventListener("click", function (e) { var link = e.target.closest("a.image-open-link"); if (!link) return; e.preventDefault(); var src = link.getAttribute("href"); if (!src) return; imgEl.src = src; modalEl.classList.remove("hidden"); modalEl.classList.add("flex"); });
  }
  
  document.addEventListener("DOMContentLoaded", function () {
    initThemeToggle();
    initVisionToggle();
    initInlineImageViewer();
    const page = document.body.getAttribute("data-page");
    if (page === "login") initLoginPage();
    if (page === "register") initRegisterPage();
    if (page === "user") initUserPage().catch(function () { alert("Ошибка загрузки кабинета пользователя."); location.href = "index.html"; });
    if (page === "admin") initAdminPage().catch(function () { alert("Ошибка загрузки панели администратора."); location.href = "index.html"; });
  });
})();
