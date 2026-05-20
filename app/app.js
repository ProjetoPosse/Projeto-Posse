const body = document.body;
const page = body.dataset.page || "";
const methodSlug = body.dataset.method || "";
document.querySelectorAll(".nav-link[data-page]").forEach((link) => {
  if (link.dataset.page === page) link.classList.add("is-active");
});

const requiredRole = body.dataset.role || "";
const appContent = document.getElementById("appContent");
const logoutButton = document.getElementById("logoutButton");

function initMobileNav() {
  const sidebar = document.querySelector(".app-sidebar");
  const topbar = document.querySelector(".app-topbar");
  if (!sidebar || !topbar || topbar.querySelector(".mobile-nav-toggle")) return;

  const navId = sidebar.id || "appSidebar";
  sidebar.id = navId;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "button button-secondary mobile-nav-toggle";
  toggle.setAttribute("aria-controls", navId);

  const overlay = document.createElement("div");
  overlay.className = "app-nav-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const setNavOpen = (isOpen) => {
    sidebar.classList.toggle("is-open", isOpen);
    overlay.classList.toggle("is-open", isOpen);
    body.classList.toggle("nav-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "Fechar navegação" : "Abrir navegação");
    toggle.textContent = isOpen ? "✕" : "☰";
  };

  setNavOpen(false);

  toggle.addEventListener("click", () => {
    setNavOpen(!sidebar.classList.contains("is-open"));
  });

  overlay.addEventListener("click", () => setNavOpen(false));
  sidebar.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setNavOpen(false);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1100) setNavOpen(false);
  });

  topbar.prepend(toggle);
  body.append(overlay);
}
const dayLabels = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];
const monthFmt = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const state = { user: null, profile: null };
const config = window.PROJETO_POSSE_CONFIG || {};
const DEMO_SESSION_KEY = "projeto_posse_demo_session";
const DEMO_DATA_KEY = "projeto_posse_demo_data";
const DEMO_DATA_VERSION = 3;
const urlParams = new URLSearchParams(window.location.search);
const demoRequestedByUrl = urlParams.get("demo") === "1";
let supabaseModulePromise = null;
let supabaseModuleCache = null;

const esc = (v) => String(v ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const fmtDate = (v) => (!v ? "--" : new Date(`${v}T00:00:00`).toLocaleDateString("pt-BR"));
const fmtMonth = (v) => (!v ? "Mes nao informado" : monthFmt.format(new Date(`${v}T00:00:00`)));
const fmtPlanReference = (v) => (!v ? "Data de inicio nao informada" : `Início ${fmtDate(v)}`);
const fmtPct = (a, b) => (!b ? "0%" : `${Math.round((Number(a || 0) / Number(b || 0)) * 100)}%`);
const fmtHours = (v) => `${Number(v || 0).toFixed(1)}h`;
const badgeClass = (status) => {
  if (status === "concluido" || status === "ativo") return "green";
  if (status === "arquivado") return "red";
  return "blue";
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoOffsetDay = (offset) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};
const monthStartIso = () => {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
};
const fmtDateTime = (v) => (!v ? "--" : new Date(v).toLocaleString("pt-BR"));

function sumBy(rows, field) {
  return (rows || []).reduce((sum, row) => sum + Number(row?.[field] || 0), 0);
}

function isWithinDays(value, days) {
  if (!value) return false;
  const target = new Date(`${value}T00:00:00`);
  const today = new Date(`${isoToday()}T00:00:00`);
  const diffDays = Math.floor((today - target) / 86400000);
  return diffDays >= 0 && diffDays < days;
}

function chunkArray(items, size = 100) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function updatePlanItemRows(client, ids, payload) {
  for (const chunk of chunkArray(ids)) {
    const { error } = await client.from("plano_itens").update(payload).in("id", chunk);
    if (error) throw error;
  }
}

function uniqueByDate(rows, dateField = "referencia") {
  return new Set((rows || []).map((row) => row?.[dateField]).filter(Boolean)).size;
}

function shortDateLabel(value) {
  if (!value) return "--";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}` : String(value);
}

function dateSortValue(value) {
  if (!value) return 0;
  const normalized = String(value).length <= 10 ? `${value}T00:00:00` : String(value);
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLatestEntry(rows, dateField) {
  return (rows || [])
    .filter((row) => row?.[dateField])
    .slice()
    .sort((a, b) => dateSortValue(b?.[dateField]) - dateSortValue(a?.[dateField]))[0] || null;
}

function mentorRhythm(item) {
  if (item.diasComRegistro >= 5 || item.metas7d >= 4 || item.horas7d >= 20) return { label: "Ritmo forte", tone: "green" };
  if (item.diasComRegistro >= 2 || item.questoes7d >= 80 || item.metas7d >= 1) return { label: "Em movimento", tone: "blue" };
  if (item.lastCheckinAt) return { label: "Sem registro recente", tone: "red" };
  return { label: "Sem dados", tone: "red" };
}

function describePlanProgress(plan) {
  if (!plan) return "Nenhum plano de estudos cadastrado ainda.";
  if (!plan.items.length) return `${plan.titulo} sem metas cadastradas.`;
  return `${plan.titulo}: ${plan.completed}/${plan.items.length} metas concluidas (${plan.progress}%).`;
}

function describeLatestSimulado(simulado) {
  if (!simulado) return "Nenhum simulado registrado ainda.";
  const total = Number(simulado.total_questoes || 0);
  const acertos = Number(simulado.acertos || 0);
  const when = simulado.data_aplicacao ? fmtDate(simulado.data_aplicacao) : "data nao informada";
  return `${simulado.titulo} em ${when}: ${acertos}/${total} (${fmtPct(acertos, total)}).`;
}

function buildMentorKpis(data, mentorados, plans, concursosMap = new Map()) {
  const items = data.monthlyItems || [];
  const checkins = data.dailyCheckins || [];
  const simulados = data.simulados || [];
  return (mentorados || []).map((mentorado) => {
    const ownCheckins = checkins.filter((item) => item.mentorado_id === mentorado.id);
    const recent = ownCheckins.filter((item) => isWithinDays(item.referencia, 7));
    const recentItems = items.filter((item) => item.mentorado_id === mentorado.id && item.concluida_em && isWithinDays(item.concluida_em.slice(0, 10), 7));
    const ownPlans = (plans || []).filter((plan) => plan.mentorado_id === mentorado.id);
    const activePlan = ownPlans.find((plan) => plan.status === "ativo") || ownPlans[0] || null;
    const latestCheckin = getLatestEntry(ownCheckins, "referencia");
    const latestSimulado = getLatestEntry(simulados.filter((item) => item.mentorado_id === mentorado.id), "data_aplicacao");
    const recentSeries = buildRecentCheckinSeries(ownCheckins, 7);
    return {
      id: mentorado.id,
      nome: mentorado.nome || mentorado.email || "Mentorado",
      concurso: mentorado.concurso_id || null,
      concursoNome: concursosMap.get(mentorado.concurso_id)?.nome || "Sem vinculo",
      questoes7d: sumBy(recent, "questoes_feitas"),
      acertos7d: sumBy(recent, "questoes_certas"),
      horas7d: sumBy(recent, "horas_estudo"),
      pomodoros7d: sumBy(recent, "pomodoros"),
      metas7d: recentItems.length,
      diasComRegistro: uniqueByDate(recent),
      latestCheckin,
      lastCheckinAt: latestCheckin?.referencia || null,
      lastObservation: latestCheckin?.observacao || "",
      activePlan,
      latestSimulado,
      recentSeries,
      rhythm: null
    };
  }).map((item) => ({
    ...item,
    rhythm: mentorRhythm(item)
  })).sort((a, b) => {
    const recentDiff = (b.diasComRegistro || 0) - (a.diasComRegistro || 0);
    if (recentDiff !== 0) return recentDiff;
    return dateSortValue(b.lastCheckinAt) - dateSortValue(a.lastCheckinAt);
  });
}

function renderMentorEvolutionCards(mentorKpis) {
  return mentorKpis.map((item) => `
    <div class="list-item">
      <div class="card-head">
        <div>
          <strong>${esc(item.nome)}</strong>
          <span>${esc(item.concursoNome)}</span>
        </div>
        <div class="badge-row">
          <span class="badge ${item.rhythm.tone}">${esc(item.rhythm.label)}</span>
          <span class="badge gold">${esc(item.lastCheckinAt ? `Ultimo check-in ${fmtDate(item.lastCheckinAt)}` : "Sem check-in")}</span>
        </div>
      </div>
      <span>${esc(`${item.questoes7d} questoes, ${fmtPct(item.acertos7d, item.questoes7d)} de acerto, ${fmtHours(item.horas7d)} e ${item.metas7d} metas nos ultimos 7 dias.`)}</span>
      <span>${esc(describePlanProgress(item.activePlan))}</span>
      <span>${esc(describeLatestSimulado(item.latestSimulado))}</span>
      <div class="badge-row" style="margin-top:.8rem;">
        <span class="badge blue">${esc(`${item.diasComRegistro} dias com registro`)}</span>
        <span class="badge blue">${esc(`${item.pomodoros7d} pomodoros 7d`)}</span>
      </div>
    </div>
  `).join("") || `<div class="empty-state">Os resumos vao aparecer quando os alunos comecarem a preencher o registro diario.</div>`;
}

function buildMentorDashboardSnapshot(data, mentorKpis) {
  const allCheckins = data.dailyCheckins || [];
  const recentCheckins = allCheckins.filter((item) => isWithinDays(item.referencia, 7));
  const allSnapshot = buildEvolutionSnapshot(allCheckins);
  const recentSnapshot = buildEvolutionSnapshot(recentCheckins);
  return {
    ...allSnapshot,
    recentSnapshot,
    mentoradosAtivos: (mentorKpis || []).filter((item) => item.diasComRegistro > 0).length,
    checkinsRecentes: recentCheckins.length,
    metasRecentes: (mentorKpis || []).reduce((sum, item) => sum + Number(item.metas7d || 0), 0),
    trendSeries: buildRecentCheckinSeries(allCheckins, 14)
  };
}

function renderMentorPulseCards(mentorKpis) {
  return (mentorKpis || []).map((item) => {
    const simuladoPct = item.latestSimulado ? fmtPct(item.latestSimulado.acertos, item.latestSimulado.total_questoes) : "--";
    const planProgress = item.activePlan ? `${item.activePlan.progress}%` : "--";
    return `
      <article class="mentor-pulse-card">
        <div class="card-head">
          <div>
            <strong>${esc(item.nome)}</strong>
            <span>${esc(item.concursoNome)}</span>
          </div>
          <span class="badge ${item.rhythm.tone}">${esc(item.rhythm.label)}</span>
        </div>
        <div class="mentor-pulse-chart">${renderMiniActivityChart(item.recentSeries)}</div>
        <div class="mentor-pulse-metrics">
          <span><strong>${esc(fmtHours(item.horas7d))}</strong><small>Horas 7d</small></span>
          <span><strong>${esc(String(item.questoes7d))}</strong><small>Questoes 7d</small></span>
          <span><strong>${esc(planProgress)}</strong><small>Plano</small></span>
          <span><strong>${esc(simuladoPct)}</strong><small>Ultimo simulado</small></span>
        </div>
        <p class="mentor-note">${esc(item.lastObservation ? truncateText(item.lastObservation, 150) : "Sem observacao recente do mentorado.")}</p>
        <div class="badge-row" style="margin-top:.8rem;">
          <span class="badge gold">${esc(item.lastCheckinAt ? `Ultimo check-in ${fmtDate(item.lastCheckinAt)}` : "Sem check-in")}</span>
          <span class="badge blue">${esc(`${item.diasComRegistro} dias ativos`)}</span>
          <span class="badge blue">${esc(`${item.metas7d} metas 7d`)}</span>
        </div>
      </article>
    `;
  }).join("") || `<div class="empty-state">Os cards vao aparecer quando houver mentorados com atividade registrada.</div>`;
}

function buildObservationRows(checkins, mentorados, concursosMap = new Map()) {
  const mentoradosMap = new Map((mentorados || []).map((item) => [item.id, item]));
  return (checkins || [])
    .filter((item) => String(item?.observacao || "").trim())
    .map((item) => {
      const mentorado = mentoradosMap.get(item.mentorado_id) || {};
      return {
        ...item,
        mentoradoNome: mentorado.nome || mentorado.email || "Mentorado",
        concursoNome: concursosMap.get(mentorado.concurso_id)?.nome || "Sem vinculo"
      };
    })
    .sort((a, b) => dateSortValue(b.referencia) - dateSortValue(a.referencia));
}

function buildLatestObservationByMentorado(observationRows) {
  const latestByMentorado = new Map();
  (observationRows || []).forEach((item) => {
    if (!latestByMentorado.has(item.mentorado_id)) latestByMentorado.set(item.mentorado_id, item);
  });
  return Array.from(latestByMentorado.values());
}

function buildRecentCheckinSeries(checkins, days = 14) {
  const byDate = new Map();
  (checkins || []).forEach((item) => {
    if (!item?.referencia) return;
    const current = byDate.get(item.referencia) || {
      referencia: item.referencia,
      questoes_feitas: 0,
      questoes_certas: 0,
      horas_estudo: 0,
      metas_cumpridas: 0
    };
    current.questoes_feitas += Number(item?.questoes_feitas || 0);
    current.questoes_certas += Number(item?.questoes_certas || 0);
    current.horas_estudo += Number(item?.horas_estudo || 0);
    current.metas_cumpridas += Number(item?.metas_cumpridas || 0);
    byDate.set(item.referencia, current);
  });

  const today = new Date(`${isoToday()}T00:00:00`);
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const cursor = new Date(today);
    cursor.setDate(today.getDate() - offset);
    const referencia = cursor.toISOString().slice(0, 10);
    const source = byDate.get(referencia);
    series.push({
      referencia,
      label: shortDateLabel(referencia),
      questoes: Number(source?.questoes_feitas || 0),
      acertos: Number(source?.questoes_certas || 0),
      horas: Number(source?.horas_estudo || 0),
      metas: Number(source?.metas_cumpridas || 0)
    });
  }
  return series;
}

function truncateText(value, maxLength = 120) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function buildEvolutionSnapshot(checkins) {
  const totalQuestoes = sumBy(checkins, "questoes_feitas");
  const totalAcertos = sumBy(checkins, "questoes_certas");
  const totalErros = Math.max(0, totalQuestoes - totalAcertos);
  const totalHoras = sumBy(checkins, "horas_estudo");
  const totalPomodoros = sumBy(checkins, "pomodoros");
  const diasAtivos = uniqueByDate((checkins || []).filter((item) => Number(item?.horas_estudo || 0) > 0 || Number(item?.questoes_feitas || 0) > 0 || Number(item?.metas_cumpridas || 0) > 0));
  const aproveitamento = totalQuestoes ? Math.round((totalAcertos / totalQuestoes) * 100) : 0;
  const recentSeries = buildRecentCheckinSeries(checkins, 14);
  const bestDay = recentSeries.reduce((best, item) => (item.questoes > (best?.questoes || 0) ? item : best), null);
  return {
    totalQuestoes,
    totalAcertos,
    totalErros,
    totalHoras,
    totalPomodoros,
    diasAtivos,
    aproveitamento,
    recentSeries,
    bestDay: bestDay?.questoes ? bestDay : null
  };
}

function calcStreak(checkins) {
  const activeDates = new Set(
    (checkins || [])
      .filter((c) => Number(c.horas_estudo || 0) > 0 || Number(c.questoes_feitas || 0) > 0 || Number(c.metas_cumpridas || 0) > 0)
      .map((c) => c.referencia)
      .filter(Boolean)
  );
  if (!activeDates.size) return { current: 0, best: 0 };

  // Sequência atual (de hoje ou ontem para trás)
  let current = 0;
  const cursor = new Date(`${isoToday()}T00:00:00`);
  if (!activeDates.has(isoToday())) cursor.setDate(cursor.getDate() - 1);
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Melhor sequência histórica
  const sorted = [...activeDates].sort();
  let best = 0;
  let temp = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round((new Date(sorted[i] + "T00:00:00") - new Date(sorted[i - 1] + "T00:00:00")) / 86400000);
    temp = diff === 1 ? temp + 1 : 1;
    best = Math.max(best, temp);
  }
  best = Math.max(best, current, sorted.length > 0 ? 1 : 0);
  return { current, best };
}

function initPomodoroTimer(initialSessions = 0) {
  const display    = document.getElementById("pomodoroDisplay");
  const startBtn   = document.getElementById("pomodoroStart");
  const resetBtn   = document.getElementById("pomodoroReset");
  const skipBtn    = document.getElementById("pomodoroSkip");
  const modeLabel  = document.getElementById("pomodoroMode");
  const sessionCount = document.getElementById("pomodoroSessionCount");
  const cycleEl    = document.getElementById("pomodoroCycle");
  const statusEl   = document.getElementById("pomodoroStatus");
  const dots       = document.querySelectorAll(".pomo-dot");
  if (!display || !startBtn) return;

  const FOCUS      = 25 * 60;
  const BREAK      = 5 * 60;
  const LONG_BREAK = 15 * 60;
  const LS_KEY     = "pomo_sessions_today";
  const LS_DATE    = "pomo_sessions_date";

  // Persist sessions across refreshes (reset at midnight)
  function loadSessions() {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(LS_DATE) === today) {
        return parseInt(localStorage.getItem(LS_KEY) || "0", 10);
      }
    } catch (_) {}
    return initialSessions;
  }
  function saveSessions(n) {
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(LS_KEY, String(n));
      localStorage.setItem(LS_DATE, today);
    } catch (_) {}
  }

  let sessions  = loadSessions();
  let mode      = "focus";
  let remaining = FOCUS;
  let interval  = null;
  let running   = false;
  const originalTitle = document.title;

  function fmt(s) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  // ── Audio: pleasant 3-note bell chord ──────────────────────────────
  function playBell(type) {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const now  = ctx.currentTime;
      // notes: focus-end = ascending major chord (C5 E5 G5), break-end = descending (G4 E4)
      const notes = type === "focus"
        ? [523.25, 659.25, 783.99]   // C5 E5 G5
        : type === "long"
        ? [523.25, 659.25, 783.99, 1046.5]  // C5 E5 G5 C6
        : [659.25, 523.25];          // E5 C5
      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        const t0 = now + i * 0.18;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.22, t0 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);
        osc.start(t0);
        osc.stop(t0 + 1.2);
      });
    } catch (_) { /* sem suporte a audio */ }
  }

  // ── Tick sound (optional subtle click) ─────────────────────────────
  function playTick() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const buf  = ctx.createBuffer(1, 512, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < 512; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / 512) * 0.15;
      const src  = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch (_) {}
  }

  // ── UI Update ───────────────────────────────────────────────────────
  function updateDots() {
    const filled = sessions % 4;
    dots.forEach((d, i) => d.classList.toggle("is-filled", i < filled));
  }

  const STATUS = {
    focus:      "🎯 Foco em andamento — sem distrações!",
    break:      "☕ Pausa curta — respire, mova o corpo.",
    long_break: "🌿 Pausa longa — você merece descansar!",
    idle:       "Pronto para começar",
    paused:     "⏸ Pausado",
    done_focus: "✅ Sessão concluída! Hora de descansar.",
    done_break: "🔔 Pausa encerrada! Bora focar.",
  };

  function cycleLabel() {
    const inCycle = (sessions % 4) + (mode === "focus" ? 1 : 0);
    return `Sessão ${Math.min(inCycle, 4)} de 4`;
  }

  function updateUI() {
    const timeStr = fmt(remaining);
    display.textContent = timeStr;
    sessionCount.textContent = String(sessions);
    saveSessions(sessions);

    const isLong = sessions > 0 && sessions % 4 === 0 && mode === "break";
    if (mode === "focus") {
      modeLabel.textContent = "Foco 25min";
      modeLabel.className = "badge blue";
      display.className = "pomodoro-display" + (running ? " is-running" : "");
    } else if (isLong) {
      modeLabel.textContent = "Pausa longa 15min";
      modeLabel.className = "badge green";
      display.className = "pomodoro-display is-break";
    } else {
      modeLabel.textContent = "Pausa 5min";
      modeLabel.className = "badge green";
      display.className = "pomodoro-display is-break";
    }

    if (cycleEl) cycleEl.textContent = cycleLabel();
    if (running) document.title = `${timeStr} ${mode === "focus" ? "🎯" : "☕"} Pomodoro`;
    else document.title = originalTitle;

    updateDots();
  }

  function complete() {
    clearInterval(interval);
    running = false;
    startBtn.textContent = "▶ Iniciar";
    display.classList.remove("is-running");

    if (mode === "focus") {
      sessions++;
      saveSessions(sessions);
      const isLong = sessions % 4 === 0;
      playBell(isLong ? "long" : "focus");
      if (statusEl) statusEl.textContent = STATUS.done_focus;
      mode = "break";
      remaining = isLong ? LONG_BREAK : BREAK;
    } else {
      playBell("break");
      if (statusEl) statusEl.textContent = STATUS.done_break;
      mode = "focus";
      remaining = FOCUS;
    }
    document.title = originalTitle;
    updateUI();
  }

  startBtn.addEventListener("click", () => {
    if (running) {
      clearInterval(interval);
      running = false;
      startBtn.textContent = "▶ Iniciar";
      display.classList.remove("is-running");
      if (statusEl) statusEl.textContent = STATUS.paused;
      document.title = originalTitle;
    } else {
      interval = setInterval(() => {
        if (--remaining <= 0) complete();
        else {
          if (remaining === 60) playTick();  // aviso de 1 min restante
          updateUI();
        }
      }, 1000);
      running = true;
      startBtn.textContent = "⏸ Pausar";
      const isLong = sessions > 0 && sessions % 4 === 0 && mode === "break";
      if (statusEl) statusEl.textContent = isLong ? STATUS.long_break : STATUS[mode];
    }
    updateUI();
  });

  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      clearInterval(interval);
      running = false;
      startBtn.textContent = "▶ Iniciar";
      if (mode === "focus") {
        sessions++;
        saveSessions(sessions);
        mode = "break";
        remaining = sessions % 4 === 0 ? LONG_BREAK : BREAK;
      } else {
        mode = "focus";
        remaining = FOCUS;
      }
      if (statusEl) statusEl.textContent = STATUS.idle;
      document.title = originalTitle;
      updateUI();
    });
  }

  resetBtn.addEventListener("click", () => {
    clearInterval(interval);
    running = false;
    mode = "focus";
    remaining = FOCUS;
    startBtn.textContent = "▶ Iniciar";
    display.classList.remove("is-running");
    if (statusEl) statusEl.textContent = STATUS.idle;
    document.title = originalTitle;
    updateUI();
  });

  // cleanup on page navigation
  window.addEventListener("beforeunload", () => { document.title = originalTitle; });

  updateUI();
  if (statusEl) statusEl.textContent = STATUS.idle;
}

function renderAccuracyDonut(snapshot) {
  const percent = Math.max(0, Math.min(100, Number(snapshot?.aproveitamento || 0)));
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - (percent / 100));

  return `
    <svg class="donut-chart" viewBox="0 0 160 160" role="img" aria-label="Grafico de aproveitamento geral">
      <circle class="donut-track" cx="80" cy="80" r="${radius}"></circle>
      <circle class="donut-progress" cx="80" cy="80" r="${radius}" style="stroke-dasharray:${circumference};stroke-dashoffset:${offset};"></circle>
      <text x="80" y="76" text-anchor="middle" class="donut-value">${esc(String(percent))}%</text>
      <text x="80" y="98" text-anchor="middle" class="donut-label">aproveitamento</text>
    </svg>
  `;
}

function renderRecentPerformanceChart(series) {
  const safeSeries = series || [];
  const hasData = safeSeries.some((item) => item.questoes > 0 || item.acertos > 0);
  if (!hasData) {
    return `<div class="empty-state">O grafico vai aparecer assim que houver registros diarios de estudo.</div>`;
  }

  const width = 560;
  const height = 230;
  const padding = { top: 18, right: 10, bottom: 36, left: 38 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(10, ...safeSeries.map((item) => Math.max(item.questoes, item.acertos)));
  const groupWidth = innerWidth / safeSeries.length;
  const barWidth = Math.max(5, Math.min(10, (groupWidth - 6) / 2));
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];

  const grid = gridSteps.map((step) => {
    const y = padding.top + innerHeight - (innerHeight * step);
    const label = Math.round(maxValue * step);
    return `
      <g>
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid-line"></line>
        <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${esc(String(label))}</text>
      </g>
    `;
  }).join("");

  const bars = safeSeries.map((item, index) => {
    const baseX = padding.left + (index * groupWidth) + ((groupWidth - ((barWidth * 2) + 3)) / 2);
    const questoesHeight = innerHeight * (item.questoes / maxValue);
    const acertosHeight = innerHeight * (item.acertos / maxValue);
    const xQuestions = baseX;
    const xHits = baseX + barWidth + 3;
    const yQuestions = padding.top + innerHeight - questoesHeight;
    const yHits = padding.top + innerHeight - acertosHeight;
    const labelX = padding.left + (index * groupWidth) + (groupWidth / 2);
    const showLabel = index % 2 === 0 || index === safeSeries.length - 1;

    return `
      <g>
        <rect x="${xQuestions}" y="${yQuestions}" width="${barWidth}" height="${questoesHeight}" rx="3" class="chart-bar chart-bar-questions"></rect>
        <rect x="${xHits}" y="${yHits}" width="${barWidth}" height="${acertosHeight}" rx="3" class="chart-bar chart-bar-hits"></rect>
        ${showLabel ? `<text x="${labelX}" y="${height - 10}" text-anchor="middle" class="chart-axis-label">${esc(item.label)}</text>` : ""}
      </g>
    `;
  }).join("");

  return `
    <svg class="performance-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico de questoes e acertos dos ultimos 14 dias">
      ${grid}
      ${bars}
    </svg>
  `;
}

function renderMiniActivityChart(series) {
  const safeSeries = (series || []).slice(-7);
  const hasData = safeSeries.some((item) => item.questoes > 0);
  if (!hasData) {
    return `<div class="mentor-mini-empty">Sem registros recentes</div>`;
  }

  const width = 220;
  const height = 72;
  const padding = { top: 6, right: 6, bottom: 14, left: 6 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(10, ...safeSeries.map((item) => item.questoes));
  const groupWidth = innerWidth / safeSeries.length;
  const barWidth = Math.max(8, Math.min(18, groupWidth - 6));

  const bars = safeSeries.map((item, index) => {
    const x = padding.left + (index * groupWidth) + ((groupWidth - barWidth) / 2);
    const barHeight = innerHeight * (item.questoes / maxValue);
    const y = padding.top + innerHeight - barHeight;
    const labelX = padding.left + (index * groupWidth) + (groupWidth / 2);
    return `
      <g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" class="mini-chart-bar"></rect>
        <text x="${labelX}" y="${height - 2}" text-anchor="middle" class="mini-chart-label">${esc(item.label)}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="mini-activity-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico rapido de questoes dos ultimos 7 dias">
      ${bars}
    </svg>
  `;
}

function setMessage(node, text, type = "") {
  if (!node) return;
  node.textContent = text;
  node.className = type ? `message ${type}` : "message";
}

function setProfileUi(profile) {
  document.querySelectorAll("[data-profile-name]").forEach((node) => {
    node.textContent = profile?.nome || "Usuário";
  });
  document.querySelectorAll("[data-profile-role]").forEach((node) => {
    node.textContent = profile?.role === "mentor" ? "Mentor" : "Mentorado";
  });
}

function syncAdminHashNav() {
  if (page !== "admin") return;
  const hash = window.location.hash || "#sec-mentorados";
  document.querySelectorAll(".app-sidebar .nav-link[href^='#']").forEach((node) => {
    node.classList.toggle("is-active", node.getAttribute("href") === hash);
  });
}

function showLoading(text = "Carregando...") {
  if (!appContent) return;
  appContent.innerHTML = `<section class="card"><div class="empty-state">${esc(text)}</div></section>`;
}

function showError(error) {
  if (!appContent) return;
  appContent.innerHTML = `<section class="card"><div class="message error">${esc(error?.message || "Nao foi possivel carregar esta area.")}</div></section>`;
}

async function loadSupabaseModule() {
  if (supabaseModuleCache) return supabaseModuleCache;
  if (!supabaseModulePromise) {
    supabaseModulePromise = import("./supabase.js").then((mod) => {
      supabaseModuleCache = mod;
      return mod;
    });
  }
  return supabaseModulePromise;
}

function isDemoMode() {
  return config.demoMode === true || demoRequestedByUrl || Boolean(localStorage.getItem(DEMO_SESSION_KEY));
}

function getDemoLoginUrl() {
  return "./login.html?demo=1";
}

function getDefaultDemoData() {
  const mentorId = "demo-mentor";
  const mentorado1Id = "demo-mentorado-1";
  const mentorado2Id = "demo-mentorado-2";
  const concurso1Id = "demo-concurso-1";
  const concurso2Id = "demo-concurso-2";
  const planoAbrilAmandaId = "demo-plano-amanda-abril";
  const planoMaioAmandaId = "demo-plano-amanda-maio";
  const planoJunhoAmandaId = "demo-plano-amanda-junho";
  const planoJulhoAmandaId = "demo-plano-amanda-julho";
  const planoLucasId = "demo-plano-lucas";
  const trf3PdfUrl = "../assets/plans/plano-trf3-v3.pdf";
  const tecUrl = "https://www.tecconcursos.com.br/";

  const amandaPlans = [
    {
      id: planoAbrilAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Plano Abril 2026 - TRF-3 V3",
      descricao: "Semanas 1 a 4 do plano oficial: nivelamento em Tributario e entrada forte em Previdenciario.",
      mes_referencia: "2026-04-01",
      status: "ativo",
      pdf_url: trf3PdfUrl,
      pdf_path: null
    },
    {
      id: planoMaioAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Plano Maio 2026 - TRF-3 V3",
      descricao: "Semanas 5 a 9: consolidacao de Previdenciario, Administracao e inicio da fase de topicos TRF-3.",
      mes_referencia: "2026-05-01",
      status: "ativo",
      pdf_url: trf3PdfUrl,
      pdf_path: null
    },
    {
      id: planoJunhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Plano Junho 2026 - TRF-3 V3",
      descricao: "Semanas 10 a 13: legislacao dos tribunais, revisoes D+14, simulados completos e discursivas.",
      mes_referencia: "2026-06-01",
      status: "ativo",
      pdf_url: trf3PdfUrl,
      pdf_path: null
    },
    {
      id: planoJulhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Plano Julho 2026 - TRF-3 V3",
      descricao: "Semanas 14 a 16: sprint final, ajustes dinamicos, simulados e revisao de topicos certeza.",
      mes_referencia: "2026-07-01",
      status: "ativo",
      pdf_url: trf3PdfUrl,
      pdf_path: null
    }
  ];

  const amandaItems = [
    {
      id: "demo-item-trf3-01",
      plano_id: planoAbrilAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 1 - Tributario A00-A02 + RLM diagnostico",
      descricao: "Nivelamento entre 30/03 e 04/04 com especies de tributo, principios e associacao de informacoes.",
      tipo: "teoria",
      data_prevista: "2026-03-30",
      dia_semana: null,
      ordem: 1,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: true,
      concluida_em: "2026-03-30T20:30:00"
    },
    {
      id: "demo-item-trf3-02",
      plano_id: planoAbrilAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 2 - Competencia, obrigacoes e responsabilidade tributaria",
      descricao: "Sem foco entre 06/04 e 11/04 em A03-A06 de Tributario e entrada em Seguridade Social.",
      tipo: "teoria",
      data_prevista: "2026-04-06",
      dia_semana: null,
      ordem: 2,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-03",
      plano_id: planoAbrilAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 3 - Credito, suspensao e segurados do RGPS",
      descricao: "Cobrir A07-A09 de Tributario, suspensao do credito e segurados obrigatorios e facultativos do RGPS.",
      tipo: "questoes",
      data_prevista: "2026-04-13",
      dia_semana: null,
      ordem: 3,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-04",
      plano_id: planoAbrilAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 4 - Exclusao, administracao tributaria e custeio",
      descricao: "Concluir A10-A12 de Tributario e abrir A03-A05 de Previdenciario com foco em custeio.",
      tipo: "teoria",
      data_prevista: "2026-04-20",
      dia_semana: null,
      ordem: 4,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-05",
      plano_id: planoAbrilAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Encerramento de abril - checklist de fixacao",
      descricao: "Fechar abril com 80 a 120 questoes por bloco, revisao D+7 e conferencia do mapa mental tributario.",
      tipo: "revisao",
      data_prevista: "2026-04-26",
      dia_semana: null,
      ordem: 5,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-06",
      plano_id: planoMaioAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 5 - Arrecadacao, beneficios e Prescricao/Decadencia",
      descricao: "Trabalhar A06-A08 de Previdenciario e aprofundar Civil em Prescricao e Decadencia.",
      tipo: "teoria",
      data_prevista: "2026-04-27",
      dia_semana: null,
      ordem: 1,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-07",
      plano_id: planoMaioAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 6 - Regras de transicao RGPS + Responsabilidade Civil + art. 5",
      descricao: "Cruzar EC 103/2019, responsabilidade civil e garantias constitucionais centrais para FCC.",
      tipo: "teoria",
      data_prevista: "2026-05-04",
      dia_semana: null,
      ordem: 2,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-08",
      plano_id: planoMaioAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 7 - Administracao Geral/Publica + RPPS",
      descricao: "Semana dedicada a PODC, administracao gerencial e RPPS com art. 40 da CF.",
      tipo: "teoria",
      data_prevista: "2026-05-11",
      dia_semana: null,
      ordem: 3,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-09",
      plano_id: planoMaioAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 8 - Previdencia complementar, impostos e Reforma Tributaria",
      descricao: "A14-A15 de Previdenciario com CTC e LC 109/2001, alem de A13-A17 de Tributario.",
      tipo: "teoria",
      data_prevista: "2026-05-18",
      dia_semana: null,
      ordem: 4,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-10",
      plano_id: planoMaioAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 9 - Penal federal + Inquerito Policial",
      descricao: "Abrir fase 3 com prescricao penal, concurso de pessoas e inquerito policial.",
      tipo: "questoes",
      data_prevista: "2026-05-25",
      dia_semana: null,
      ordem: 5,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-11",
      plano_id: planoJunhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 10 - LOMAN, CNJ 75/2009 e Lei 13.146/2015",
      descricao: "Topicos estrategicos TRF-3: magistratura, codigo de etica e pessoas com deficiencia.",
      tipo: "teoria",
      data_prevista: "2026-06-01",
      dia_semana: null,
      ordem: 1,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-12",
      plano_id: planoJunhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 11 - Revisao geral D+14 da fase 1 e 2",
      descricao: "Rodada pesada de 120 questoes por dia com foco em Tributario, Previdenciario, Administrativo e Processo.",
      tipo: "revisao",
      data_prevista: "2026-06-08",
      dia_semana: null,
      ordem: 2,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-13",
      plano_id: planoJunhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 12 - Reforco de pontos fracos + Discursiva 1",
      descricao: "Ajustar materias de menor rendimento e produzir discursiva FCC em Responsabilidade Civil.",
      tipo: "redacao",
      data_prevista: "2026-06-15",
      dia_semana: null,
      ordem: 3,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-14",
      plano_id: planoJunhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 13 - Simulados intensivos e ajuste dinamico",
      descricao: "Analise de desempenho, reforco duplo nas duas materias mais fracas e rotacao completa com cronometro.",
      tipo: "simulado",
      data_prevista: "2026-06-22",
      dia_semana: null,
      ordem: 4,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-15",
      plano_id: planoJulhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 14 - Dobrar as 2 materias mais fracas",
      descricao: "Ajuste dinamico com simulados, discursiva e reforco em Processo, Administrativo e topicos TRF-3.",
      tipo: "questoes",
      data_prevista: "2026-06-29",
      dia_semana: null,
      ordem: 1,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-16",
      plano_id: planoJulhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 15 - Sprint final FCC 2024 + discursiva cronometrada",
      descricao: "Blocos de 20 questoes em Tributario, Previdenciario, Portugues, Civil, Constitucional e RLM.",
      tipo: "questoes",
      data_prevista: "2026-07-06",
      dia_semana: null,
      ordem: 2,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-17",
      plano_id: planoJulhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Simulado 6 - prova completa cronometrada",
      descricao: "Aplicar simulado final de 4h30 e revisar ultimas duvidas antes da semana 16.",
      tipo: "simulado",
      data_prevista: "2026-07-11",
      dia_semana: null,
      ordem: 3,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-18",
      plano_id: planoJulhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Semana 16 - Topicos certeza + mapas mentais",
      descricao: "Revisao final de extincao e suspensao do credito, seguridade, RLM, TRFs, LOMAN e CNJ.",
      tipo: "revisao",
      data_prevista: "2026-07-13",
      dia_semana: null,
      ordem: 4,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-19",
      plano_id: planoJulhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Descanso estrategico de sexta",
      descricao: "Sexta da semana 16 reservada para descanso total, conforme o PDF do plano.",
      tipo: "revisao",
      data_prevista: "2026-07-17",
      dia_semana: null,
      ordem: 5,
      tec_url: null,
      material_url: trf3PdfUrl,
      concluida: false
    },
    {
      id: "demo-item-trf3-20",
      plano_id: planoJulhoAmandaId,
      mentorado_id: mentorado1Id,
      titulo: "Ensaio geral final",
      descricao: "Ultima leitura dos mapas mentais e mini simulado misto antes da reta final.",
      tipo: "simulado",
      data_prevista: "2026-07-18",
      dia_semana: null,
      ordem: 6,
      tec_url: tecUrl,
      material_url: trf3PdfUrl,
      concluida: false
    }
  ];

  return {
    concursos: [
      { id: concurso1Id, nome: "TRF 3 - Analista", cargo: "Analista Judiciario", orgao: "TRF 3", status: "ativo", created_at: `${isoToday()}T09:00:00` },
      { id: concurso2Id, nome: "TCE MS - Auditor", cargo: "Auditor", orgao: "TCE MS", status: "ativo", created_at: `${isoToday()}T09:30:00` }
    ],
    mentorados: [
      { id: mentorado1Id, nome: "Amanda Duarte", email: "aluno@demo.local", role: "mentorado", ativo: true, concurso_id: concurso1Id, created_at: `${isoToday()}T10:00:00` },
      { id: mentorado2Id, nome: "Lucas Duarte", email: "aluno2@demo.local", role: "mentorado", ativo: true, concurso_id: concurso2Id, created_at: `${isoToday()}T10:05:00` }
    ],
    materiais: [
      { id: "demo-material-1", titulo: "Plano de Estudos TRF-3 V3", descricao: "PDF completo implantado para Amanda na area do aluno teste.", tipo: "pdf", visibilidade: "aluno", concurso_id: null, mentorado_id: mentorado1Id, externo_url: trf3PdfUrl, file_path: null, created_at: `${isoToday()}T11:00:00` },
      { id: "demo-material-2", titulo: "Bloco TEC TRF-3", descricao: "Caderno de questoes para executar os blocos do plano.", tipo: "questoes", visibilidade: "aluno", concurso_id: null, mentorado_id: mentorado1Id, externo_url: tecUrl, file_path: null, created_at: `${isoToday()}T11:20:00` },
      { id: "demo-material-3", titulo: "PDF Constitucional", descricao: "Leitura base da semana para o concurso do Lucas.", tipo: "pdf", visibilidade: "concurso", concurso_id: concurso2Id, mentorado_id: null, externo_url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", file_path: null, created_at: `${isoToday()}T11:40:00` }
    ],
    monthlyPlans: [
      ...amandaPlans,
      { id: planoLucasId, mentorado_id: mentorado2Id, titulo: "Plano Mensal Lucas", descricao: "Plano de retomada com foco em teoria.", mes_referencia: monthStartIso(), status: "rascunho", pdf_url: null, pdf_path: null }
    ],
    monthlyItems: [
      ...amandaItems,
      { id: "demo-item-lucas-1", plano_id: planoLucasId, mentorado_id: mentorado2Id, titulo: "Controle Externo - teoria", descricao: "Ler aula base do modulo 1.", tipo: "teoria", data_prevista: isoOffsetDay(2), dia_semana: null, ordem: 1, tec_url: null, material_url: null, concluida: false }
    ],
    planosLegacy: [
      { id: "demo-legacy-1", mentorado_id: mentorado1Id, titulo: "Rotina semanal de revisao", descricao: "Segunda e quinta com revisao curta.", dia_semana: 1, ordem: 1, status: "em_andamento" }
    ],
    simulados: [
      { id: "demo-simulado-1", mentorado_id: mentorado1Id, concurso_id: concurso1Id, titulo: "Simulado 1 - Diagnostico TRF-3", data_aplicacao: "2026-05-23", acertos: 41, total_questoes: 62, observacoes: "Base para ajustar Penal, Processo Penal e RLM no meio do ciclo.", pdf_url: null, pdf_path: null },
      { id: "demo-simulado-3", mentorado_id: mentorado1Id, concurso_id: concurso1Id, titulo: "Simulado 3 - Consolidacao", data_aplicacao: "2026-06-20", acertos: 46, total_questoes: 62, observacoes: "Evolucao consistente em Tributario e Previdenciario; ainda reforcar topicos TRF-3.", pdf_url: null, pdf_path: null },
      { id: "demo-simulado-2", mentorado_id: mentorado2Id, concurso_id: concurso2Id, titulo: "Simulado Auditor", data_aplicacao: isoOffsetDay(-5), acertos: 28, total_questoes: 50, observacoes: "Precisa reforcar Controle Externo.", pdf_url: null, pdf_path: null }
    ],
    weekly: [
      { id: "demo-week-1", mentorado_id: mentorado1Id, referencia: "2026-04-04", horas: 16.5, questoes: 420, acertos: 287 },
      { id: "demo-week-2", mentorado_id: mentorado1Id, referencia: "2026-05-02", horas: 18.0, questoes: 460, acertos: 318 },
      { id: "demo-week-3", mentorado_id: mentorado1Id, referencia: "2026-06-06", horas: 20.0, questoes: 520, acertos: 379 },
      { id: "demo-week-4", mentorado_id: mentorado1Id, referencia: "2026-07-11", horas: 14.0, questoes: 360, acertos: 271 }
    ],
    pomodoro: [
      { id: "demo-pomo-1", mentorado_id: mentorado1Id, referencia: "2026-04-04", sessoes: 22, minutos: 550 },
      { id: "demo-pomo-2", mentorado_id: mentorado1Id, referencia: "2026-05-16", sessoes: 24, minutos: 600 },
      { id: "demo-pomo-3", mentorado_id: mentorado1Id, referencia: "2026-06-28", sessoes: 26, minutos: 650 }
    ],
    dailyCheckins: [
      { id: "demo-checkin-1", mentorado_id: mentorado1Id, referencia: "2026-06-28", horas_estudo: 4.5, questoes_feitas: 120, questoes_certas: 87, pomodoros: 10, metas_cumpridas: 2, observacao: "Bom rendimento em Tributario, revisar Previdenciario." },
      { id: "demo-checkin-2", mentorado_id: mentorado1Id, referencia: isoOffsetDay(-1), horas_estudo: 3.5, questoes_feitas: 90, questoes_certas: 63, pomodoros: 8, metas_cumpridas: 1, observacao: "Dia mais curto, mas mantive o bloco de questoes." },
      { id: "demo-checkin-3", mentorado_id: mentorado2Id, referencia: isoOffsetDay(-2), horas_estudo: 2.0, questoes_feitas: 40, questoes_certas: 22, pomodoros: 4, metas_cumpridas: 0, observacao: "Preciso retomar ritmo em Controle Externo." }
    ],
    profiles: {
      mentor: { id: mentorId, nome: "Mentor Projeto Posse", email: "mentor@demo.local", role: "mentor", ativo: true, concurso_id: null, concursos: null },
      mentorado: { id: mentorado1Id, nome: "Amanda Duarte", email: "aluno@demo.local", role: "mentorado", ativo: true, concurso_id: concurso1Id, concursos: { id: concurso1Id, nome: "TRF 3 - Analista" } }
    }
  };
}

function ensureDemoData() {
  const existing = localStorage.getItem(DEMO_DATA_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      const valid =
        parsed &&
        parsed.version === DEMO_DATA_VERSION &&
        Array.isArray(parsed.concursos) &&
        Array.isArray(parsed.mentorados) &&
        Array.isArray(parsed.materiais) &&
        Array.isArray(parsed.monthlyPlans) &&
        Array.isArray(parsed.monthlyItems) &&
        Array.isArray(parsed.simulados) &&
        Array.isArray(parsed.weekly) &&
        Array.isArray(parsed.pomodoro) &&
        parsed.monthlyPlans.some((item) => item.id === "demo-plano-amanda-abril") &&
        parsed.profiles &&
        parsed.profiles.mentor &&
        parsed.profiles.mentorado;

      if (valid) return parsed;
    } catch (error) {
      // Rebuild demo data below if localStorage is malformed.
    }
  }

  const initial = getDefaultDemoData();
  initial.version = DEMO_DATA_VERSION;
  localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(initial));
  return initial;
}

function loadDemoData() {
  return ensureDemoData();
}

function saveDemoData(data) {
  localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(data));
}

function getDemoSession() {
  const raw = localStorage.getItem(DEMO_SESSION_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setDemoSession(role) {
  const session = {
    role,
    userId: role === "mentor" ? "demo-mentor" : "demo-mentorado-1"
  };
  localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
  ensureDemoData();
}

function clearDemoSession() {
  localStorage.removeItem(DEMO_SESSION_KEY);
}

function getDemoProfile() {
  const session = getDemoSession();
  if (!session) return null;
  const data = loadDemoData();
  if (session.role === "mentor") return deepClone(data.profiles.mentor);
  return deepClone(data.profiles.mentorado);
}

async function signedMaterialUrl(path) {
  if (!path) return null;
  const { ensureSupabase } = await loadSupabaseModule();
  const client = ensureSupabase();
  const { data, error } = await client.storage.from("materiais").createSignedUrl(path, 3600);
  return error ? null : data?.signedUrl || null;
}

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

async function signedPlanPdfUrl(plan) {
  if (plan?.pdf_url) return plan.pdf_url;
  if (!plan?.pdf_path) return null;
  const { ensureSupabase } = await loadSupabaseModule();
  const client = ensureSupabase();
  const { data, error } = await client.storage.from("materiais").createSignedUrl(plan.pdf_path, 3600);
  return error ? null : data?.signedUrl || null;
}

async function hydrateMaterialRows(rows) {
  return Promise.all((rows || []).map(async (row) => ({
    ...row,
    resolved_url: row.externo_url || await signedMaterialUrl(row.file_path)
  })));
}

async function hydrateMonthlyPlans(rows) {
  return Promise.all((rows || []).map(async (row) => ({
    ...row,
    resolved_pdf_url: await signedPlanPdfUrl(row)
  })));
}

async function signedSimuladoPdfUrl(simulado) {
  if (simulado?.pdf_url) return simulado.pdf_url;
  if (!simulado?.pdf_path) return null;
  return signedMaterialUrl(simulado.pdf_path);
}

async function hydrateSimulados(rows) {
  return Promise.all((rows || []).map(async (row) => ({
    ...row,
    resolved_pdf_url: await signedSimuladoPdfUrl(row)
  })));
}

async function hydratePlanItems(rows) {
  return Promise.all((rows || []).map(async (row) => ({
    ...row,
    resolved_material_url: row.material_url
      ? (isAbsoluteUrl(row.material_url) ? row.material_url : await signedMaterialUrl(row.material_url))
      : null
  })));
}

function buildPlans(plans, items) {
  const byPlan = new Map();

  (items || []).forEach((item) => {
    if (!byPlan.has(item.plano_id)) byPlan.set(item.plano_id, []);
    byPlan.get(item.plano_id).push(item);
  });

  return (plans || [])
    .map((plan) => {
      const ownItems = (byPlan.get(plan.id) || [])
        .slice()
        .sort((a, b) => {
          const dateDiff = new Date(a.data_prevista || "9999-12-31") - new Date(b.data_prevista || "9999-12-31");
          if (dateDiff !== 0) return dateDiff;
          return Number(a.ordem || 0) - Number(b.ordem || 0);
        });
      const completed = ownItems.filter((item) => item.concluida).length;
      return {
        ...plan,
        items: ownItems,
        completed,
        progress: ownItems.length ? Math.round((completed / ownItems.length) * 100) : 0
      };
    })
    .sort((a, b) => new Date(b.mes_referencia) - new Date(a.mes_referencia));
}

function groupMonthlyItems(items) {
  const groups = new Map();

  (items || []).forEach((item) => {
    const hasDay = item.dia_semana !== null && item.dia_semana !== undefined && item.dia_semana !== "";
    const key = item.data_prevista
      ? fmtDate(item.data_prevista)
      : (hasDay ? dayLabels[Number(item.dia_semana)] : "Sem data");

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  return groups;
}

function dayIndexFromIso(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
}

function normalizeImportDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;

  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!br) return null;

  const day = br[1].padStart(2, "0");
  const month = br[2].padStart(2, "0");
  const year = br[3].length === 2 ? `20${br[3]}` : br[3];
  return `${year}-${month}-${day}`;
}

function splitImportLine(line) {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  if (line.includes("|")) return line.split("|");
  return [line];
}

function normalizePlanItemType(value) {
  return String(value || "meta")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "meta";
}

function parsePlanItemsImport(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const parts = splitImportLine(line).map((part) => part.trim());
      const firstDate = normalizeImportDate(parts[0]);
      const secondDate = normalizeImportDate(parts[1]);
      let data_prevista = firstDate;
      let ordem = Number(parts[1]);
      let tipo = parts[2];
      let titulo = parts[3];
      let descricao = parts[4];
      let tec_url = parts[5];
      let material_url = parts[6];

      if (!firstDate && secondDate) {
        ordem = Number(parts[0]);
        data_prevista = secondDate;
        tipo = parts[2];
        titulo = parts[3];
        descricao = parts[4];
        tec_url = parts[5];
        material_url = parts[6];
      }

      if (!firstDate && !secondDate) {
        ordem = Number(parts[0]);
        tipo = Number.isFinite(ordem) ? parts[1] : parts[0];
        titulo = Number.isFinite(ordem) ? parts[2] : parts[1];
        descricao = Number.isFinite(ordem) ? parts.slice(3).join(" - ") : parts.slice(2).join(" - ");
      }

      const fallbackTitle = firstDate || secondDate ? parts.filter(Boolean).slice(2).join(" - ") : line;
      const cleanedTitle = (titulo || fallbackTitle || `Meta ${index + 1}`).trim();

      return {
        titulo: cleanedTitle,
        descricao: descricao || null,
        tipo: normalizePlanItemType(tipo),
        data_prevista,
        dia_semana: data_prevista ? dayIndexFromIso(data_prevista) : null,
        ordem: Number.isFinite(ordem) && ordem > 0 ? ordem : index + 1,
        tec_url: isAbsoluteUrl(tec_url) ? tec_url : null,
        material_url: material_url || null
      };
    })
    .filter((item) => item.titulo);
}

function planItemStatus(item) {
  const today = isoToday();
  if (item.concluida) return { label: "Concluída", tone: "green" };
  if (item.data_prevista && item.data_prevista < today) return { label: "Em atraso", tone: "red" };
  if (item.data_prevista === today) return { label: "Hoje", tone: "gold" };
  return { label: "Pendente", tone: "blue" };
}

function buildPlanInsights(plan) {
  const items = plan?.items || [];
  const today = isoToday();
  const pending = items.filter((item) => !item.concluida);
  const byType = new Map();

  items.forEach((item) => {
    const key = item.tipo || "meta";
    const current = byType.get(key) || { tipo: key, total: 0, done: 0 };
    current.total += 1;
    if (item.concluida) current.done += 1;
    byType.set(key, current);
  });

  const overdue = pending.filter((item) => item.data_prevista && item.data_prevista < today);
  const todayItems = pending.filter((item) => item.data_prevista === today);
  const upcoming = pending
    .filter((item) => !item.data_prevista || item.data_prevista >= today)
    .slice()
    .sort((a, b) => {
      const dateDiff = dateSortValue(a.data_prevista) - dateSortValue(b.data_prevista);
      if (dateDiff !== 0) return dateDiff;
      return Number(a.ordem || 0) - Number(b.ordem || 0);
    });

  return {
    total: items.length,
    done: items.filter((item) => item.concluida).length,
    pending: pending.length,
    overdue,
    todayItems,
    upcoming,
    byType: Array.from(byType.values()).sort((a, b) => b.total - a.total)
  };
}

function renderPlanOverview(plan) {
  const insight = buildPlanInsights(plan);
  const stats = [
    { label: "Concluídas", value: `${insight.done}/${insight.total || 0}`, tone: "gold" },
    { label: "Pendentes", value: String(insight.pending), tone: "blue" },
    { label: "Hoje", value: String(insight.todayItems.length), tone: "green" },
    { label: "Em atraso", value: String(insight.overdue.length), tone: insight.overdue.length ? "red" : "blue" }
  ];

  return `<div class="plan-overview-grid">${stats.map((item) => `<div class="plan-mini-stat"><strong class="is-${esc(item.tone)}">${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join("")}</div>${renderPlanTypeProgress(insight)}`;
}

function renderPlanTypeProgress(insight) {
  if (!insight.byType.length) return "";
  return `<div class="plan-type-progress" aria-label="Progresso por tipo de meta">${insight.byType.map((item) => {
    const pct = item.total ? Math.round((item.done / item.total) * 100) : 0;
    return `<div class="plan-type-row"><div><strong>${esc(item.tipo)}</strong><span>${esc(`${item.done}/${item.total}`)}</span></div><div class="metric-bar"><span style="width:${esc(String(pct))}%"></span></div></div>`;
  }).join("")}</div>`;
}

function renderPlanFocusQueue(plan) {
  const insight = buildPlanInsights(plan);
  const blocks = [
    { title: "Em atraso", items: insight.overdue.slice(0, 4), empty: "Nenhuma meta atrasada." },
    { title: "Hoje", items: insight.todayItems.slice(0, 4), empty: "Nada previsto para hoje." },
    { title: "Próximas metas", items: insight.upcoming.slice(0, 4), empty: "Sem metas pendentes." }
  ];

  return `<div class="plan-focus-grid">${blocks.map((block) => `<div class="plan-focus-panel"><strong>${esc(block.title)}</strong>${block.items.length ? `<ul>${block.items.map((item) => `<li><span>${esc(item.data_prevista ? shortDateLabel(item.data_prevista) : "Sem data")}</span>${esc(item.titulo)}</li>`).join("")}</ul>` : `<p>${esc(block.empty)}</p>`}</div>`).join("")}</div>`;
}

function buildPlanDaySummary(rows) {
  const total = rows?.length || 0;
  const done = (rows || []).filter((item) => item.concluida).length;
  return {
    total,
    done,
    pending: Math.max(total - done, 0),
    progress: total ? Math.round((done / total) * 100) : 0
  };
}

function renderPlanDayGroup(label, rows) {
  const summary = buildPlanDaySummary(rows);
  const dateValue = rows.find((item) => item.data_prevista)?.data_prevista || "";
  return `<div class="plan-group" data-plan-day-group="${esc(dateValue || label)}"><div class="plan-day-head"><div><h3 class="day-title">${esc(label)}</h3><span>${esc(`${summary.done}/${summary.total} metas concluídas`)}</span></div><div class="plan-day-actions"><div class="plan-day-progress" aria-label="Progresso do dia"><span style="width:${esc(String(summary.progress))}%"></span></div><button class="button button-secondary" type="button" data-plan-day-complete="${esc(dateValue)}" ${!dateValue || summary.pending === 0 ? "disabled" : ""}>Concluir dia</button></div></div><div class="list">${rows.map(renderPlanTaskCard).join("")}</div></div>`;
}

function renderPlanTaskCard(item) {
  const status = planItemStatus(item);
  return `<article class="plan-task ${item.concluida ? "done" : ""}"><div class="plan-item"><input class="checkbox" type="checkbox" data-plan-item-toggle="${esc(item.id)}" aria-label="Marcar meta ${esc(item.titulo)} como concluída" ${item.concluida ? "checked" : ""}><div class="plan-task-main"><div class="badge-row"><span class="badge gold">${esc(item.tipo || "meta")}</span><span class="badge ${status.tone}">${esc(status.label)}</span>${item.data_prevista ? `<span class="badge blue">${esc(shortDateLabel(item.data_prevista))}</span>` : ""}</div><strong class="plan-item-title" style="margin-top:.7rem;">${esc(item.titulo)}</strong><p class="plan-item-copy">${esc(item.descricao || "Sem descricao adicional.")}</p><div class="inline-actions">${item.tec_url ? `<a class="button button-secondary" href="${esc(item.tec_url)}" target="_blank" rel="noopener noreferrer">Abrir TEC</a>` : ""}${item.resolved_material_url ? `<a class="button button-secondary" href="${esc(item.resolved_material_url)}" target="_blank" rel="noopener noreferrer">${item.tipo === "meta_plano" ? "Abrir meta do plano" : "Material complementar"}</a>` : item.material_url ? `<span class="message error">Material privado nao resolvido.</span>` : ""}</div></div></div></article>`;
}

function renderAdminPlanMonitor(plans, mentoradosMap) {
  if (!plans.length) return `<section class="card" style="margin-top:1rem;"><div class="empty-state">Crie um plano para acompanhar metas por aluno.</div></section>`;

  return `<section class="card plan-admin-monitor" style="margin-top:1rem;"><div class="card-head"><div><h2 class="card-title">Acompanhamento interativo dos planos</h2><p class="page-copy">Selecione um plano para ver metas concluídas, pendentes, atrasadas e evolução por tipo.</p></div><span class="badge gold">${esc(String(plans.length))} planos</span></div><label class="plan-monitor-select"><span class="field-label">Plano acompanhado</span><select class="select" id="planDetailSelect">${plans.map((plan, index) => `<option value="${esc(plan.id)}" ${index === 0 ? "selected" : ""}>${esc(optionLabel(plan, mentoradosMap))}</option>`).join("")}</select></label><div class="plan-detail-panels">${plans.map((plan, index) => renderAdminPlanDetailPanel(plan, mentoradosMap, index === 0)).join("")}</div></section>`;
}

function renderAdminPlanDetailPanel(plan, mentoradosMap, isActive) {
  const insight = buildPlanInsights(plan);
  const rows = (plan.items || []).map((item) => {
    const status = planItemStatus(item);
    return `<tr data-admin-plan-item-id="${esc(item.id)}" data-admin-plan-item-date="${esc(item.data_prevista || "")}" data-admin-plan-item-done="${esc(String(Boolean(item.concluida)))}"><td>${esc(item.data_prevista ? fmtDate(item.data_prevista) : "--")}</td><td><strong>${esc(item.titulo)}</strong><span class="table-subcopy">${esc(item.descricao || "")}</span></td><td>${esc(item.tipo || "meta")}</td><td><span class="badge ${status.tone}">${esc(status.label)}</span></td><td>${esc(item.concluida_em ? fmtDateTime(item.concluida_em) : "--")}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="empty-state">Nenhuma meta cadastrada neste plano.</td></tr>`;

  return `<div class="plan-detail-panel ${isActive ? "is-active" : ""}" data-plan-detail-panel="${esc(plan.id)}"><div class="plan-detail-head"><div><strong>${esc(plan.titulo)}</strong><span>${esc(`${mentoradosMap.get(plan.mentorado_id)?.nome || "Aluno"} · ${fmtPlanReference(plan.mes_referencia)}`)}</span></div><div class="plan-progress-row"><div class="metric-bar"><span style="width:${esc(String(plan.progress))}%"></span></div><span class="plan-progress-pct">${esc(String(plan.progress))}%</span></div></div>${renderPlanOverview(plan)}${renderPlanFocusQueue(plan)}${plan.items?.length ? `<form class="plan-bulk-actions" data-admin-plan-complete-until><label><span class="field-label">Marcar feitas até</span><input class="input" name="until_date" type="date"></label><button class="button button-secondary" type="submit">Concluir até a data</button><div class="message" data-admin-plan-bulk-message></div></form>` : ""}<div class="table-wrap plan-detail-table"><table class="table"><thead><tr><th>Data</th><th>Meta</th><th>Tipo</th><th>Status</th><th>Concluída em</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function wireAdminPlanDetailSelect() {
  const select = document.getElementById("planDetailSelect");
  if (!select) return;

  const sync = () => {
    appContent.querySelectorAll("[data-plan-detail-panel]").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.planDetailPanel === select.value);
    });
  };

  select.addEventListener("change", sync);
  sync();
}


async function fetchMentoradoData() {
  if (isDemoMode()) {
    const profile = getDemoProfile();
    const data = loadDemoData();
    const materiais = data.materiais.filter((item) =>
      (item.visibilidade === "aluno" && item.mentorado_id === profile.id) ||
      (item.visibilidade === "concurso" && item.concurso_id === profile.concurso_id)
    ).map((item) => ({
      ...item,
      resolved_url: item.externo_url || item.file_path || null
    }));

    const monthlyPlans = data.monthlyPlans
      .filter((item) => item.mentorado_id === profile.id)
      .map((item) => ({
        ...item,
        resolved_pdf_url: item.pdf_url || item.pdf_path || null
      }));

    return {
      materiais,
      planosLegacy: data.planosLegacy.filter((item) => item.mentorado_id === profile.id),
      monthlyCollection: buildPlans(
        monthlyPlans,
        data.monthlyItems
          .filter((item) => item.mentorado_id === profile.id)
          .map((item) => ({
            ...item,
            resolved_material_url: item.material_url || null
          }))
      ),
      simulados: data.simulados.filter((item) => item.mentorado_id === profile.id),
      dailyCheckins: (data.dailyCheckins || data.weekly.map((item) => ({
        id: `derived-${item.id}`,
        mentorado_id: item.mentorado_id,
        referencia: item.referencia,
        horas_estudo: item.horas || 0,
        questoes_feitas: item.questoes || 0,
        questoes_certas: item.acertos || 0,
        pomodoros: (data.pomodoro.find((row) => row.mentorado_id === item.mentorado_id && row.referencia === item.referencia)?.sessoes) || 0,
        metas_cumpridas: 0,
        observacao: ""
      }))).filter((item) => item.mentorado_id === profile.id),
      weekly: data.weekly.filter((item) => item.mentorado_id === profile.id),
      pomodoro: data.pomodoro.filter((item) => item.mentorado_id === profile.id)
    };
  }

  const { ensureSupabase } = await loadSupabaseModule();
  const client = ensureSupabase();
  const [
    materialsRes,
    monthlyRes,
    itemsRes,
    legacyRes,
    simuladosRes,
    weeklyRes,
    pomodoroRes,
    dailyCheckinsRes
  ] = await Promise.all([
    client.from("materiais").select("id,titulo,descricao,tipo,visibilidade,externo_url,file_path,created_at").order("created_at", { ascending: false }),
    client.from("planos_mensais").select("id,mentorado_id,titulo,descricao,mes_referencia,status,pdf_url,pdf_path").order("mes_referencia", { ascending: false }),
    client.from("plano_itens").select("id,plano_id,mentorado_id,titulo,descricao,tipo,data_prevista,dia_semana,ordem,tec_url,material_url,concluida,concluida_em").order("data_prevista", { ascending: true, nullsFirst: false }).order("ordem", { ascending: true }),
    client.from("planos_estudo").select("id,titulo,descricao,dia_semana,ordem,status").order("dia_semana", { ascending: true }).order("ordem", { ascending: true }),
    client.from("simulados").select("id,titulo,data_aplicacao,acertos,total_questoes,observacoes,pdf_url,pdf_path").order("data_aplicacao", { ascending: false }),
    client.from("weekly_logs").select("id,referencia,horas,questoes,acertos").order("referencia", { ascending: false }).limit(60),
    client.from("pomodoro_logs").select("id,referencia,sessoes,minutos").order("referencia", { ascending: false }).limit(60),
    client.from("daily_checkins").select("id,referencia,horas_estudo,questoes_feitas,questoes_certas,pomodoros,metas_cumpridas,observacao").order("referencia", { ascending: false }).limit(60)
  ]);

  const error =
    materialsRes.error ||
    monthlyRes.error ||
    itemsRes.error ||
    legacyRes.error ||
    simuladosRes.error ||
    weeklyRes.error ||
    pomodoroRes.error ||
    dailyCheckinsRes.error;

  if (error) throw error;

  const monthlyPlans = await hydrateMonthlyPlans(monthlyRes.data || []);
  const monthlyItems = await hydratePlanItems(itemsRes.data || []);

  return {
    materiais: await hydrateMaterialRows(materialsRes.data || []),
    planosLegacy: legacyRes.data || [],
    monthlyCollection: buildPlans(monthlyPlans, monthlyItems),
    simulados: await hydrateSimulados(simuladosRes.data || []),
    dailyCheckins: dailyCheckinsRes.data || [],
    weekly: weeklyRes.data || [],
    pomodoro: pomodoroRes.data || []
  };
}

const STUDY_METHODS = [
  {
    slug: "onenote",
    file: "./metodos-de-estudo-onenote.html",
    prettyPath: "/area-do-aluno/metodos-de-estudo/onenote",
    icon: "ON",
    tone: "gold",
    shortTitle: "OneNote",
    title: "OneNote: como organizar seu estudo de forma inteligente",
    subtitle: "Aprenda a usar o OneNote para centralizar teoria, revisões, prints de questões, observações e materiais em um único sistema.",
    summary: "Organização inteligente do estudo",
    objective: [
      "entender para que serve o OneNote;",
      "montar uma estrutura simples e funcional;",
      "organizar disciplinas e assuntos;",
      "integrar teoria, revisão, questões e erros em um só lugar."
    ],
    intro: [
      "O OneNote funciona como um centro de organização do estudo. Ele não substitui o plano, as questões ou a revisão, mas ajuda o aluno a manter tudo encontrável e conectado.",
      "A ideia é criar um sistema leve, em que cada anotação tenha função: revisar melhor, registrar uma dúvida, organizar um erro ou guardar um exemplo importante."
    ],
    what: "É um caderno digital dividido em camadas. Você pode criar cadernos, seções, páginas e subpáginas para organizar a preparação sem depender de dezenas de arquivos soltos.",
    purpose: [
      "centralizar teoria, revisões, prints de questões e observações;",
      "evitar perda de anotações importantes;",
      "criar um histórico de estudo por disciplina e assunto;",
      "facilitar revisões rápidas antes de simulados e provas."
    ],
    howUse: [
      "Use o OneNote como mapa de estudo, não como depósito infinito de conteúdo.",
      "Estrutura recomendada: Caderno = concurso ou área; Seções = disciplinas; Páginas = assuntos; Subpáginas = revisão, questões, observações e erros.",
      "Ao terminar um bloco, registre apenas o que aumenta sua capacidade de revisar ou corrigir erro."
    ],
    steps: [
      "Crie um caderno com o nome do concurso ou da área.",
      "Crie uma seção para cada disciplina.",
      "Dentro de cada disciplina, crie páginas para os assuntos do edital.",
      "Use subpáginas para revisão, questões, observações e erros relevantes.",
      "Revise semanalmente o que foi registrado e apague excessos que não ajudam."
    ],
    mistakes: [
      "copiar aulas inteiras para dentro do OneNote;",
      "misturar disciplinas e assuntos sem padrão;",
      "guardar print de questão sem explicar o motivo do erro;",
      "gastar mais tempo decorando o caderno do que estudando;",
      "criar páginas que nunca serão revisadas."
    ],
    goldenRule: "Se a anotação não ajuda você a revisar melhor, ela provavelmente está excessiva.",
    checklist: [
      "Tenho um caderno por concurso ou área.",
      "Cada disciplina tem uma seção própria.",
      "Cada assunto importante tem página separada.",
      "Meus erros possuem explicação curta do motivo.",
      "Eu reviso e limpo o caderno periodicamente."
    ],
    exercise: {
      title: "Monte sua primeira estrutura funcional",
      text: "Escolha uma disciplina do seu plano e crie uma seção com três assuntos prioritários. Em cada assunto, adicione uma subpágina de revisão e outra de erros.",
      steps: ["Defina a disciplina.", "Crie três páginas de assunto.", "Registre uma anotação útil em cada página.", "Elimine qualquer conteúdo que não ajude na revisão."]
    },
    visual: {
      type: "flow",
      title: "Fluxo recomendado no OneNote",
      items: ["Caderno", "Disciplina", "Assunto", "Revisão", "Erros"]
    },
    final: "Organização não aprova ninguém sozinha, mas a desorganização reprova muita gente."
  },
  {
    slug: "flashcards",
    file: "./metodos-de-estudo-flashcards.html",
    prettyPath: "/area-do-aluno/metodos-de-estudo/flashcards",
    icon: "FC",
    tone: "blue",
    shortTitle: "Flashcards",
    title: "Flashcards: como revisar de forma ativa e memorizar o que importa",
    subtitle: "Aprenda a usar flashcards para reforçar conceitos, revisar com agilidade e melhorar a retenção.",
    summary: "Revisão ativa e retenção",
    objective: [
      "entender o que são flashcards;",
      "saber quando usar e quando não usar;",
      "criar cartões curtos e eficientes;",
      "revisar de forma ativa, sem depender apenas de releitura."
    ],
    intro: [
      "Flashcards são cartões de pergunta e resposta usados para recuperar informação da memória. A força deles está no esforço ativo de lembrar antes de olhar a resposta.",
      "Eles são excelentes para reforçar pontos objetivos, mas não servem para substituir o estudo inicial de temas densos."
    ],
    what: "São cartões curtos, geralmente com uma pergunta na frente e uma resposta objetiva no verso. O aluno lê a pergunta, tenta responder mentalmente e só depois confere.",
    purpose: [
      "fixar conceitos curtos;",
      "revisar prazos, competências e classificações;",
      "comparar institutos parecidos;",
      "manter contato frequente com pontos que caem muito."
    ],
    howUse: [
      "Use flashcards para lei seca, conceitos curtos, prazos, competências, classificações e diferenças entre institutos.",
      "Evite criar flashcards de assuntos que você ainda não compreendeu. Primeiro entenda, depois transforme em cartão.",
      "Cartões bons são objetivos. Exemplo bom: 'Qual é o prazo X?'. Exemplo ruim: 'Explique toda a teoria sobre X'."
    ],
    steps: [
      "Estude o assunto antes de criar cartões.",
      "Transforme um ponto importante em pergunta curta.",
      "Escreva uma resposta objetiva e conferível.",
      "Revise tentando lembrar antes de olhar a resposta.",
      "Reescreva cartões confusos ou longos demais."
    ],
    mistakes: [
      "usar flashcard para aprender assunto do zero;",
      "fazer cartões enormes;",
      "criar perguntas vagas;",
      "revisar apenas reconhecendo a resposta;",
      "acumular cartões demais sem revisar."
    ],
    goldenRule: "Flashcard é ferramenta de reforço, não substituto do estudo.",
    checklist: [
      "Cada cartão tem uma pergunta clara.",
      "A resposta é curta e objetiva.",
      "O cartão cobra um ponto relevante para prova.",
      "Eu tento responder antes de conferir.",
      "Cartões ruins são apagados ou reescritos."
    ],
    exercise: {
      title: "Crie cinco cartões úteis",
      text: "Pegue um assunto já estudado e crie cinco flashcards: dois de conceito, um de prazo, um de diferença entre institutos e um de pegadinha comum.",
      steps: ["Escolha o assunto.", "Escreva perguntas curtas.", "Responda sem olhar o material.", "Marque os cartões que realmente exigiram memória ativa."]
    },
    visual: {
      type: "flashcard",
      title: "Modelo frente e verso",
      front: "Frente: Qual é o conceito central?",
      back: "Verso: Resposta curta, objetiva e revisável."
    },
    final: "Quem apenas relê reconhece; quem revisa ativamente lembra."
  },
  {
    slug: "inteligencia-artificial",
    file: "./metodos-de-estudo-inteligencia-artificial.html",
    prettyPath: "/area-do-aluno/metodos-de-estudo/inteligencia-artificial",
    icon: "IA",
    tone: "green",
    shortTitle: "Inteligência Artificial",
    title: "Inteligência Artificial nos estudos: como usar Gemini e NotebookLM de forma estratégica",
    subtitle: "Aprenda a usar IA para entender conteúdos, revisar melhor, criar simulados, gerar flashcards e treinar discursivas.",
    summary: "Gemini, NotebookLM, simulados, flashcards e discursivas",
    objective: [
      "entender o papel da IA na preparação;",
      "usar IA como apoio, não como atalho;",
      "aplicar Gemini e NotebookLM em tarefas reais de estudo;",
      "melhorar revisão, treino e correção sem perder autonomia."
    ],
    intro: [
      "A IA não substitui estudo real. Ela não lê por você, não resolve sua constância e não garante domínio técnico. O papel dela é acelerar entendimento, organizar revisão e criar bons treinos.",
      "Use IA para explicar temas difíceis, resumir conteúdos, comparar institutos, gerar perguntas, criar flashcards, montar simulados, treinar discursivas e corrigir respostas no estilo da banca."
    ],
    what: "É um conjunto de ferramentas que pode apoiar a compreensão, a revisão e a produção de exercícios. O valor está na qualidade do comando que você dá e na crítica que faz da resposta.",
    purpose: [
      "explicar temas difíceis em linguagem didática;",
      "gerar perguntas e flashcards;",
      "montar simulados por nível de dificuldade;",
      "treinar questões discursivas;",
      "comparar institutos e organizar revisões."
    ],
    howUse: [
      "Peça respostas com contexto, nível de profundidade e formato desejado.",
      "Sempre confira pontos sensíveis em lei, jurisprudência, edital e material confiável.",
      "Use Gemini para explicação, elaboração e correção. Use NotebookLM para trabalhar com PDFs, resumos, anotações e materiais próprios."
    ],
    steps: [
      "Escolha o assunto e diga seu nível de conhecimento.",
      "Informe a banca, cargo ou prova quando fizer sentido.",
      "Peça uma saída objetiva: resumo, quadro comparativo, simulado, flashcards ou correção.",
      "Revise criticamente a resposta.",
      "Transforme a resposta em ação de estudo: questão, revisão, caderno de erros ou discursiva."
    ],
    mistakes: [
      "copiar resposta da IA sem checar;",
      "pedir comandos vagos;",
      "usar IA para fugir da leitura do material;",
      "trocar treino real por resumos automáticos;",
      "aceitar correção sem comparar com edital e padrão da banca."
    ],
    goldenRule: "A IA deve tornar seu estudo melhor, nunca mais preguiçoso.",
    checklist: [
      "Eu informei o contexto do concurso ou banca.",
      "O prompt pediu um formato claro de resposta.",
      "Eu conferi pontos sensíveis em fonte confiável.",
      "Usei a resposta para gerar treino real.",
      "Não substituí estudo por automação."
    ],
    subblocks: [
      {
        title: "Gemini",
        text: "Use para explicações didáticas, aprofundamento, geração de flashcards, simulados, questões discursivas e correção de discursivas como avaliador da banca.",
        bullets: [
          "Explique este tema de forma didática, como se eu fosse iniciante.",
          "Crie 15 flashcards sobre este assunto.",
          "Monte um simulado com 10 questões de nível avançado.",
          "Elabore uma questão discursiva sobre esse tema.",
          "Corrija minha discursiva como se você fosse avaliador da banca Cebraspe.",
          "Aponte falhas de estrutura, objetividade e aderência ao enunciado."
        ]
      },
      {
        title: "NotebookLM",
        text: "Use para trabalhar com seus próprios materiais: PDFs, resumos, anotações e materiais de aula. Ele ajuda a resumir, localizar informações, gerar perguntas e organizar revisões com base no seu acervo.",
        bullets: [
          "Suba PDFs e materiais confiáveis.",
          "Peça resumos por tópicos.",
          "Localize informações específicas no material.",
          "Gere perguntas com base no conteúdo carregado.",
          "Organize uma revisão a partir do seu próprio acervo."
        ]
      }
    ],
    exercise: {
      title: "Transforme IA em treino",
      text: "Escolha um tema difícil e peça: explicação didática, cinco flashcards, cinco questões e uma discursiva curta. Depois, resolva sem consultar a resposta.",
      steps: ["Escreva um prompt contextualizado.", "Gere material de treino.", "Responda antes de conferir.", "Registre os erros no seu caderno."]
    },
    visual: {
      type: "compare",
      title: "Gemini x NotebookLM",
      items: [
        { label: "Gemini", value: "explicar, criar, comparar e corrigir" },
        { label: "NotebookLM", value: "trabalhar com PDFs e materiais próprios" }
      ]
    },
    final: "Tecnologia ajuda muito. Mas aprovação continua sendo resultado de compreensão, treino e constância."
  },
  {
    slug: "caderno-de-erros",
    file: "./metodos-de-estudo-caderno-de-erros.html",
    prettyPath: "/area-do-aluno/metodos-de-estudo/caderno-de-erros",
    icon: "CE",
    tone: "red",
    shortTitle: "Caderno de Erros",
    title: "Caderno de Erros: como transformar falhas em evolução",
    subtitle: "Aprenda a usar o Caderno de Erros e as Favoritas do Tec Concursos para registrar, revisar e corrigir os pontos que estão te custando aprovação.",
    summary: "Gestão de falhas e revisão estratégica",
    objective: [
      "entender a importância do caderno de erros;",
      "saber o que registrar;",
      "usar as favoritas do Tec Concursos com estratégia;",
      "transformar erro em plano de correção."
    ],
    intro: [
      "O caderno de erros é o mapa dos pontos que ainda tiram nota do aluno. Ele não é uma lista de fracassos, mas uma ferramenta de inteligência de prova.",
      "Quando integrado às Favoritas do Tec Concursos, ele ajuda a localizar questões importantes, revisar padrões de erro e repetir o treino certo."
    ],
    what: "É um registro organizado dos erros relevantes, com motivo, resposta correta, observação útil e estratégia para não repetir a falha.",
    purpose: [
      "identificar padrões de erro;",
      "priorizar revisões com maior impacto;",
      "transformar questões erradas em material ativo;",
      "evitar repetir falhas em simulados e provas."
    ],
    howUse: [
      "Resolva questões, favorite as mais importantes no Tec Concursos, registre o motivo do erro e revise periodicamente.",
      "Registre disciplina, assunto, banca, motivo do erro, resposta correta, observação útil, como evitar repetir o erro e data de revisão.",
      "Classifique o erro: não sabia a teoria, confundi conceitos, errei por atenção, interpretação, detalhe, jurisprudência/lei seca ou chute."
    ],
    steps: [
      "Resolva questões no bloco do dia.",
      "Favorite as questões mais importantes no Tec Concursos.",
      "Registre o motivo real do erro.",
      "Escreva a correção em linguagem curta.",
      "Revise os erros em ciclos semanais."
    ],
    mistakes: [
      "guardar toda questão errada sem critério;",
      "registrar apenas o gabarito;",
      "não classificar o motivo do erro;",
      "nunca voltar para revisar;",
      "confundir erro pontual com deficiência estrutural."
    ],
    goldenRule: "O valor do erro está na análise que você faz dele, não no erro em si.",
    checklist: [
      "Registrei disciplina, assunto e banca.",
      "Expliquei o motivo do erro.",
      "Anotei a resposta correta de forma curta.",
      "Defini como evitar a repetição.",
      "Marquei uma data de revisão."
    ],
    exercise: {
      title: "Auditoria de erros",
      text: "Pegue as últimas 10 questões erradas e classifique o motivo de cada erro. Depois escolha as três que mais se repetem para revisar primeiro.",
      steps: ["Separe as questões.", "Classifique o tipo de erro.", "Identifique padrão dominante.", "Crie uma ação de correção para esta semana."]
    },
    visual: {
      type: "flow",
      title: "Fluxo do erro bem usado",
      items: ["Questão", "Erro", "Registro", "Revisão", "Evolução"]
    },
    final: "Seu maior material de estudo é o mapa daquilo que ainda te faz perder pontos."
  },
  {
    slug: "revisao-semanal",
    file: "./metodos-de-estudo-revisao-semanal.html",
    prettyPath: "/area-do-aluno/metodos-de-estudo/revisao-semanal",
    icon: "RS",
    tone: "blue",
    shortTitle: "Revisão Semanal",
    title: "Revisão Semanal: como consolidar o que você estudou",
    subtitle: "Aprenda a revisar, uma vez por semana, o material construído no OneNote e as questões favoritas que revelam seus pontos de atenção.",
    summary: "Consolidação do conteúdo por meio do OneNote e das questões favoritas.",
    objective: [
      "entender o papel da revisão semanal;",
      "usar o OneNote como base de revisão;",
      "revisitar favoritas e erros relevantes;",
      "consolidar o conteúdo sem voltar a estudar tudo do zero;",
      "criar uma rotina periódica de revisão, preferencialmente aos fins de semana."
    ],
    intro: [
      "A revisão semanal é o momento em que você consolida o que estudou ao longo dos últimos dias.",
      "Aqui, o foco não é voltar à teoria de forma desorganizada, nem tentar reestudar toda a matéria. O objetivo é revisitar o material que você mesmo construiu no OneNote, retomar as questões favoritas e rever os erros que merecem atenção.",
      "Quando feita com regularidade, essa revisão reduz o esquecimento, melhora a retenção e impede que falhas importantes se repitam."
    ],
    what: [
      "A revisão semanal é um momento fixo, uma vez por semana, para rever o que foi estudado.",
      "Nela, você relê o essencial, revisa registros do OneNote, retoma favoritas, revisa erros recorrentes ou relevantes e fecha a semana com clareza."
    ],
    purpose: [
      "consolidar conteúdo;",
      "reduzir esquecimento;",
      "manter o estudo ativo;",
      "revisar o que realmente importa;",
      "impedir repetição de erros;",
      "preparar melhor o próximo ciclo de estudo."
    ],
    howLabel: "Como funciona",
    howUse: {
      text: "A lógica é simples: durante a semana você constrói bons registros; no fim de semana, transforma esse material em uma revisão curta, ativa e estratégica.",
      groups: [
        {
          title: "Durante a semana",
          bullets: [
            "estude normalmente;",
            "registre o essencial no OneNote;",
            "salve questões favoritas;",
            "identifique erros importantes."
          ]
        },
        {
          title: "No sábado ou domingo",
          bullets: [
            "abra o OneNote;",
            "revise os assuntos estudados;",
            "relembre comparativos, conceitos-chave e observações;",
            "revisite as favoritas;",
            "volte aos erros relevantes;",
            "identifique o que ainda precisa reaparecer no próximo ciclo."
          ]
        }
      ]
    },
    steps: {
      type: "steps",
      items: [
        { title: "Passo 1 - Abra o OneNote", text: "Revise os assuntos estudados na semana." },
        { title: "Passo 2 - Releia apenas o essencial", text: "Foque em comparativos, observações, conceitos-chave e pontos que geraram dúvida." },
        { title: "Passo 3 - Revise suas favoritas", text: "Retome as questões favoritas e verifique se o raciocínio já está claro." },
        { title: "Passo 4 - Volte aos erros relevantes", text: "Reveja os erros recorrentes ou estratégicos." },
        { title: "Passo 5 - Feche a semana com clareza", text: "Identifique o que evoluiu, o que ainda está frágil e o que precisa voltar no próximo ciclo." }
      ]
    },
    mistakes: [],
    goldenRule: "A revisão semanal não serve para reestudar tudo. Serve para revisitar o que é essencial, consolidar o que foi visto e impedir que os erros se repitam.",
    checklistKicker: "Checklist da revisão",
    checklistTitle: "Antes de encerrar a semana",
    checklist: [
      "Revisei o OneNote da semana",
      "Retomei os conceitos que mais geraram dúvida",
      "Revi minhas questões favoritas",
      "Voltei aos erros relevantes",
      "Identifiquei o que precisa reaparecer na próxima semana",
      "Fechei a revisão sem acumular material desnecessário"
    ],
    exercise: {
      title: "No próximo fim de semana",
      text: "Faça uma revisão curta, deliberada e suficiente para fechar a semana sem transformar revisão em novo estudo do zero.",
      steps: [
        "abra seu OneNote;",
        "selecione os assuntos estudados na semana;",
        "revise os pontos centrais;",
        "abra suas favoritas;",
        "reveja pelo menos 10 questões importantes;",
        "anote o que ainda precisa voltar no próximo ciclo."
      ]
    },
    suggestion: {
      title: "Sugestão do Projeto Posse",
      text: [
        "Reserve 1 momento fixo por semana para sua revisão, preferencialmente no sábado ou no domingo.",
        "A constância dessa revisão vale mais do que revisões longas e irregulares."
      ]
    },
    visual: {
      type: "flow",
      title: "Fluxo da revisão semanal",
      items: ["Semana de estudo", "Registro no OneNote", "Questões favoritas / erros", "Revisão semanal", "Consolidação do conteúdo"]
    },
    final: "Quem revisa com método esquece menos, erra menos e evolui com mais consistência."
  },
  {
    slug: "discursivas",
    file: "./metodos-de-estudo-discursivas.html",
    prettyPath: "/area-do-aluno/metodos-de-estudo/discursivas",
    icon: "DI",
    tone: "gold",
    shortTitle: "Discursivas",
    title: "Discursivas: como treinar escrita de forma técnica e estratégica",
    subtitle: "Aprenda a estudar discursivas com foco em banca, estrutura, objetividade e densidade.",
    summary: "Escrita estratégica por banca",
    objective: [
      "entender que discursiva exige treino próprio;",
      "identificar o perfil da banca;",
      "estruturar respostas melhores;",
      "usar IA como apoio para correção e aperfeiçoamento."
    ],
    intro: [
      "Discursiva não é detalhe. Ela mede organização, objetividade, domínio técnico, adequação ao comando e capacidade de síntese.",
      "Um bom treino precisa considerar banca, estrutura, densidade, gestão de linhas e correção. Escrever sem correção é repetir vícios com mais confiança."
    ],
    what: "É uma resposta técnica construída para cumprir o comando da banca com clareza, conteúdo suficiente e organização em tempo limitado.",
    purpose: [
      "treinar aderência ao enunciado;",
      "desenvolver estrutura clara;",
      "melhorar conteúdo técnico e objetividade;",
      "aprender a gerir linhas e tempo;",
      "ganhar densidade sem excesso de generalidade."
    ],
    howUse: [
      "Entenda o perfil da banca antes de treinar. Leia boas respostas, estruture antes de escrever, escreva objetivamente, corrija e reescreva.",
      "A resposta deve enfrentar os subitens, usar linguagem técnica e evitar rodeios.",
      "Use IA para simular correção, mas compare a devolutiva com espelhos, editais e padrões reais da banca."
    ],
    steps: [
      "Entender o perfil da banca.",
      "Ler boas respostas e espelhos.",
      "Estruturar antes de escrever.",
      "Escrever com objetividade e densidade.",
      "Corrigir, reescrever e comparar evolução."
    ],
    mistakes: [
      "ignorar o comando da questão;",
      "não responder todos os subitens;",
      "usar introduções longas e genéricas;",
      "escrever sem estrutura prévia;",
      "não treinar com tempo e limite de linhas;",
      "não reescrever após a correção."
    ],
    goldenRule: "Discursiva melhora com treino corrigido, não com intenção.",
    checklist: [
      "Li o comando com atenção.",
      "Identifiquei todos os subitens.",
      "Planejei a estrutura antes de escrever.",
      "Usei conteúdo técnico suficiente.",
      "Corrigi e reescrevi a resposta."
    ],
    subblocks: [
      {
        title: "Perfil das bancas",
        text: "Cada banca cobra a escrita com ênfases diferentes. Ajuste o treino ao padrão esperado.",
        bullets: [
          "Cebraspe: objetividade forte e aderência rigorosa ao comando.",
          "FGV: maior elaboração argumentativa, eventualmente jurisprudência.",
          "FCC: perfil técnico e linear.",
          "Vunesp: resposta mais direta e limpa."
        ]
      },
      {
        title: "IA na discursiva",
        text: "Prompt recomendado para correção assistida:",
        bullets: [
          "Corrija esta discursiva como se fosse avaliador da banca Cebraspe, apontando falhas de aderência ao comando, conteúdo insuficiente, problemas de estrutura, excesso de generalidade e sugestões de melhoria."
        ]
      }
    ],
    exercise: {
      title: "Treino com correção e reescrita",
      text: "Escolha uma discursiva curta, escreva em tempo limitado, peça correção com foco na banca e reescreva a resposta em versão melhorada.",
      steps: ["Leia o comando.", "Faça um esqueleto em tópicos.", "Escreva a resposta.", "Corrija e reescreva."]
    },
    visual: {
      type: "flow",
      title: "Fluxo da discursiva eficiente",
      items: ["Comando", "Estrutura", "Resposta", "Correção", "Reescrita"]
    },
    final: "Na discursiva, quem pensa com método escreve com vantagem."
  }
];

const STUDY_METHODS_MAP = new Map(STUDY_METHODS.map((method) => [method.slug, method]));

function renderTextBlock(value) {
  if (Array.isArray(value)) return value.map((item) => `<p>${esc(item)}</p>`).join("");
  return `<p>${esc(value)}</p>`;
}

function renderMethodBullets(items, className = "method-bullet-list") {
  return `<ul class="${className}">${(items || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
}

function hasMethodContent(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") {
    if (value.type === "steps") return Boolean(value.items?.length);
    return Boolean(value.text || value.groups?.length);
  }
  return Boolean(value);
}

function renderMethodSectionContent(content) {
  if (Array.isArray(content)) return renderMethodBullets(content);
  if (content && typeof content === "object") {
    if (content.type === "steps") {
      return `<ol class="method-step-list">${(content.items || []).map((step, index) => `<li><span>${esc(String(index + 1).padStart(2, "0"))}</span><div><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></div></li>`).join("")}</ol>`;
    }

    const text = content.text ? renderTextBlock(content.text) : "";
    const groups = (content.groups || []).map((group) => `<article class="method-mini-card"><h3>${esc(group.title)}</h3>${group.text ? `<p>${esc(group.text)}</p>` : ""}${renderMethodBullets(group.bullets || [])}</article>`).join("");
    return `${text}${groups ? `<div class="method-mini-grid">${groups}</div>` : ""}`;
  }
  return renderTextBlock(content);
}

function renderMethodSection(id, title, content) {
  if (!hasMethodContent(content)) return "";
  return `<section id="${esc(id)}" class="lesson-block"><span class="lesson-kicker">Aula</span><h2>${esc(title)}</h2>${renderMethodSectionContent(content)}</section>`;
}

function renderSubblocks(method) {
  if (!method.subblocks?.length) return "";
  return `<section id="aplicacoes" class="lesson-block lesson-block-accent"><span class="lesson-kicker">Aplicações</span><h2>Blocos práticos</h2><div class="subblock-grid">${method.subblocks.map((block) => `<article class="subblock-card"><h3>${esc(block.title)}</h3><p>${esc(block.text)}</p>${renderMethodBullets(block.bullets || [], "prompt-list")}</article>`).join("")}</div></section>`;
}

function renderMethodSuggestion(method) {
  if (!method.suggestion) return "";
  return `<section id="sugestao" class="suggestion-card"><span class="lesson-kicker">Projeto Posse</span><h2>${esc(method.suggestion.title)}</h2>${renderTextBlock(method.suggestion.text)}</section>`;
}

function renderMethodIllustration(method) {
  const visual = method.visual || {};
  if (visual.type === "flashcard") {
    return `<section id="visual" class="lesson-block"><span class="lesson-kicker">Visual</span><h2>${esc(visual.title)}</h2><div class="flashcard-demo"><article><span>Frente</span><strong>${esc(visual.front)}</strong></article><article><span>Verso</span><strong>${esc(visual.back)}</strong></article></div></section>`;
  }
  if (visual.type === "compare") {
    return `<section id="visual" class="lesson-block"><span class="lesson-kicker">Visual</span><h2>${esc(visual.title)}</h2><div class="compare-grid">${(visual.items || []).map((item) => `<article><strong>${esc(item.label)}</strong><span>${esc(item.value)}</span></article>`).join("")}</div></section>`;
  }
  return `<section id="visual" class="lesson-block"><span class="lesson-kicker">Visual</span><h2>${esc(visual.title || "Fluxo do método")}</h2><div class="method-flow">${(visual.items || []).map((item, index) => `<div class="flow-step"><span>${esc(String(index + 1).padStart(2, "0"))}</span><strong>${esc(item)}</strong></div>`).join("")}</div></section>`;
}

function renderStudyMethodsHome() {
  const cards = STUDY_METHODS.map((method, index) => `<article class="method-index-card method-tone-${esc(method.tone)}"><div class="method-card-icon" aria-hidden="true">${esc(method.icon)}</div><span class="method-card-count">Módulo ${esc(String(index + 1).padStart(2, "0"))}</span><h2>${esc(method.shortTitle)}</h2><p>${esc(method.summary)}</p><a class="button button-secondary" href="${esc(method.file)}" aria-label="Acessar conteúdo de ${esc(method.shortTitle)}">Acessar conteúdo</a></article>`).join("");

  appContent.innerHTML = `<section class="method-home-hero"><div class="method-breadcrumb"><a href="./mentorado.html">Área do aluno</a><span>/</span><strong>Métodos de Estudo</strong></div><p class="eyebrow">Manual do aluno</p><h1>Métodos de Estudo</h1><p>Nesta seção, você aprenderá a usar ferramentas e estratégias que tornam sua preparação mais organizada, ativa e eficiente. Aqui, o foco não é estudar de forma bonita. É estudar de forma funcional, estratégica e competitiva.</p></section><section class="method-index-grid" aria-label="Métodos disponíveis">${cards}</section><section class="method-home-note"><div><span class="lesson-kicker">Como usar</span><h2>Escolha um módulo e aplique no seu plano da semana</h2><p>Os conteúdos foram estruturados como aulas curtas, com objetivo, passo a passo, erros comuns, checklist e exercício prático.</p></div><a class="button button-primary" href="./plano.html">Abrir plano de estudos</a></section>`;
}

function renderStudyMethodDetail(slug) {
  const method = STUDY_METHODS_MAP.get(slug) || STUDY_METHODS[0];
  const moduleIndex = STUDY_METHODS.findIndex((item) => item.slug === method.slug) + 1;
  const sideLinks = [
    ["objetivo", "Objetivo"],
    ["introducao", "Introdução"],
    ["o-que-e", "O que é"],
    ["para-que-serve", "Para que serve"],
    ["como-usar", method.howLabel || "Como usar"],
    ["passo-a-passo", "Passo a passo"],
    ...(method.subblocks?.length ? [["aplicacoes", "Aplicações"]] : []),
    ...(hasMethodContent(method.mistakes) ? [["erros-comuns", "Erros comuns"]] : []),
    ["regra-de-ouro", "Regra de ouro"],
    ["checklist", "Checklist"],
    ["exercicio", "Exercício"],
    ...(method.suggestion ? [["sugestao", "Sugestão"]] : []),
    ["visual", "Visual"]
  ];

  appContent.innerHTML = `<div class="method-breadcrumb"><a href="./mentorado.html">Área do aluno</a><span>/</span><a href="./metodos-de-estudo.html">Métodos de Estudo</a><span>/</span><strong>${esc(method.shortTitle)}</strong></div><section class="method-lesson-hero method-tone-${esc(method.tone)}"><div><span class="method-module-label">Módulo ${esc(String(moduleIndex).padStart(2, "0"))} de ${esc(String(STUDY_METHODS.length).padStart(2, "0"))}</span><h1>${esc(method.title)}</h1><p>${esc(method.subtitle)}</p><div class="inline-actions"><a class="button button-secondary" href="./metodos-de-estudo.html">Voltar aos métodos</a><a class="button button-primary" href="#exercicio">Ir para exercício</a></div></div><div class="method-hero-mark" aria-hidden="true">${esc(method.icon)}</div></section><div class="method-detail-layout"><aside class="method-side-nav" aria-label="Navegação interna da aula"><strong>Nesta aula</strong>${sideLinks.map(([id, label]) => `<a href="#${esc(id)}">${esc(label)}</a>`).join("")}<hr><strong>Outros módulos</strong>${STUDY_METHODS.map((item) => `<a href="${esc(item.file)}" class="${item.slug === method.slug ? "is-current" : ""}">${esc(item.shortTitle)}</a>`).join("")}</aside><article class="method-lesson"><section id="objetivo" class="lesson-block lesson-objective"><span class="lesson-kicker">Objetivo da aula</span><h2>Ao final desta aula, você deverá ser capaz de:</h2>${renderMethodBullets(method.objective, "check-list")}</section><section id="introducao" class="lesson-block"><span class="lesson-kicker">Introdução</span><h2>Antes de aplicar</h2>${renderTextBlock(method.intro)}</section>${renderMethodSection("o-que-e", "O que é", method.what)}${renderMethodSection("para-que-serve", "Para que serve", method.purpose)}${renderMethodSection("como-usar", method.howLabel || "Como usar", method.howUse)}${renderMethodSection("passo-a-passo", "Passo a passo", method.steps)}${renderSubblocks(method)}${renderMethodSection("erros-comuns", "Erros comuns", method.mistakes)}<section id="regra-de-ouro" class="golden-rule-card"><span>Regra de ouro</span><strong>${esc(method.goldenRule)}</strong></section><section id="checklist" class="lesson-block"><span class="lesson-kicker">${esc(method.checklistKicker || "Checklist do aluno")}</span><h2>${esc(method.checklistTitle || "Antes de considerar o método aplicado")}</h2>${renderMethodBullets(method.checklist, "check-list")}</section><section id="exercicio" class="exercise-card"><span class="lesson-kicker">Exercício prático</span><h2>${esc(method.exercise.title)}</h2><p>${esc(method.exercise.text)}</p>${renderMethodBullets(method.exercise.steps, "check-list")}</section>${renderMethodSuggestion(method)}${renderMethodIllustration(method)}<section class="lesson-final"><p>${esc(method.final)}</p><a class="button button-secondary" href="./metodos-de-estudo.html">Escolher outro método</a></section></article></div>`;
}

function renderMentoradoDashboard(profile, data) {
  const totalHoras = data.weekly.reduce((sum, item) => sum + Number(item.horas || 0), 0);
  const totalQuestoes = data.weekly.reduce((sum, item) => sum + Number(item.questoes || 0), 0);
  const totalAcertos = data.weekly.reduce((sum, item) => sum + Number(item.acertos || 0), 0);
  const totalPomodoros = data.pomodoro.reduce((sum, item) => sum + Number(item.sessoes || 0), 0);
  const currentPlan = data.monthlyCollection[0];
  const concursoNome = profile?.concursos?.nome || "Concurso não informado";
  const checkins = data.dailyCheckins || [];
  const todayCheckin = checkins.find((c) => c.referencia === isoToday());
  const streak = calcStreak(checkins);

  const todayHtml = todayCheckin
    ? `<div class="today-metrics">
        <span><strong>${esc(fmtHours(todayCheckin.horas_estudo))}</strong><small>Horas</small></span>
        <span><strong>${esc(String(todayCheckin.questoes_feitas))}</strong><small>Questões</small></span>
        <span><strong>${esc(fmtPct(todayCheckin.questoes_certas, todayCheckin.questoes_feitas))}</strong><small>Acerto</small></span>
        <span><strong>${esc(String(todayCheckin.pomodoros))}</strong><small>Pomodoros</small></span>
      </div>
      ${todayCheckin.observacao ? `<p class="mentor-note" style="margin-top:.8rem;">${esc(truncateText(todayCheckin.observacao, 100))}</p>` : ""}
      <div class="inline-actions" style="margin-top:1rem;">
        <a class="button button-secondary" href="./evolucao.html">Ver evolução</a>
      </div>`
    : `<p class="page-copy" style="margin-top:.6rem;">Você ainda não registrou o dia de hoje. Mantenha seu histórico atualizado!</p>
       <div class="inline-actions" style="margin-top:1rem;">
         <a class="button button-primary" href="./evolucao.html">Fazer check-in agora</a>
       </div>`;

  const streakMsg = streak.current === 0
    ? "Comece hoje para iniciar sua sequência."
    : streak.current >= streak.best
      ? "🏆 Você está no seu recorde pessoal!"
      : `Continue para bater seu recorde de ${esc(String(streak.best))} dias.`;

  const planHtml = currentPlan
    ? `<strong>${esc(currentPlan.titulo)}</strong>
       <p class="page-copy">${esc(fmtPlanReference(currentPlan.mes_referencia))}</p>
       <div class="plan-progress-row" style="margin-top:1rem;">
         <div class="metric-bar"><span style="width:${esc(String(currentPlan.progress))}%"></span></div>
         <span class="plan-progress-pct">${esc(String(currentPlan.progress))}%</span>
       </div>
       <div class="badge-row" style="margin-top:.8rem;">
         <span class="badge gold">${esc(`${currentPlan.completed}/${currentPlan.items.length} metas`)}</span>
         <span class="badge ${badgeClass(currentPlan.status)}">${esc(currentPlan.status)}</span>
       </div>
       <div class="inline-actions" style="margin-top:1rem;">
         <a class="button button-secondary" href="./plano.html">Ver plano completo</a>
         ${currentPlan.resolved_pdf_url ? `<a class="button button-secondary" href="${esc(currentPlan.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">PDF</a>` : ""}
       </div>`
    : `<div class="empty-state">Nenhum plano de estudos ativo ainda.</div>`;

  appContent.innerHTML = `
    <section class="grid-4">
      <article class="card stat-card">
        <div class="stat-value">${esc(fmtHours(totalHoras))}</div>
        <div class="stat-label">Horas</div>
      </article>
      <article class="card stat-card">
        <div class="stat-value">${esc(String(totalQuestoes))}</div>
        <div class="stat-label">Questões</div>
      </article>
      <article class="card stat-card">
        <div class="stat-value">${esc(fmtPct(totalAcertos, totalQuestoes))}</div>
        <div class="stat-label">Acerto</div>
      </article>
      <article class="card stat-card">
        <div class="stat-value">${esc(String(totalPomodoros))}</div>
        <div class="stat-label">Pomodoros</div>
      </article>
    </section>

    <section class="grid-2" style="margin-top:1rem;">
      <article class="card">
        <div class="card-head">
          <h2 class="card-title">Hoje — ${esc(fmtDate(isoToday()))}</h2>
          <span class="badge ${todayCheckin ? "green" : "orange"}">${todayCheckin ? "✓ Check-in feito" : "◌ Sem check-in"}</span>
        </div>
        ${todayHtml}
      </article>
      <article class="card">
        <div class="card-head">
          <h2 class="card-title">Sequência de estudos</h2>
          <span class="badge gold">🔥 Streak</span>
        </div>
        <div class="streak-display">
          <div class="streak-current">
            <span class="streak-number">${esc(String(streak.current))}</span>
            <span class="streak-label">dias seguidos</span>
          </div>
          <div>
            <span class="badge blue">Recorde: ${esc(String(streak.best))} dias</span>
          </div>
        </div>
        <p class="page-copy" style="margin-top:.8rem;">${streakMsg}</p>
      </article>
    </section>

    <section class="grid-2" style="margin-top:1rem;">
      <article class="card">
        <div class="card-head">
          <h2 class="card-title">Plano de estudos</h2>
        </div>
        ${planHtml}
      </article>
      <article class="card">
        <div class="card-head">
          <h2 class="card-title">Pomodoro</h2>
          <span class="badge blue" id="pomodoroMode">Foco 25min</span>
        </div>
        <div class="pomodoro-timer">
          <div class="pomodoro-display" id="pomodoroDisplay">25:00</div>
          <div class="pomodoro-cycle" id="pomodoroCycle">Sessão 1 de 4</div>
        </div>
        <p class="pomodoro-status" id="pomodoroStatus">Pronto para começar</p>
        <div class="pomodoro-dots" id="pomodoroDots">
          <span class="pomo-dot"></span><span class="pomo-dot"></span>
          <span class="pomo-dot"></span><span class="pomo-dot"></span>
        </div>
        <div class="pomodoro-controls">
          <button class="button button-primary" id="pomodoroStart">▶ Iniciar</button>
          <button class="button button-secondary" id="pomodoroSkip">⏭ Pular</button>
          <button class="button button-secondary" id="pomodoroReset">↺ Zerar</button>
        </div>
        <div class="pomodoro-footer">
          <span id="pomodoroSessionCount">0</span> sessões hoje
        </div>
      </article>
    </section>

    <section class="card" style="margin-top:1rem;">
      <div class="card-head">
        <h2 class="card-title">Seu foco principal</h2>
        <span class="badge gold">${esc(concursoNome)}</span>
      </div>
      <p class="page-copy">Tudo nesta área é filtrado pelo seu concurso e pelas liberações individuais feitas pelos mentores.</p>
      <div class="badge-row" style="margin-top:1rem;">
        <a class="button button-secondary" href="./materials.html">Ver materiais</a>
        <a class="button button-secondary" href="./plano.html">Abrir plano</a>
        <a class="button button-secondary" href="./simulados.html">Simulados</a>
      </div>
    </section>
  `;

  initPomodoroTimer(todayCheckin?.pomodoros || 0);
}

function renderMaterialsPage(data) {
  appContent.innerHTML = `<section class="card"><div class="card-head"><h2 class="card-title">Biblioteca do Mentorado</h2><span class="badge gold">${esc(String(data.materiais.length))} itens</span></div><div class="list">${data.materiais.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.descricao || "Sem descricao.")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(item.tipo || "Material")}</span><span class="badge blue">${esc(item.visibilidade || "aluno")}</span></div>${item.resolved_url ? `<div class="inline-actions" style="margin-top:1rem;"><a class="button button-secondary" href="${esc(item.resolved_url)}" target="_blank" rel="noopener noreferrer">Abrir material</a></div>` : item.file_path ? `<div class="message error" style="margin-top:1rem;">Arquivo vinculado, mas a URL assinada nao foi gerada. Verifique o bucket <strong>materiais</strong> e o caminho <strong>${esc(item.file_path)}</strong>.</div>` : ""}</div>`).join("") || `<div class="empty-state">Nenhum material disponivel para este perfil.</div>`}</div></section>`;
}

function renderPlanPage(data) {
  const monthlyHtml = data.monthlyCollection.map((plan) => {
    const groups = groupMonthlyItems(plan.items);
    const groupHtml = plan.items.length
      ? Array.from(groups.entries()).map(([label, rows]) => renderPlanDayGroup(label, rows)).join("")
      : `<div class="empty-state">Ainda nao existem metas cadastradas para este plano.</div>`;

    const bulkActions = plan.items.length
      ? `<form class="plan-bulk-actions" data-plan-complete-until><label><span class="field-label">Marcar metas feitas até</span><input class="input" name="until_date" type="date"></label><button class="button button-secondary" type="submit">Concluir até a data</button><div class="message" data-plan-bulk-message></div></form>`
      : "";

    return `<section class="card"><div class="card-head"><div><h2 class="card-title">${esc(plan.titulo)}</h2><p class="page-copy">${esc(fmtPlanReference(plan.mes_referencia))}</p></div><div class="badge-row"><span class="badge ${badgeClass(plan.status)}">${esc(plan.status)}</span><span class="badge gold">${esc(`${plan.completed}/${plan.items.length} metas`)}</span></div></div>${plan.descricao ? `<p class="page-copy">${esc(plan.descricao)}</p>` : ""}${plan.resolved_pdf_url ? `<div class="inline-actions" style="margin-bottom:1rem;"><a class="button button-secondary" href="${esc(plan.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF do plano</a></div>` : plan.pdf_path ? `<div class="message error" style="margin-bottom:1rem;">PDF vinculado, mas a URL assinada nao foi gerada. Verifique o bucket <strong>materiais</strong> e o caminho <strong>${esc(plan.pdf_path)}</strong>.</div>` : ""}<div class="plan-progress-row" style="margin-top:1rem;"><div class="metric-bar"><span style="width:${esc(String(plan.progress))}%"></span></div><span class="plan-progress-pct">${esc(String(plan.progress))}%</span></div>${renderPlanOverview(plan)}${renderPlanFocusQueue(plan)}${bulkActions}<div class="plan-day-list" style="margin-top:1rem;">${groupHtml}</div></section>`;
  }).join("");

  const legacyHtml = data.planosLegacy.length
    ? `<section class="card" style="margin-top:1rem;"><div class="card-head"><h2 class="card-title">Rotina semanal</h2><span class="badge gold">Apoio</span></div><div class="list">${data.planosLegacy.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.descricao || dayLabels[Number(item.dia_semana || 0)] || "Sem dia")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge ${badgeClass(item.status)}">${esc(item.status || "pendente")}</span></div></div>`).join("")}</div></section>`
    : "";

  appContent.innerHTML = `${monthlyHtml || `<section class="card"><div class="empty-state">Nenhum plano de estudos ativo ainda.</div></section>`}${legacyHtml}`;
  appContent.querySelectorAll("[data-plan-item-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", handlePlanItemToggle);
  });
  appContent.querySelectorAll("[data-plan-day-complete]").forEach((button) => {
    button.addEventListener("click", handlePlanDayComplete);
  });
  appContent.querySelectorAll("[data-plan-complete-until]").forEach((form) => {
    form.addEventListener("submit", handlePlanCompleteUntil);
  });
}

function renderSimuladosPage(data) {
  const totalQuestoes = data.simulados.reduce((sum, item) => sum + Number(item.total_questoes || 0), 0);
  const totalAcertos = data.simulados.reduce((sum, item) => sum + Number(item.acertos || 0), 0);

  appContent.innerHTML = `<section class="grid-3"><article class="card stat-card"><div class="stat-value">${esc(String(data.simulados.length))}</div><div class="stat-label">Simulados</div></article><article class="card stat-card"><div class="stat-value">${esc(String(totalAcertos))}</div><div class="stat-label">Acertos</div></article><article class="card stat-card"><div class="stat-value">${esc(fmtPct(totalAcertos, totalQuestoes))}</div><div class="stat-label">Aproveitamento</div></article></section><section class="card" style="margin-top:1rem;"><div class="card-head"><h2 class="card-title">Historico</h2></div><div class="list">${data.simulados.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.observacoes || "Sem observacoes do mentor.")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(fmtDate(item.data_aplicacao))}</span><span class="badge blue">${esc(`${item.acertos || 0}/${item.total_questoes || 0}`)}</span><span class="badge green">${esc(fmtPct(item.acertos, item.total_questoes))}</span></div>${item.resolved_pdf_url ? `<div class="inline-actions" style="margin-top:1rem;"><a class="button button-secondary" href="${esc(item.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF do simulado</a></div>` : item.pdf_path ? `<div class="message error" style="margin-top:1rem;">PDF vinculado, mas a URL assinada nao foi gerada. Verifique o bucket <strong>materiais</strong> e o caminho <strong>${esc(item.pdf_path)}</strong>.</div>` : ""}</div>`).join("") || `<div class="empty-state">Nenhum simulado registrado ainda.</div>`}</div></section>`;
}

function renderEvolutionPage(data) {
  const checkins = (data.dailyCheckins || []).slice().sort((a, b) => String(b.referencia || "").localeCompare(String(a.referencia || "")));
  const last7 = checkins.filter((item) => isWithinDays(item.referencia, 7));
  const metas7 = (data.monthlyCollection || []).flatMap((plan) => plan.items || []).filter((item) => item.concluida && item.concluida_em && isWithinDays(item.concluida_em.slice(0, 10), 7));
  const today = checkins.find((item) => item.referencia === isoToday());
  const recentGoals = metas7.slice(0, 6);
  const snapshot = buildEvolutionSnapshot(checkins);
  const performanceMetrics = [
    { label: "Questoes resolvidas", value: String(snapshot.totalQuestoes) },
    { label: "Acertos", value: String(snapshot.totalAcertos), tone: "green" },
    { label: "Horas acumuladas", value: fmtHours(snapshot.totalHoras) },
    { label: "Erros", value: String(snapshot.totalErros), tone: "red" }
  ];

  appContent.innerHTML = `<section class="card performance-overview"><div class="card-head"><div><h2 class="card-title">Desempenho Geral</h2><p class="page-copy">Painel consolidado para acompanhar volume, aproveitamento e constancia ao longo da preparacao.</p></div><span class="badge gold">${esc(String(checkins.length))} registros</span></div><div class="performance-grid"><div class="performance-metrics">${performanceMetrics.map((item) => `<article class="performance-stat"><span class="performance-stat-label">${esc(item.label)}</span><strong class="performance-stat-value${item.tone ? ` is-${item.tone}` : ""}">${esc(item.value)}</strong></article>`).join("")}</div><article class="chart-panel"><div class="chart-panel-head"><strong>Aproveitamento geral</strong><span>${esc(`${snapshot.aproveitamento}%`)}</span></div><div class="chart-panel-body donut-panel">${renderAccuracyDonut(snapshot)}</div><div class="chart-legend"><span class="legend-item"><i class="legend-dot is-green"></i>${esc(`${snapshot.totalAcertos} acertos`)}</span><span class="legend-item"><i class="legend-dot is-red"></i>${esc(`${snapshot.totalErros} erros`)}</span><span class="legend-item"><i class="legend-dot is-gold"></i>${esc(`${snapshot.diasAtivos} dias ativos`)}</span></div></article><article class="chart-panel chart-panel-wide"><div class="chart-panel-head"><strong>Evolucao recente</strong><span>ultimos 14 dias</span></div><div class="chart-panel-body">${renderRecentPerformanceChart(snapshot.recentSeries)}</div><div class="chart-legend"><span class="legend-item"><i class="legend-dot is-gold"></i>Questoes feitas</span><span class="legend-item"><i class="legend-dot is-green"></i>Questoes certas</span><span class="legend-item">${esc(snapshot.bestDay ? `Melhor dia: ${snapshot.bestDay.questoes} questoes em ${shortDateLabel(snapshot.bestDay.referencia)}` : "Sem pico de questoes ainda")}</span><span class="legend-item">${esc(`${snapshot.totalPomodoros} pomodoros acumulados`)}</span></div></article></div></section><section class="grid-4" style="margin-top:1rem;"><article class="card stat-card"><div class="stat-value">${esc(String(sumBy(last7, "questoes_feitas")))}</div><div class="stat-label">Questoes 7 dias</div><div class="stat-help">Volume recente resolvido.</div></article><article class="card stat-card"><div class="stat-value">${esc(fmtPct(sumBy(last7, "questoes_certas"), sumBy(last7, "questoes_feitas")))}</div><div class="stat-label">Acerto 7 dias</div><div class="stat-help">Percentual de aproveitamento.</div></article><article class="card stat-card"><div class="stat-value">${esc(fmtHours(sumBy(last7, "horas_estudo")))}</div><div class="stat-label">Horas 7 dias</div><div class="stat-help">Horas declaradas pelo aluno.</div></article><article class="card stat-card"><div class="stat-value">${esc(String(metas7.length))}</div><div class="stat-label">Metas cumpridas</div><div class="stat-help">Ultimos 7 dias.</div></article></section><section class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Registro do Dia</h2><span class="badge gold">${esc(fmtDate(isoToday()))}</span></div><form class="form-grid" id="dailyCheckinForm"><label><span class="field-label">Data</span><input class="input" name="referencia" type="date" value="${esc(today?.referencia || isoToday())}" required></label><label><span class="field-label">Horas estudadas</span><input class="input" name="horas_estudo" type="number" step="0.5" min="0" value="${esc(String(today?.horas_estudo ?? today?.horas ?? 0))}"></label><label><span class="field-label">Questoes feitas</span><input class="input" name="questoes_feitas" type="number" min="0" value="${esc(String(today?.questoes_feitas ?? today?.questoes ?? 0))}"></label><label><span class="field-label">Questoes certas</span><input class="input" name="questoes_certas" type="number" min="0" value="${esc(String(today?.questoes_certas ?? today?.acertos ?? 0))}"></label><label><span class="field-label">Pomodoros</span><input class="input" name="pomodoros" type="number" min="0" value="${esc(String(today?.pomodoros ?? 0))}"></label><label><span class="field-label">Metas cumpridas</span><input class="input" name="metas_cumpridas" type="number" min="0" value="${esc(String(today?.metas_cumpridas ?? 0))}"></label><label><span class="field-label">Observacao do dia</span><textarea class="textarea" name="observacao" placeholder="Como foi o dia, onde travou, o que funcionou melhor.">${esc(today?.observacao || "")}</textarea></label><button class="button button-primary" type="submit">Salvar meu dia</button><div class="message" data-checkin-message></div></form></article><article class="card"><div class="card-head"><h2 class="card-title">Metas concluidas recentemente</h2></div><div class="list">${recentGoals.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.descricao || "Meta concluida no plano de estudos.")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(item.tipo || "meta")}</span><span class="badge green">${esc(fmtDateTime(item.concluida_em))}</span></div></div>`).join("") || `<div class="empty-state">Nenhuma meta concluida nos ultimos 7 dias.</div>`}</div></article></section><section class="card" style="margin-top:1rem;"><div class="card-head"><h2 class="card-title">Historico diario</h2><span class="badge gold">${esc(String(checkins.length))} registros</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Horas</th><th>Questoes</th><th>Acertos</th><th>%</th><th>Pomodoros</th><th>Metas</th></tr></thead><tbody>${checkins.map((item) => `<tr><td>${esc(fmtDate(item.referencia))}</td><td>${esc(fmtHours(item.horas_estudo ?? item.horas))}</td><td>${esc(String(item.questoes_feitas ?? item.questoes ?? 0))}</td><td>${esc(String(item.questoes_certas ?? item.acertos ?? 0))}</td><td>${esc(fmtPct(item.questoes_certas ?? item.acertos, item.questoes_feitas ?? item.questoes))}</td><td>${esc(String(item.pomodoros ?? 0))}</td><td>${esc(String(item.metas_cumpridas ?? 0))}</td></tr>`).join("") || `<tr><td colspan="7" class="empty-state">Nenhum registro diario encontrado.</td></tr>`}</tbody></table></div></section>`;

  document.getElementById("dailyCheckinForm")?.addEventListener("submit", handleDailyCheckinSubmit);
}

async function fetchAdminData() {
  if (isDemoMode()) {
    const data = loadDemoData();
    return {
      mentorados: deepClone(data.mentorados),
      concursos: deepClone(data.concursos),
      materiais: deepClone(data.materiais),
      monthlyPlans: deepClone(data.monthlyPlans).map((item) => ({
        ...item,
        resolved_pdf_url: item.pdf_url || item.pdf_path || null
      })),
      monthlyItems: deepClone(data.monthlyItems),
      simulados: deepClone(data.simulados).map((item) => ({
        ...item,
        resolved_pdf_url: item.pdf_url || item.pdf_path || null
      })),
      dailyCheckins: deepClone(data.dailyCheckins || [])
    };
  }

  const { ensureSupabase } = await loadSupabaseModule();
  const client = ensureSupabase();
  const [profilesRes, concursosRes, materiaisRes, monthlyRes, itemsRes, simuladosRes, dailyCheckinsRes] = await Promise.all([
    client.from("profiles").select("id,nome,email,role,ativo,concurso_id,created_at").eq("role", "mentorado").order("created_at", { ascending: false }),
    client.from("concursos").select("id,nome,cargo,orgao,status,created_at").order("created_at", { ascending: false }),
    client.from("materiais").select("id,titulo,tipo,visibilidade,concurso_id,mentorado_id,created_at").order("created_at", { ascending: false }).limit(20),
    client.from("planos_mensais").select("id,mentorado_id,titulo,descricao,mes_referencia,status,pdf_url,pdf_path").order("mes_referencia", { ascending: false }).limit(80),
    client.from("plano_itens").select("id,plano_id,mentorado_id,titulo,descricao,tipo,data_prevista,dia_semana,ordem,concluida,concluida_em,tec_url,material_url").order("data_prevista", { ascending: true, nullsFirst: false }).order("ordem", { ascending: true }).limit(1500),
    client.from("simulados").select("id,titulo,data_aplicacao,acertos,total_questoes,mentorado_id,pdf_url,pdf_path").order("created_at", { ascending: false }).limit(20),
    client.from("daily_checkins").select("id,mentorado_id,referencia,horas_estudo,questoes_feitas,questoes_certas,pomodoros,metas_cumpridas,observacao").order("referencia", { ascending: false }).limit(120)
  ]);

  const error = profilesRes.error || concursosRes.error || materiaisRes.error || monthlyRes.error || itemsRes.error || simuladosRes.error || dailyCheckinsRes.error;
  if (error) throw error;

  const monthlyPlans = await hydrateMonthlyPlans(monthlyRes.data || []);
  const simulados = await hydrateSimulados(simuladosRes.data || []);

  return {
    mentorados: profilesRes.data || [],
    concursos: concursosRes.data || [],
    materiais: materiaisRes.data || [],
    monthlyPlans,
    monthlyItems: itemsRes.data || [],
    simulados,
    dailyCheckins: dailyCheckinsRes.data || []
  };
}

function optionLabel(plan, mentoradosMap) {
  const owner = mentoradosMap.get(plan.mentorado_id)?.nome || mentoradosMap.get(plan.mentorado_id)?.email || "Mentorado";
  return `${plan.titulo} - ${owner} - ${fmtPlanReference(plan.mes_referencia)}`;
}

async function handleAdminSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const type = form.dataset.form;
  const msg = form.querySelector("[data-form-message]");

  try {
    if (isDemoMode()) {
      const data = loadDemoData();

      if (type === "concurso-create") {
        data.concursos.unshift({
          id: `demo-concurso-${Date.now()}`,
          nome: formData.get("nome"),
          cargo: formData.get("cargo") || null,
          orgao: formData.get("orgao") || null,
          descricao: formData.get("descricao") || null,
          status: formData.get("status") || "ativo",
          created_at: new Date().toISOString()
        });
      }

      if (type === "mentorado-update") {
        const current = data.mentorados.find((item) => item.id === formData.get("mentorado_id"));
        if (current) {
          current.nome = formData.get("nome");
          current.concurso_id = formData.get("concurso_id") || null;
          current.ativo = formData.get("ativo") === "true";
          if (data.profiles.mentorado.id === current.id) {
            data.profiles.mentorado.nome = current.nome;
            data.profiles.mentorado.concurso_id = current.concurso_id;
            const concurso = data.concursos.find((item) => item.id === current.concurso_id);
            data.profiles.mentorado.concursos = concurso ? { id: concurso.id, nome: concurso.nome } : null;
          }
        }
      }

      if (type === "material-create") {
        const visibilidade = formData.get("visibilidade") || "concurso";
        data.materiais.unshift({
          id: `demo-material-${Date.now()}`,
          titulo: formData.get("titulo"),
          descricao: formData.get("descricao") || null,
          tipo: formData.get("tipo") || "material",
          visibilidade,
          concurso_id: visibilidade === "concurso" ? (formData.get("concurso_id") || null) : null,
          mentorado_id: visibilidade === "aluno" ? (formData.get("mentorado_id") || null) : null,
          externo_url: formData.get("externo_url") || null,
          file_path: formData.get("file_path") || null,
          created_at: new Date().toISOString()
        });
      }

      if (type === "plano-mensal-create") {
        data.monthlyPlans.unshift({
          id: `demo-plano-${Date.now()}`,
          mentorado_id: formData.get("mentorado_id"),
          titulo: formData.get("titulo"),
          descricao: formData.get("descricao") || null,
          mes_referencia: formData.get("mes_referencia"),
          status: formData.get("status") || "ativo",
          pdf_url: formData.get("pdf_url") || null,
          pdf_path: formData.get("pdf_path") || null
        });
      }

      if (type === "plano-item-create") {
        const plan = data.monthlyPlans.find((item) => item.id === formData.get("plano_id"));
        data.monthlyItems.unshift({
          id: `demo-item-${Date.now()}`,
          plano_id: formData.get("plano_id"),
          mentorado_id: plan?.mentorado_id || data.profiles.mentorado.id,
          titulo: formData.get("titulo"),
          descricao: formData.get("descricao") || null,
          tipo: formData.get("tipo") || "teoria",
          data_prevista: formData.get("data_prevista") || null,
          dia_semana: formData.get("dia_semana") === "" ? null : Number(formData.get("dia_semana")),
          ordem: Number(formData.get("ordem") || 0),
          tec_url: formData.get("tec_url") || null,
          material_url: formData.get("material_url") || null,
          concluida: false
        });
      }


      if (type === "plano-items-bulk-import") {
        const planId = formData.get("plano_id");
        const plan = data.monthlyPlans.find((item) => item.id === planId);
        if (!plan) throw new Error("Selecione um plano válido.");
        const importedItems = parsePlanItemsImport(formData.get("import_text"));
        if (!importedItems.length) throw new Error("Nenhuma meta válida para importar.");
        const currentMaxOrder = Math.max(0, ...data.monthlyItems.filter((item) => item.plano_id === planId).map((item) => Number(item.ordem || 0)));
        importedItems.forEach((item, index) => {
          data.monthlyItems.push({
            id: `demo-item-${Date.now()}-${index}`,
            plano_id: planId,
            mentorado_id: plan.mentorado_id,
            ...item,
            ordem: item.ordem || currentMaxOrder + index + 1,
            concluida: false,
            concluida_em: null
          });
        });
      }

      if (type === "simulado-create") {
        data.simulados.unshift({
          id: `demo-simulado-${Date.now()}`,
          mentorado_id: formData.get("mentorado_id"),
          concurso_id: formData.get("concurso_id") || null,
          titulo: formData.get("titulo"),
          data_aplicacao: formData.get("data_aplicacao") || null,
          acertos: Number(formData.get("acertos") || 0),
          total_questoes: Number(formData.get("total_questoes") || 0),
          observacoes: formData.get("observacoes") || null,
          pdf_url: formData.get("pdf_url") || null,
          pdf_path: formData.get("pdf_path") || null
        });
      }

      saveDemoData(data);
      form.reset();
      setMessage(msg, "Salvo com sucesso no modo demo.", "success");
      await renderAdminPage();
      return;
    }

    const { ensureSupabase } = await loadSupabaseModule();
    const client = ensureSupabase();

    if (type === "concurso-create") {
      const { error } = await client.from("concursos").insert({
        nome: formData.get("nome"),
        cargo: formData.get("cargo") || null,
        orgao: formData.get("orgao") || null,
        descricao: formData.get("descricao") || null,
        status: formData.get("status") || "ativo"
      });
      if (error) throw error;
    }

    if (type === "mentorado-update") {
      const { error } = await client.from("profiles").update({
        nome: formData.get("nome"),
        concurso_id: formData.get("concurso_id") || null,
        ativo: formData.get("ativo") === "true"
      }).eq("id", formData.get("mentorado_id"));
      if (error) throw error;
    }

    if (type === "material-create") {
      const visibilidade = formData.get("visibilidade") || "concurso";
      const payload = {
        titulo: formData.get("titulo"),
        descricao: formData.get("descricao") || null,
        tipo: formData.get("tipo") || "material",
        visibilidade,
        concurso_id: visibilidade === "concurso" ? (formData.get("concurso_id") || null) : null,
        mentorado_id: visibilidade === "aluno" ? (formData.get("mentorado_id") || null) : null,
        externo_url: formData.get("externo_url") || null,
        file_path: formData.get("file_path") || null
      };
      const { error } = await client.from("materiais").insert(payload);
      if (error) throw error;
    }

    if (type === "plano-mensal-create") {
      const { error } = await client.from("planos_mensais").insert({
        mentorado_id: formData.get("mentorado_id"),
        titulo: formData.get("titulo"),
        descricao: formData.get("descricao") || null,
        mes_referencia: formData.get("mes_referencia"),
        status: formData.get("status") || "ativo",
        pdf_url: formData.get("pdf_url") || null,
        pdf_path: formData.get("pdf_path") || null
      });
      if (error) throw error;
    }

    if (type === "plano-item-create") {
      const { error } = await client.from("plano_itens").insert({
        plano_id: formData.get("plano_id"),
        titulo: formData.get("titulo"),
        descricao: formData.get("descricao") || null,
        tipo: formData.get("tipo") || "teoria",
        data_prevista: formData.get("data_prevista") || null,
        dia_semana: formData.get("dia_semana") === "" ? null : Number(formData.get("dia_semana")),
        ordem: Number(formData.get("ordem") || 0),
        tec_url: formData.get("tec_url") || null,
        material_url: formData.get("material_url") || null
      });
      if (error) throw error;
    }

    if (type === "plano-items-bulk-import") {
      const importedItems = parsePlanItemsImport(formData.get("import_text"));
      if (!importedItems.length) throw new Error("Nenhuma meta válida para importar.");
      const planId = formData.get("plano_id");
      const payload = importedItems.map((item) => ({ plano_id: planId, ...item }));
      const { error } = await client.from("plano_itens").insert(payload);
      if (error) throw error;
    }

    if (type === "simulado-create") {
      const { error } = await client.from("simulados").insert({
        mentorado_id: formData.get("mentorado_id"),
        concurso_id: formData.get("concurso_id") || null,
        titulo: formData.get("titulo"),
        data_aplicacao: formData.get("data_aplicacao") || null,
        acertos: Number(formData.get("acertos") || 0),
        total_questoes: Number(formData.get("total_questoes") || 0),
        observacoes: formData.get("observacoes") || null,
        pdf_url: formData.get("pdf_url") || null,
        pdf_path: formData.get("pdf_path") || null
      });
      if (error) throw error;
    }

    form.reset();
    setMessage(msg, "Salvo com sucesso.", "success");
    await renderAdminPage();
  } catch (error) {
    setMessage(msg, error?.message || "Nao foi possivel salvar.", "error");
  }
}

async function renderAdminPage() {
  showLoading("Carregando painel do mentor...");
  const data = await fetchAdminData();
  const mentoradosMap = new Map(data.mentorados.map((m) => [m.id, m]));
  const concursosMap  = new Map(data.concursos.map((c)  => [c.id, c]));
  const plans         = buildPlans(data.monthlyPlans, data.monthlyItems);
  const mentorKpis    = buildMentorKpis(data, data.mentorados, plans, concursosMap);
  const mentorSnapshot = buildMentorDashboardSnapshot(data, mentorKpis);
  const observationRows    = buildObservationRows(data.dailyCheckins, data.mentorados, concursosMap);
  const latestObservations = buildLatestObservationByMentorado(observationRows);
  const adminPlanMonitorHtml = renderAdminPlanMonitor(plans, mentoradosMap);

  // ── Today's check-ins per student ─────────────────────────────
  const todayIso        = isoToday();
  const todayCheckinMap = new Map(
    data.dailyCheckins.filter((c) => c.referencia === todayIso).map((c) => [c.mentorado_id, c])
  );

  const todayStudentCards = data.mentorados.map((m) => {
    const kpi     = mentorKpis.find((k) => k.mentoradoId === m.id);
    const checkin = todayCheckinMap.get(m.id);
    return `<article class="card mentor-student-card">
      <div class="mentor-student-head">
        <strong>${esc(m.nome || m.email)}</strong>
        <span class="badge ${checkin ? "green" : "orange"}">${checkin ? "✓ Check-in" : "◌ Sem check-in"}</span>
      </div>
      <div class="mentor-student-concurso">${esc(concursosMap.get(m.concurso_id)?.nome || "Sem concurso")}</div>
      ${checkin ? `
        <div class="mentor-student-metrics">
          <span><strong>${esc(fmtHours(checkin.horas_estudo))}</strong><small>horas</small></span>
          <span><strong>${esc(String(checkin.questoes_feitas || 0))}</strong><small>questões</small></span>
          <span><strong>${esc(fmtPct(checkin.questoes_certas, checkin.questoes_feitas))}</strong><small>acerto</small></span>
          <span><strong>${esc(String(checkin.pomodoros || 0))}</strong><small>pomos</small></span>
        </div>
        ${checkin.observacao ? `<p class="mentor-student-obs">"${esc(truncateText(checkin.observacao, 90))}"</p>` : ""}
      ` : `<p class="mentor-student-obs is-muted">Nenhum registro hoje ainda.</p>`}
      ${kpi ? `<div class="badge-row" style="margin-top:.5rem;"><span class="badge ${kpi.rhythm.tone}">${esc(kpi.rhythm.label)}</span></div>` : ""}
    </article>`;
  }).join("") || `<div class="empty-state">Nenhum aluno cadastrado.</div>`;

  // ── Observations feeds ─────────────────────────────────────────
  const observationsFeedHtml = observationRows.slice(0, 10).map((item) =>
    `<div class="list-item">
      <strong>${esc(item.mentoradoNome)}</strong>
      <span>${esc(`${fmtDate(item.referencia)} · ${item.concursoNome}`)}</span>
      <p class="page-copy">${esc(item.observacao)}</p>
      <div class="badge-row" style="margin-top:.6rem;">
        <span class="badge blue">${esc(fmtHours(item.horas_estudo))}</span>
        <span class="badge blue">${esc(`${item.questoes_feitas || 0} questões`)}</span>
        <span class="badge green">${esc(fmtPct(item.questoes_certas, item.questoes_feitas))}</span>
      </div>
    </div>`
  ).join("") || `<div class="empty-state">As observações aparecem aqui quando os alunos salvam o check-in.</div>`;

  const latestObservationsHtml = latestObservations.map((item) =>
    `<div class="list-item">
      <strong>${esc(item.mentoradoNome)}</strong>
      <span>${esc(fmtDate(item.referencia))}</span>
      <p class="page-copy">${esc(item.observacao)}</p>
      <div class="badge-row" style="margin-top:.6rem;">
        <span class="badge gold">${esc(item.concursoNome)}</span>
        <span class="badge blue">${esc(`${item.metas_cumpridas || 0} metas`)}</span>
      </div>
    </div>`
  ).join("") || `<div class="empty-state">Nenhum aluno enviou observação ainda.</div>`;

  // ── Evolution table ────────────────────────────────────────────
  const evolutionTableRows = mentorKpis.map((item) => {
    const planLabel     = item.activePlan ? `${item.activePlan.completed}/${item.activePlan.items.length || 0} metas` : "Sem plano";
    const simuladoLabel = item.latestSimulado ? `${item.latestSimulado.acertos || 0}/${item.latestSimulado.total_questoes || 0}` : "--";
    return `<tr>
      <td><strong>${esc(item.nome)}</strong></td>
      <td>${esc(item.concursoNome)}</td>
      <td>${esc(item.lastCheckinAt ? fmtDate(item.lastCheckinAt) : "--")}</td>
      <td>${esc(fmtHours(item.horas7d))}</td>
      <td>${esc(String(item.questoes7d))}</td>
      <td>${esc(fmtPct(item.acertos7d, item.questoes7d))}</td>
      <td>${esc(String(item.metas7d))}</td>
      <td>${esc(planLabel)}</td>
      <td>${esc(simuladoLabel)}</td>
      <td><span class="badge ${item.rhythm.tone}">${esc(item.rhythm.label)}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" class="empty-state">Sem check-ins ainda.</td></tr>`;

  const evolutionCardsHtml   = renderMentorEvolutionCards(mentorKpis);
  const mentorPulseCardsHtml = renderMentorPulseCards(mentorKpis);
  const mentorOverviewMetrics = [
    { label: "Mentorados ativos na semana",   value: String(mentorSnapshot.mentoradosAtivos) },
    { label: "Check-ins nos últimos 7 dias",  value: String(mentorSnapshot.checkinsRecentes) },
    { label: "Questões do grupo em 7 dias",   value: String(mentorSnapshot.recentSnapshot.totalQuestoes) },
    { label: "Acerto do grupo em 7 dias",     value: `${mentorSnapshot.recentSnapshot.aproveitamento}%`, tone: "green" },
  ];

  // ═══════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════
  appContent.innerHTML = `
    <div class="admin-tabs">
      <button class="admin-tab is-active" data-tab="overview">📊 Visão Geral</button>
      <button class="admin-tab" data-tab="alunos">👥 Alunos</button>
      <button class="admin-tab" data-tab="conteudo">📚 Conteúdo</button>
      <button class="admin-tab" data-tab="relatorios">📈 Relatórios</button>
    </div>

    <\!-- ── TAB: VISÃO GERAL ─────────────────────────────────── -->
    <div class="admin-section is-active" data-section="overview">
      <section class="grid-4">
        <article class="card stat-card">
          <div class="stat-value">${esc(String(data.mentorados.length))}</div>
          <div class="stat-label">Mentorados</div>
        </article>
        <article class="card stat-card">
          <div class="stat-value">${esc(String(mentorSnapshot.mentoradosAtivos))}</div>
          <div class="stat-label">Ativos esta semana</div>
        </article>
        <article class="card stat-card">
          <div class="stat-value">${esc(`${mentorSnapshot.aproveitamento}%`)}</div>
          <div class="stat-label">Acerto do grupo</div>
        </article>
        <article class="card stat-card">
          <div class="stat-value">${esc(String(mentorSnapshot.checkinsRecentes))}</div>
          <div class="stat-label">Check-ins (7 dias)</div>
        </article>
      </section>

      <section style="margin-top:1.5rem;">
        <div class="card-head" style="margin-bottom:.8rem;">
          <h2 class="card-title">Alunos hoje — ${esc(fmtDate(todayIso))}</h2>
          <span class="badge gold">${esc(String(todayCheckinMap.size))}/${esc(String(data.mentorados.length))} check-ins</span>
        </div>
        <div class="mentor-today-grid">${todayStudentCards}</div>
      </section>

      <section class="grid-2" style="margin-top:1.5rem;">
        <article class="card">
          <div class="card-head">
            <div>
              <h2 class="card-title">Últimas mensagens</h2>
              <p class="page-copy">O que os alunos relataram nos check-ins.</p>
            </div>
            <span class="badge gold">${esc(String(observationRows.length))}</span>
          </div>
          <div class="list">${observationsFeedHtml}</div>
        </article>
        <article class="card">
          <div class="card-head">
            <div>
              <h2 class="card-title">Última por aluno</h2>
              <p class="page-copy">Mensagem mais recente de cada mentorado.</p>
            </div>
            <span class="badge gold">${esc(String(latestObservations.length))}</span>
          </div>
          <div class="list">${latestObservationsHtml}</div>
        </article>
      </section>
    </div>

    <\!-- ── TAB: ALUNOS ──────────────────────────────────────── -->
    <div class="admin-section" data-section="alunos">
      <section class="grid-2">
        <article class="card">
          <div class="card-head"><h2 class="card-title">Editar mentorado</h2></div>
          <form class="form-grid" data-form="mentorado-update">
            <label>
              <span class="field-label">Selecionar aluno</span>
              <select class="select" name="mentorado_id" required>
                <option value="">— Selecione —</option>
                ${data.mentorados.map((m) => `<option value="${esc(m.id)}">${esc(m.nome || m.email)}</option>`).join("")}
              </select>
            </label>
            <label><span class="field-label">Nome</span><input class="input" name="nome" type="text" required></label>
            <label>
              <span class="field-label">Concurso</span>
              <select class="select" name="concurso_id">
                <option value="">Sem vínculo</option>
                ${data.concursos.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}
              </select>
            </label>
            <label>
              <span class="field-label">Ativo</span>
              <select class="select" name="ativo">
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            </label>
            <button class="button button-primary" type="submit">Salvar alterações</button>
            <div class="message" data-form-message></div>
          </form>
        </article>
        <article class="card">
          <div class="card-head">
            <h2 class="card-title">Mentorados</h2>
            <span class="badge gold">${esc(String(data.mentorados.length))}</span>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Nome</th><th>Email</th><th>Concurso</th><th>Status</th></tr></thead>
              <tbody>
                ${data.mentorados.map((m) => `
                  <tr>
                    <td><strong>${esc(m.nome || "--")}</strong></td>
                    <td>${esc(m.email || "--")}</td>
                    <td>${esc(concursosMap.get(m.concurso_id)?.nome || "Não vinculado")}</td>
                    <td><span class="badge ${m.ativo ? "green" : "orange"}">${esc(m.ativo ? "Ativo" : "Inativo")}</span></td>
                  </tr>
                `).join("") || `<tr><td colspan="4" class="empty-state">Nenhum mentorado.</td></tr>`}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section class="grid-2" style="margin-top:1rem;">
        <article class="card">
          <div class="card-head"><h2 class="card-title">Novo concurso</h2></div>
          <form class="form-grid" data-form="concurso-create">
            <label><span class="field-label">Nome</span><input class="input" name="nome" type="text" required></label>
            <label><span class="field-label">Cargo</span><input class="input" name="cargo" type="text"></label>
            <label><span class="field-label">Órgão</span><input class="input" name="orgao" type="text"></label>
            <label>
              <span class="field-label">Status</span>
              <select class="select" name="status">
                <option value="ativo">Ativo</option>
                <option value="arquivado">Arquivado</option>
              </select>
            </label>
            <label><span class="field-label">Descrição</span><textarea class="textarea" name="descricao" rows="2"></textarea></label>
            <button class="button button-primary" type="submit">Criar concurso</button>
            <div class="message" data-form-message></div>
          </form>
        </article>
        <article class="card">
          <div class="card-head">
            <h2 class="card-title">Concursos</h2>
            <span class="badge gold">${esc(String(data.concursos.length))}</span>
          </div>
          <div class="list">
            ${data.concursos.map((c) => `
              <div class="list-item">
                <strong>${esc(c.nome)}</strong>
                <span>${esc([c.cargo, c.orgao].filter(Boolean).join(" — ") || "Sem detalhes.")}</span>
                <div class="badge-row" style="margin-top:.5rem;">
                  <span class="badge ${badgeClass(c.status)}">${esc(c.status)}</span>
                </div>
              </div>
            `).join("") || `<div class="empty-state">Nenhum concurso cadastrado ainda.</div>`}
          </div>
        </article>
      </section>
    </div>

    <\!-- ── TAB: CONTEÚDO ────────────────────────────────────── -->
    <div class="admin-section" data-section="conteudo">
      <div class="admin-subtabs">
        <button class="admin-subtab is-active" data-subtab="materiais">Materiais</button>
        <button class="admin-subtab" data-subtab="planos">Planos de estudo</button>
        <button class="admin-subtab" data-subtab="metas">Metas do plano</button>
        <button class="admin-subtab" data-subtab="simulados">Simulados</button>
      </div>

      <\!-- Materiais -->
      <div class="admin-subsection is-active" data-subsection="materiais">
        <section class="grid-2" style="margin-top:1rem;">
          <article class="card">
            <div class="card-head"><h2 class="card-title">Publicar material</h2></div>
            <form class="form-grid" data-form="material-create">
              <label><span class="field-label">Título</span><input class="input" name="titulo" type="text" required></label>
              <label>
                <span class="field-label">Tipo</span>
                <input class="input" name="tipo" type="text" placeholder="pdf, vídeo, questões, artigo...">
              </label>
              <label>
                <span class="field-label">Visibilidade</span>
                <select class="select" name="visibilidade">
                  <option value="concurso">Por concurso — todos do concurso recebem</option>
                  <option value="aluno">Por aluno — só um aluno específico</option>
                </select>
              </label>
              <label>
                <span class="field-label">Concurso</span>
                <select class="select" name="concurso_id">
                  <option value="">— Opcional —</option>
                  ${data.concursos.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}
                </select>
              </label>
              <label>
                <span class="field-label">Aluno específico</span>
                <select class="select" name="mentorado_id">
                  <option value="">— Opcional —</option>
                  ${data.mentorados.map((m) => `<option value="${esc(m.id)}">${esc(m.nome || m.email)}</option>`).join("")}
                </select>
              </label>
              <label><span class="field-label">URL do material</span><input class="input" name="externo_url" type="url" placeholder="https://..."></label>
              <label><span class="field-label">Descrição</span><textarea class="textarea" name="descricao" rows="2"></textarea></label>
              <button class="button button-primary" type="submit">Publicar material</button>
              <div class="message" data-form-message></div>
            </form>
          </article>
          <article class="card">
            <div class="card-head">
              <h2 class="card-title">Materiais publicados</h2>
              <span class="badge gold">${esc(String(data.materiais.length))}</span>
            </div>
            <div class="list">
              ${data.materiais.map((item) => `
                <div class="list-item">
                  <strong>${esc(item.titulo)}</strong>
                  <span>${esc(item.tipo || "—")}</span>
                  <div class="badge-row" style="margin-top:.5rem;">
                    <span class="badge gold">${esc(item.visibilidade)}</span>
                    <span class="badge blue">${esc(fmtDate(item.created_at?.slice?.(0, 10) || ""))}</span>
                  </div>
                </div>
              `).join("") || `<div class="empty-state">Nenhum material publicado ainda.</div>`}
            </div>
          </article>
        </section>
      </div>

      <\!-- Planos de estudo -->
      <div class="admin-subsection" data-subsection="planos">
        <section class="grid-2" style="margin-top:1rem;">
          <article class="card">
            <div class="card-head"><h2 class="card-title">Novo plano de estudos</h2></div>
            <form class="form-grid" data-form="plano-mensal-create">
              <label>
                <span class="field-label">Aluno</span>
                <select class="select" name="mentorado_id" required>
                  <option value="">— Selecione o aluno —</option>
                  ${data.mentorados.map((m) => `<option value="${esc(m.id)}">${esc(m.nome || m.email)}</option>`).join("")}
                </select>
              </label>
              <label><span class="field-label">Título</span><input class="input" name="titulo" type="text" placeholder="Plano completo TRF-3 V3" required></label>
              <label><span class="field-label">Data inicial do plano</span><input class="input" name="mes_referencia" type="date" required></label>
              <label>
                <span class="field-label">Status</span>
                <select class="select" name="status">
                  <option value="ativo">Ativo</option>
                  <option value="rascunho">Rascunho</option>
                  <option value="arquivado">Arquivado</option>
                </select>
              </label>
              <label><span class="field-label">URL do PDF (opcional)</span><input class="input" name="pdf_url" type="url"></label>
              <label><span class="field-label">Descrição</span><textarea class="textarea" name="descricao" rows="2"></textarea></label>
              <button class="button button-primary" type="submit">Criar plano</button>
              <div class="message" data-form-message></div>
            </form>
          </article>
          <article class="card">
            <div class="card-head">
              <h2 class="card-title">Planos recentes</h2>
              <span class="badge gold">${esc(String(plans.length))}</span>
            </div>
            <div class="list">
              ${plans.map((plan) => `
                <div class="list-item">
                  <strong>${esc(plan.titulo)}</strong>
                  <span>${esc(`${mentoradosMap.get(plan.mentorado_id)?.nome || "Aluno"} — ${fmtPlanReference(plan.mes_referencia)}`)}</span>
                  <div class="metric-bar" style="margin-top:.6rem;">
                    <span style="width:${esc(String(plan.progress))}%"></span>
                  </div>
                  <div class="badge-row" style="margin-top:.5rem;">
                    <span class="badge ${badgeClass(plan.status)}">${esc(plan.status)}</span>
                    <span class="badge gold">${esc(`${plan.completed}/${plan.items.length} metas`)}</span>
                  </div>
                  ${plan.resolved_pdf_url ? `<div class="inline-actions" style="margin-top:.8rem;"><a class="button button-secondary" href="${esc(plan.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a></div>` : ""}
                </div>
              `).join("") || `<div class="empty-state">Nenhum plano de estudos ainda.</div>`}
            </div>
          </article>
        </section>
      </div>

      <\!-- Metas do plano -->
      <div class="admin-subsection" data-subsection="metas">
        <section class="grid-2" style="margin-top:1rem;">
          <article class="card">
            <div class="card-head"><h2 class="card-title">Nova meta do plano</h2></div>
            <form class="form-grid" data-form="plano-item-create">
              <label>
                <span class="field-label">Plano de estudos</span>
                <select class="select" name="plano_id" required>
                  <option value="">— Selecione o plano —</option>
                  ${data.monthlyPlans.map((item) => `<option value="${esc(item.id)}">${esc(optionLabel(item, mentoradosMap))}</option>`).join("")}
                </select>
              </label>
              <label><span class="field-label">Título da meta</span><input class="input" name="titulo" type="text" required></label>
              <label>
                <span class="field-label">Tipo</span>
                <select class="select" name="tipo">
                  <option value="teoria">Teoria</option>
                  <option value="questoes">Questões</option>
                  <option value="revisao">Revisão</option>
                  <option value="simulado">Simulado</option>
                  <option value="redacao">Redação</option>
                  <option value="meta_plano">Meta do plano</option>
                </select>
              </label>
              <label><span class="field-label">Data prevista</span><input class="input" name="data_prevista" type="date"></label>
              <label>
                <span class="field-label">Dia da semana</span>
                <select class="select" name="dia_semana">
                  <option value="">— Opcional —</option>
                  ${dayLabels.map((label, i) => `<option value="${i}">${esc(label)}</option>`).join("")}
                </select>
              </label>
              <label><span class="field-label">Link TEC (opcional)</span><input class="input" name="tec_url" type="url"></label>
              <label><span class="field-label">Link complementar</span><input class="input" name="material_url" type="text"></label>
              <label><span class="field-label">Ordem</span><input class="input" name="ordem" type="number" min="0" value="1"></label>
              <button class="button button-primary" type="submit">Adicionar meta</button>
              <div class="message" data-form-message></div>
            </form>
          </article>
          <article class="card">
            <div class="card-head"><h2 class="card-title">Importar metas em lote</h2></div>
            <form class="form-grid" data-form="plano-items-bulk-import">
              <label>
                <span class="field-label">Plano de destino</span>
                <select class="select" name="plano_id" required>
                  <option value="">— Selecione o plano —</option>
                  ${data.monthlyPlans.map((item) => `<option value="${esc(item.id)}">${esc(optionLabel(item, mentoradosMap))}</option>`).join("")}
                </select>
              </label>
              <label>
                <span class="field-label">Metas</span>
                <textarea class="textarea" name="import_text" rows="12" placeholder="2026-03-30;1;diagnostico;B1 - Diagnóstico TR;20q TEC — Espécies de tributo"></textarea>
              </label>
              <button class="button button-primary" type="submit">Importar lote</button>
              <div class="message" data-form-message></div>
            </form>
          </article>
        </section>
        ${adminPlanMonitorHtml}
      </div>

      <\!-- Simulados -->
      <div class="admin-subsection" data-subsection="simulados">
        <section class="grid-2" style="margin-top:1rem;">
          <article class="card">
            <div class="card-head"><h2 class="card-title">Registrar simulado</h2></div>
            <form class="form-grid" data-form="simulado-create">
              <label>
                <span class="field-label">Aluno</span>
                <select class="select" name="mentorado_id" required>
                  <option value="">— Selecione o aluno —</option>
                  ${data.mentorados.map((m) => `<option value="${esc(m.id)}">${esc(m.nome || m.email)}</option>`).join("")}
                </select>
              </label>
              <label>
                <span class="field-label">Concurso</span>
                <select class="select" name="concurso_id">
                  <option value="">— Opcional —</option>
                  ${data.concursos.map((c) => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join("")}
                </select>
              </label>
              <label><span class="field-label">Título</span><input class="input" name="titulo" type="text" required></label>
              <label><span class="field-label">Data de aplicação</span><input class="input" name="data_aplicacao" type="date"></label>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;">
                <label><span class="field-label">Acertos</span><input class="input" name="acertos" type="number" min="0" value="0"></label>
                <label><span class="field-label">Total questões</span><input class="input" name="total_questoes" type="number" min="0" value="0"></label>
              </div>
              <label><span class="field-label">URL do PDF (opcional)</span><input class="input" name="pdf_url" type="url"></label>
              <label><span class="field-label">Observações</span><textarea class="textarea" name="observacoes" rows="2"></textarea></label>
              <button class="button button-primary" type="submit">Registrar simulado</button>
              <div class="message" data-form-message></div>
            </form>
          </article>
          <article class="card">
            <div class="card-head">
              <h2 class="card-title">Simulados recentes</h2>
              <span class="badge gold">${esc(String(data.simulados.length))}</span>
            </div>
            <div class="list">
              ${data.simulados.map((item) => `
                <div class="list-item">
                  <strong>${esc(item.titulo)}</strong>
                  <span>${esc(mentoradosMap.get(item.mentorado_id)?.nome || "Aluno")}</span>
                  <div class="badge-row" style="margin-top:.5rem;">
                    <span class="badge gold">${esc(fmtDate(item.data_aplicacao))}</span>
                    <span class="badge blue">${esc(`${item.acertos || 0}/${item.total_questoes || 0}`)}</span>
                  </div>
                  ${item.resolved_pdf_url ? `<div class="inline-actions" style="margin-top:.8rem;"><a class="button button-secondary" href="${esc(item.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a></div>` : ""}
                </div>
              `).join("") || `<div class="empty-state">Nenhum simulado ainda.</div>`}
            </div>
          </article>
        </section>
      </div>
    </div>

    <\!-- ── TAB: RELATÓRIOS ──────────────────────────────────── -->
    <div class="admin-section" data-section="relatorios">
      <section class="card performance-overview">
        <div class="card-head">
          <div>
            <h2 class="card-title">Pulso do grupo</h2>
            <p class="page-copy">Visão dinâmica do desempenho agregado, com foco em atividade recente, acerto e consistência.</p>
          </div>
          <span class="badge gold">${esc(String(mentorSnapshot.mentoradosAtivos))} ativos na semana</span>
        </div>
        <div class="performance-grid">
          <div class="performance-metrics">
            ${mentorOverviewMetrics.map((item) => `
              <article class="performance-stat">
                <span class="performance-stat-label">${esc(item.label)}</span>
                <strong class="performance-stat-value${item.tone ? ` is-${item.tone}` : ""}">${esc(item.value)}</strong>
              </article>
            `).join("")}
          </div>
          <article class="chart-panel">
            <div class="chart-panel-head"><strong>Aproveitamento do grupo</strong><span>${esc(`${mentorSnapshot.aproveitamento}%`)}</span></div>
            <div class="chart-panel-body donut-panel">${renderAccuracyDonut(mentorSnapshot)}</div>
            <div class="chart-legend">
              <span class="legend-item"><i class="legend-dot is-green"></i>${esc(`${mentorSnapshot.totalAcertos} acertos`)}</span>
              <span class="legend-item"><i class="legend-dot is-red"></i>${esc(`${mentorSnapshot.totalErros} erros`)}</span>
              <span class="legend-item"><i class="legend-dot is-gold"></i>${esc(`${mentorSnapshot.totalPomodoros} pomodoros`)}</span>
            </div>
          </article>
          <article class="chart-panel chart-panel-wide">
            <div class="chart-panel-head"><strong>Tendência do grupo</strong><span>últimos 14 dias</span></div>
            <div class="chart-panel-body">${renderRecentPerformanceChart(mentorSnapshot.trendSeries)}</div>
            <div class="chart-legend">
              <span class="legend-item"><i class="legend-dot is-gold"></i>Questões feitas</span>
              <span class="legend-item"><i class="legend-dot is-green"></i>Questões certas</span>
              <span class="legend-item">${esc(`${mentorSnapshot.recentSnapshot.totalHoras.toFixed(1)}h nas últimas 2 semanas`)}</span>
              <span class="legend-item">${esc(`${mentorSnapshot.metasRecentes} metas concluídas em 7 dias`)}</span>
            </div>
          </article>
        </div>
      </section>

      <section class="grid-2" style="margin-top:1rem;">
        <article class="card">
          <div class="card-head">
            <div>
              <h2 class="card-title">Acompanhamento por aluno</h2>
              <p class="page-copy">Check-in, horas, questões, acerto e ritmo nos últimos 7 dias.</p>
            </div>
            <span class="badge gold">7 dias</span>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Aluno</th><th>Concurso</th><th>Último check-in</th>
                  <th>Horas 7d</th><th>Questões 7d</th><th>Acerto 7d</th>
                  <th>Metas 7d</th><th>Plano</th><th>Simulado</th><th>Ritmo</th>
                </tr>
              </thead>
              <tbody>${evolutionTableRows}</tbody>
            </table>
          </div>
        </article>
        <article class="card">
          <div class="card-head">
            <div>
              <h2 class="card-title">Radar individual</h2>
              <p class="page-copy">Quem está constante, quem travou e quem precisa de ajuste.</p>
            </div>
            <span class="badge gold">${esc(String(mentorKpis.length))} alunos</span>
          </div>
          <div class="list">${evolutionCardsHtml}</div>
        </article>
      </section>

      <section class="card" style="margin-top:1rem;">
        <div class="card-head">
          <div>
            <h2 class="card-title">Termômetro por aluno</h2>
            <p class="page-copy">Mini histórico de atividade para identificar retomadas, quedas e ausências.</p>
          </div>
          <span class="badge gold">${esc(String(mentorKpis.length))} cards</span>
        </div>
        <div class="mentor-pulse-grid">${mentorPulseCardsHtml}</div>
      </section>
    </div>
  `;

  // ── Wire tab switching ────────────────────────────────────────
  appContent.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activateAdminSection(tab.dataset.tab);
    });
  });

  // ── Wire subtab switching ─────────────────────────────────────
  appContent.querySelectorAll(".admin-subtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const parent = btn.closest(".admin-section");
      activateAdminSection(parent?.dataset.section, btn.dataset.subtab);
    });
  });

  appContent.querySelectorAll("form[data-form]").forEach((form) => {
    form.addEventListener("submit", handleAdminSubmit);
  });
  wireAdminMentoradoForm(data.mentorados);
  wireAdminPlanDetailSelect();
  wireAdminPlanBulkActions();
}

function activateAdminSection(sectionName, subsectionName) {
  if (!sectionName) return;
  appContent.querySelectorAll(".admin-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === sectionName);
  });
  appContent.querySelectorAll(".admin-section").forEach((section) => {
    section.classList.toggle("is-active", section.dataset.section === sectionName);
  });

  if (!subsectionName) return;
  const section = appContent.querySelector(`.admin-section[data-section="${sectionName}"]`);
  section?.querySelectorAll(".admin-subtab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.subtab === subsectionName);
  });
  section?.querySelectorAll(".admin-subsection").forEach((subsection) => {
    subsection.classList.toggle("is-active", subsection.dataset.subsection === subsectionName);
  });
}

function wireAdminPlanBulkActions() {
  appContent.querySelectorAll("[data-admin-plan-complete-until]").forEach((form) => {
    form.addEventListener("submit", handleAdminPlanCompleteUntil);
  });
}

async function updateAdminPlanItemsCompletion(itemIds, checked, options = {}) {
  const ids = Array.from(new Set((itemIds || []).filter(Boolean)));
  if (!ids.length) throw new Error("Nenhuma meta encontrada para atualizar.");
  const timestamp = checked ? new Date().toISOString() : null;
  const { activePlanId, activeSection = "conteudo", activeSubsection = "metas" } = options;

  if (isDemoMode()) {
    const demo = loadDemoData();
    demo.monthlyItems.forEach((item) => {
      if (ids.includes(item.id)) {
        item.concluida = checked;
        item.concluida_em = timestamp;
      }
    });
    saveDemoData(demo);
    await renderAdminPage();
    activateAdminSection(activeSection, activeSubsection);
    if (activePlanId) {
      const select = document.getElementById("planDetailSelect");
      if (select) {
        select.value = activePlanId;
        select.dispatchEvent(new Event("change"));
      }
    }
    return;
  }

  const { ensureSupabase } = await loadSupabaseModule();
  const client = ensureSupabase();
  await updatePlanItemRows(client, ids, { concluida: checked, concluida_em: timestamp });
  await renderAdminPage();
  activateAdminSection(activeSection, activeSubsection);
  if (activePlanId) {
    const select = document.getElementById("planDetailSelect");
    if (select) {
      select.value = activePlanId;
      select.dispatchEvent(new Event("change"));
    }
  }
}

async function handleAdminPlanCompleteUntil(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const untilDate = new FormData(form).get("until_date");
  const messageNode = form.querySelector("[data-admin-plan-bulk-message]");

  if (!untilDate) {
    setMessage(messageNode, "Escolha uma data para concluir.", "error");
    return;
  }

  const panel = form.closest("[data-plan-detail-panel]");
  const activePlanId = panel?.dataset.planDetailPanel;
  const ids = Array.from(panel?.querySelectorAll("[data-admin-plan-item-id]") || [])
    .filter((row) => {
      const itemDate = row.dataset.adminPlanItemDate;
      return row.dataset.adminPlanItemDone !== "true" && itemDate && itemDate <= untilDate;
    })
    .map((row) => row.dataset.adminPlanItemId);

  if (!ids.length) {
    setMessage(messageNode, "Nenhuma meta pendente encontrada até essa data.", "success");
    return;
  }

  try {
    setMessage(messageNode, "Atualizando metas do aluno...", "");
    await updateAdminPlanItemsCompletion(ids, true, { activePlanId });
  } catch (error) {
    setMessage(messageNode, error?.message || "Nao foi possivel concluir as metas.", "error");
  }
}

function wireAdminMentoradoForm(mentorados) {
  const form = appContent.querySelector('form[data-form="mentorado-update"]');
  if (!form) return;

  const select = form.querySelector('select[name="mentorado_id"]');
  const nameInput = form.querySelector('input[name="nome"]');
  const concursoSelect = form.querySelector('select[name="concurso_id"]');
  const ativoSelect = form.querySelector('select[name="ativo"]');
  if (!select || !nameInput || !concursoSelect || !ativoSelect) return;

  const mentoradosMap = new Map((mentorados || []).map((item) => [item.id, item]));
  const applySelection = () => {
    const current = mentoradosMap.get(select.value);
    if (!current) return;
    nameInput.value = current.nome || "";
    concursoSelect.value = current.concurso_id || "";
    ativoSelect.value = current.ativo ? "true" : "false";
  };

  select.addEventListener("change", applySelection);
  if (select.value) applySelection();
}

async function updatePlanItemsCompletion(itemIds, checked, loadingMessage = "Atualizando plano...") {
  const ids = Array.from(new Set((itemIds || []).filter(Boolean)));
  if (!ids.length) throw new Error("Nenhuma meta encontrada para atualizar.");
  const timestamp = checked ? new Date().toISOString() : null;

  if (isDemoMode()) {
    const demo = loadDemoData();
    demo.monthlyItems.forEach((item) => {
      if (ids.includes(item.id)) {
        item.concluida = checked;
        item.concluida_em = timestamp;
      }
    });
    saveDemoData(demo);
    showLoading(loadingMessage);
    const data = await fetchMentoradoData();
    renderPlanPage(data);
    return;
  }

  const { ensureSupabase } = await loadSupabaseModule();
  const client = ensureSupabase();
  await updatePlanItemRows(client, ids, { concluida: checked, concluida_em: timestamp });

  showLoading(loadingMessage);
  const data = await fetchMentoradoData();
  renderPlanPage(data);
}

async function handlePlanDayComplete(event) {
  const button = event.currentTarget;
  const dateValue = button.dataset.planDayComplete;
  const group = button.closest("[data-plan-day-group]");
  const ids = Array.from(group?.querySelectorAll("[data-plan-item-toggle]") || [])
    .filter((checkbox) => !checkbox.checked)
    .map((checkbox) => checkbox.dataset.planItemToggle);

  button.disabled = true;

  try {
    await updatePlanItemsCompletion(ids, true, "Concluindo dia...");
  } catch (error) {
    window.alert(error?.message || `Nao foi possivel concluir o dia ${dateValue || ""}.`);
    button.disabled = false;
  }
}

async function handlePlanCompleteUntil(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const untilDate = new FormData(form).get("until_date");
  const messageNode = form.querySelector("[data-plan-bulk-message]");
  if (!untilDate) {
    setMessage(messageNode, "Escolha uma data para concluir.", "error");
    return;
  }

  const planSection = form.closest(".card");
  const ids = Array.from(planSection?.querySelectorAll("[data-plan-item-toggle]") || [])
    .filter((checkbox) => {
      const itemDate = checkbox.closest("[data-plan-day-group]")?.dataset.planDayGroup;
      return !checkbox.checked && itemDate && /^\d{4}-\d{2}-\d{2}$/.test(itemDate) && itemDate <= untilDate;
    })
    .map((checkbox) => checkbox.dataset.planItemToggle);

  if (!ids.length) {
    setMessage(messageNode, "Nenhuma meta pendente encontrada até essa data.", "success");
    return;
  }

  try {
    setMessage(messageNode, "Atualizando metas...", "");
    await updatePlanItemsCompletion(ids, true, "Concluindo metas...");
  } catch (error) {
    setMessage(messageNode, error?.message || "Nao foi possivel concluir as metas.", "error");
  }
}

async function handlePlanItemToggle(event) {
  const checkbox = event.currentTarget;
  const itemId = checkbox.dataset.planItemToggle;
  const checked = checkbox.checked;
  checkbox.disabled = true;

  try {
    await updatePlanItemsCompletion([itemId], checked, "Atualizando plano...");
  } catch (error) {
    checkbox.checked = !checked;
    window.alert(error?.message || "Nao foi possivel atualizar a meta.");
    checkbox.disabled = false;
  }
}

async function handleDailyCheckinSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const messageNode = form.querySelector("[data-checkin-message]");
  const referencia = formData.get("referencia");
  const payload = {
    referencia,
    horas_estudo: Number(formData.get("horas_estudo") || 0),
    questoes_feitas: Number(formData.get("questoes_feitas") || 0),
    questoes_certas: Number(formData.get("questoes_certas") || 0),
    pomodoros: Number(formData.get("pomodoros") || 0),
    metas_cumpridas: Number(formData.get("metas_cumpridas") || 0),
    observacao: formData.get("observacao") || null
  };

  try {
    setMessage(messageNode, "Salvando...", "");
    if (isDemoMode()) {
      const demo = loadDemoData();
      const profile = getDemoProfile();
      const mentoradoId = profile?.id;
      const currentCheckin = demo.dailyCheckins?.find((item) => item.mentorado_id === mentoradoId && item.referencia === referencia);
      const currentWeekly = demo.weekly.find((item) => item.mentorado_id === mentoradoId && item.referencia === referencia);
      const currentPomodoro = demo.pomodoro.find((item) => item.mentorado_id === mentoradoId && item.referencia === referencia);
      if (currentCheckin) Object.assign(currentCheckin, payload);
      else {
        demo.dailyCheckins = demo.dailyCheckins || [];
        demo.dailyCheckins.unshift({ id: `demo-checkin-${Date.now()}`, mentorado_id: mentoradoId, ...payload });
      }
      if (currentWeekly) Object.assign(currentWeekly, { horas: payload.horas_estudo, questoes: payload.questoes_feitas, acertos: payload.questoes_certas });
      else demo.weekly.unshift({ id: `demo-week-${Date.now()}`, mentorado_id: mentoradoId, referencia, horas: payload.horas_estudo, questoes: payload.questoes_feitas, acertos: payload.questoes_certas });
      if (currentPomodoro) Object.assign(currentPomodoro, { sessoes: payload.pomodoros, minutos: payload.pomodoros * 25 });
      else demo.pomodoro.unshift({ id: `demo-pomodoro-${Date.now()}`, mentorado_id: mentoradoId, referencia, sessoes: payload.pomodoros, minutos: payload.pomodoros * 25 });
      saveDemoData(demo);
    } else {
      const { ensureSupabase, getCurrentUser } = await loadSupabaseModule();
      const client = ensureSupabase();
      const user = await getCurrentUser();
      if (!user) throw new Error("Sessao expirada. Entre novamente.");
      await client.from("daily_checkins").upsert({ mentorado_id: user.id, ...payload }, { onConflict: "mentorado_id,referencia" });
      await client.from("weekly_logs").upsert({ mentorado_id: user.id, referencia, horas: payload.horas_estudo, questoes: payload.questoes_feitas, acertos: payload.questoes_certas }, { onConflict: "mentorado_id,referencia" });
      await client.from("pomodoro_logs").upsert({ mentorado_id: user.id, referencia, sessoes: payload.pomodoros, minutos: payload.pomodoros * 25 }, { onConflict: "mentorado_id,referencia" });
    }
    setMessage(messageNode, "Registro salvo com sucesso.", "success");
    renderEvolutionPage(await fetchMentoradoData());
  } catch (error) {
    setMessage(messageNode, error?.message || "Nao foi possivel salvar o dia.", "error");
  }
}

async function initLoginPage() {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const form = document.getElementById("loginForm");
  const message = document.getElementById("loginMessage");
  const button = document.getElementById("loginButton");

  if (isDemoMode()) {
    const existingDemoProfile = getDemoProfile();
    if (existingDemoProfile) {
      window.location.href = new URL(existingDemoProfile.role === "mentor" ? "./admin.html" : "./mentorado.html", window.location.href).href;
      return;
    }

    setMessage(message, "Modo demo ativo nesta pasta. Use `aluno@demo.local` ou `mentor@demo.local` com senha `demo`.", "success");
    const handleDemoLogin = async () => {
      setMessage(message, "", "");
      button.disabled = true;

      try {
        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;
        if (password !== "demo") {
          throw new Error("No modo demo, a senha e `demo`.");
        }
        if (email !== "aluno@demo.local" && email !== "mentor@demo.local") {
          throw new Error("Use `aluno@demo.local` ou `mentor@demo.local` no modo demo.");
        }

        setDemoSession(email === "mentor@demo.local" ? "mentor" : "mentorado");
        setMessage(message, "Login demo realizado. Redirecionando...", "success");
        const nextUrl = new URL(email === "mentor@demo.local" ? "./admin.html" : "./mentorado.html", window.location.href).href;
        window.location.href = nextUrl;
      } catch (error) {
        setMessage(message, error?.message || "Nao foi possivel fazer login demo.", "error");
      } finally {
        button.disabled = false;
      }
    };

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await handleDemoLogin();
    });
    button?.addEventListener("click", async (event) => {
      event.preventDefault();
      await handleDemoLogin();
    });
    return;
  }

  const { ensureSupabase, getProfile, redirectByRole, signInWithPassword, signOut } = await loadSupabaseModule();
  const client = ensureSupabase();

  const { data } = await client.auth.getSession();
  if (data.session) {
    const profile = await getProfile(data.session.user.id);
    return redirectByRole(profile);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage(message, "", "");
    button.disabled = true;

    try {
      const auth = await signInWithPassword(emailInput.value.trim(), passwordInput.value);
      const profile = await getProfile((auth.user || auth.session?.user).id);

      if (!profile?.ativo) {
        await signOut();
        throw new Error("Sua conta esta inativa. Fale com o Projeto Posse.");
      }

      setMessage(message, "Login realizado. Redirecionando...", "success");
      await redirectByRole(profile);
    } catch (error) {
      setMessage(message, error?.message || "Nao foi possivel fazer login.", "error");
    } finally {
      button.disabled = false;
    }
  });
}

async function requireProtectedPage() {
  if (isDemoMode()) {
    const profile = getDemoProfile();
    if (!profile) {
      window.location.href = getDemoLoginUrl();
      return false;
    }

    state.user = { id: profile.id, email: profile.email };
    state.profile = profile;
    setProfileUi(profile);

    if (requiredRole && profile.role !== requiredRole) {
      window.location.href = profile.role === "mentor" ? "./admin.html" : "./mentorado.html";
      return false;
    }

    logoutButton?.addEventListener("click", async () => {
      clearDemoSession();
      window.location.href = getDemoLoginUrl();
    });

    return true;
  }

  const { ensureSupabase, getCurrentUser, getProfile, signOut, redirectByRole } = await loadSupabaseModule();
  ensureSupabase();

  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "./login.html";
    return false;
  }

  const profile = await getProfile(user.id);
  if (!profile?.ativo) {
    await signOut();
    window.location.href = "./login.html";
    return false;
  }

  state.user = user;
  state.profile = profile;
  setProfileUi(profile);

  if (requiredRole && profile.role !== requiredRole) {
    await redirectByRole(profile);
    return false;
  }

  logoutButton?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "./login.html";
  });

  return true;
}

async function initProtectedPage() {
  if (!await requireProtectedPage()) return;
  initMobileNav();

  if (state.profile.role === "mentor") {
    await renderAdminPage();
    return;
  }

  showLoading();

  if (page === "study-methods") {
    if (methodSlug) renderStudyMethodDetail(methodSlug);
    else renderStudyMethodsHome();
    return;
  }

  const data = await fetchMentoradoData();

  if (page === "mentorado-dashboard") renderMentoradoDashboard(state.profile, data);
  if (page === "materials") renderMaterialsPage(data);
  if (page === "plan") renderPlanPage(data);
  if (page === "simulados") renderSimuladosPage(data);
  if (page === "evolution") renderEvolutionPage(data);
}

async function init() {
  try {
    const supabaseReady = isDemoMode() ? true : Boolean((await loadSupabaseModule()).supabase);
    if (!supabaseReady && !isDemoMode()) {
      if (page === "login") {
        setMessage(document.getElementById("loginMessage"), "Configure app/config.js com a URL e a anon key do Supabase.", "error");
        return;
      }
      showError(new Error("Configure app/config.js com a URL e a anon key do Supabase."));
      return;
    }

    if (page === "login") {
      await initLoginPage();
      return;
    }

    await initProtectedPage();
    if (page === "admin") {
      window.addEventListener("hashchange", syncAdminHashNav);
      syncAdminHashNav();
    }
  } catch (error) {
    console.error(error);
    showError(error);
  }
}

init();
