const body = document.body;
const page = body.dataset.page || "";
const requiredRole = body.dataset.role || "";
const appContent = document.getElementById("appContent");
const logoutButton = document.getElementById("logoutButton");
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
  if (!plan) return "Nenhum plano mensal cadastrado ainda.";
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
      activePlan,
      latestSimulado,
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
    if (item?.referencia) byDate.set(item.referencia, item);
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

function setMessage(node, text, type = "") {
  if (!node) return;
  node.textContent = text;
  node.className = type ? `message ${type}` : "message";
}

function setProfileUi(profile) {
  document.querySelectorAll("[data-profile-name]").forEach((node) => {
    node.textContent = profile?.nome || "Usuario";
  });
  document.querySelectorAll("[data-profile-role]").forEach((node) => {
    node.textContent = profile?.role === "mentor" ? "Mentor" : "Mentorado";
  });
  document.querySelectorAll(".nav-link[data-page]").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.page === page);
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

function renderMentoradoDashboard(profile, data) {
  const totalHoras = data.weekly.reduce((sum, item) => sum + Number(item.horas || 0), 0);
  const totalQuestoes = data.weekly.reduce((sum, item) => sum + Number(item.questoes || 0), 0);
  const totalAcertos = data.weekly.reduce((sum, item) => sum + Number(item.acertos || 0), 0);
  const totalPomodoros = data.pomodoro.reduce((sum, item) => sum + Number(item.sessoes || 0), 0);
  const currentPlan = data.monthlyCollection[0];
  const concursoNome = profile?.concursos?.nome || "Concurso nao informado";

  appContent.innerHTML = `<section class="grid-4"><article class="card stat-card"><div class="stat-value">${esc(fmtHours(totalHoras))}</div><div class="stat-label">Horas</div></article><article class="card stat-card"><div class="stat-value">${esc(String(totalQuestoes))}</div><div class="stat-label">Questoes</div></article><article class="card stat-card"><div class="stat-value">${esc(fmtPct(totalAcertos, totalQuestoes))}</div><div class="stat-label">Acerto</div></article><article class="card stat-card"><div class="stat-value">${esc(String(totalPomodoros))}</div><div class="stat-label">Pomodoros</div></article></section><section class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Seu foco principal</h2><span class="badge gold">${esc(concursoNome)}</span></div><p class="page-copy">Tudo nesta area e filtrado pelo seu concurso e pelas liberacoes individuais feitas pelos mentores.</p><div class="badge-row" style="margin-top:1rem;"><a class="button button-secondary" href="./materials.html">Ver materiais</a><a class="button button-secondary" href="./plano.html">Abrir plano</a></div></article><article class="card"><div class="card-head"><h2 class="card-title">Plano mensal</h2></div>${currentPlan ? `<strong>${esc(currentPlan.titulo)}</strong><p class="page-copy">${esc(fmtMonth(currentPlan.mes_referencia))}</p><div class="metric-bar" style="margin-top:1rem;"><span style="width:${esc(String(currentPlan.progress))}%"></span></div><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(`${currentPlan.completed}/${currentPlan.items.length} metas`)}</span><span class="badge ${badgeClass(currentPlan.status)}">${esc(currentPlan.status)}</span></div>${currentPlan.resolved_pdf_url ? `<div class="inline-actions" style="margin-top:1rem;"><a class="button button-secondary" href="${esc(currentPlan.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF do plano</a></div>` : ""}` : `<div class="empty-state">Nenhum plano mensal ativo ainda.</div>`}</article></section>`;
}

function renderMaterialsPage(data) {
  appContent.innerHTML = `<section class="card"><div class="card-head"><h2 class="card-title">Biblioteca do Mentorado</h2><span class="badge gold">${esc(String(data.materiais.length))} itens</span></div><div class="list">${data.materiais.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.descricao || "Sem descricao.")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(item.tipo || "Material")}</span><span class="badge blue">${esc(item.visibilidade || "aluno")}</span></div>${item.resolved_url ? `<div class="inline-actions" style="margin-top:1rem;"><a class="button button-secondary" href="${esc(item.resolved_url)}" target="_blank" rel="noopener noreferrer">Abrir material</a></div>` : item.file_path ? `<div class="message error" style="margin-top:1rem;">Arquivo vinculado, mas a URL assinada nao foi gerada. Verifique o bucket <strong>materiais</strong> e o caminho <strong>${esc(item.file_path)}</strong>.</div>` : ""}</div>`).join("") || `<div class="empty-state">Nenhum material disponivel para este perfil.</div>`}</div></section>`;
}

function renderPlanPage(data) {
  const monthlyHtml = data.monthlyCollection.map((plan) => {
    const groups = groupMonthlyItems(plan.items);
    const groupHtml = plan.items.length
      ? Array.from(groups.entries()).map(([label, rows]) => `<div class="plan-group"><h3 class="day-title">${esc(label)}</h3><div class="list">${rows.map((item) => `<article class="plan-task ${item.concluida ? "done" : ""}"><div class="plan-item"><input class="checkbox" type="checkbox" data-plan-item-toggle="${esc(item.id)}" ${item.concluida ? "checked" : ""}><div class="plan-task-main"><div class="badge-row"><span class="badge gold">${esc(item.tipo || "meta")}</span><span class="badge ${item.concluida ? "green" : "blue"}">${esc(item.concluida ? "Concluida" : "Pendente")}</span></div><strong class="plan-item-title" style="margin-top:.7rem;">${esc(item.titulo)}</strong><p class="plan-item-copy">${esc(item.descricao || "Sem descricao adicional.")}</p><div class="inline-actions">${item.tec_url ? `<a class="button button-secondary" href="${esc(item.tec_url)}" target="_blank" rel="noopener noreferrer">Abrir TEC</a>` : ""}${item.resolved_material_url ? `<a class="button button-secondary" href="${esc(item.resolved_material_url)}" target="_blank" rel="noopener noreferrer">${item.tipo === "meta_mensal" ? "Abrir meta mensal" : "Material complementar"}</a>` : item.material_url ? `<span class="message error">Material privado nao resolvido.</span>` : ""}</div></div></div></article>`).join("")}</div></div>`).join("")
      : `<div class="empty-state">Ainda nao existem metas cadastradas para este plano.</div>`;

    return `<section class="card"><div class="card-head"><div><h2 class="card-title">${esc(plan.titulo)}</h2><p class="page-copy">${esc(fmtMonth(plan.mes_referencia))}</p></div><div class="badge-row"><span class="badge ${badgeClass(plan.status)}">${esc(plan.status)}</span><span class="badge gold">${esc(`${plan.completed}/${plan.items.length} metas`)}</span></div></div>${plan.descricao ? `<p class="page-copy">${esc(plan.descricao)}</p>` : ""}${plan.resolved_pdf_url ? `<div class="inline-actions" style="margin-bottom:1rem;"><a class="button button-secondary" href="${esc(plan.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF do plano</a></div>` : plan.pdf_path ? `<div class="message error" style="margin-bottom:1rem;">PDF vinculado, mas a URL assinada nao foi gerada. Verifique o bucket <strong>materiais</strong> e o caminho <strong>${esc(plan.pdf_path)}</strong>.</div>` : ""}<div class="metric-bar" style="margin-top:1rem;"><span style="width:${esc(String(plan.progress))}%"></span></div><div class="list" style="margin-top:1rem;">${groupHtml}</div></section>`;
  }).join("");

  const legacyHtml = data.planosLegacy.length
    ? `<section class="card" style="margin-top:1rem;"><div class="card-head"><h2 class="card-title">Rotina semanal</h2><span class="badge gold">Apoio</span></div><div class="list">${data.planosLegacy.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.descricao || dayLabels[Number(item.dia_semana || 0)] || "Sem dia")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge ${badgeClass(item.status)}">${esc(item.status || "pendente")}</span></div></div>`).join("")}</div></section>`
    : "";

  appContent.innerHTML = `${monthlyHtml || `<section class="card"><div class="empty-state">Nenhum plano mensal ativo ainda.</div></section>`}${legacyHtml}`;
  appContent.querySelectorAll("[data-plan-item-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", handlePlanItemToggle);
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

  appContent.innerHTML = `<section class="card performance-overview"><div class="card-head"><div><h2 class="card-title">Desempenho Geral</h2><p class="page-copy">Painel consolidado para acompanhar volume, aproveitamento e constancia ao longo da preparacao.</p></div><span class="badge gold">${esc(String(checkins.length))} registros</span></div><div class="performance-grid"><div class="performance-metrics">${performanceMetrics.map((item) => `<article class="performance-stat"><span class="performance-stat-label">${esc(item.label)}</span><strong class="performance-stat-value${item.tone ? ` is-${item.tone}` : ""}">${esc(item.value)}</strong></article>`).join("")}</div><article class="chart-panel"><div class="chart-panel-head"><strong>Aproveitamento geral</strong><span>${esc(`${snapshot.aproveitamento}%`)}</span></div><div class="chart-panel-body donut-panel">${renderAccuracyDonut(snapshot)}</div><div class="chart-legend"><span class="legend-item"><i class="legend-dot is-green"></i>${esc(`${snapshot.totalAcertos} acertos`)}</span><span class="legend-item"><i class="legend-dot is-red"></i>${esc(`${snapshot.totalErros} erros`)}</span><span class="legend-item"><i class="legend-dot is-gold"></i>${esc(`${snapshot.diasAtivos} dias ativos`)}</span></div></article><article class="chart-panel chart-panel-wide"><div class="chart-panel-head"><strong>Evolucao recente</strong><span>ultimos 14 dias</span></div><div class="chart-panel-body">${renderRecentPerformanceChart(snapshot.recentSeries)}</div><div class="chart-legend"><span class="legend-item"><i class="legend-dot is-gold"></i>Questoes feitas</span><span class="legend-item"><i class="legend-dot is-green"></i>Questoes certas</span><span class="legend-item">${esc(snapshot.bestDay ? `Melhor dia: ${snapshot.bestDay.questoes} questoes em ${shortDateLabel(snapshot.bestDay.referencia)}` : "Sem pico de questoes ainda")}</span><span class="legend-item">${esc(`${snapshot.totalPomodoros} pomodoros acumulados`)}</span></div></article></div></section><section class="grid-4" style="margin-top:1rem;"><article class="card stat-card"><div class="stat-value">${esc(String(sumBy(last7, "questoes_feitas")))}</div><div class="stat-label">Questoes 7 dias</div><div class="stat-help">Volume recente resolvido.</div></article><article class="card stat-card"><div class="stat-value">${esc(fmtPct(sumBy(last7, "questoes_certas"), sumBy(last7, "questoes_feitas")))}</div><div class="stat-label">Acerto 7 dias</div><div class="stat-help">Percentual de aproveitamento.</div></article><article class="card stat-card"><div class="stat-value">${esc(fmtHours(sumBy(last7, "horas_estudo")))}</div><div class="stat-label">Horas 7 dias</div><div class="stat-help">Horas declaradas pelo aluno.</div></article><article class="card stat-card"><div class="stat-value">${esc(String(metas7.length))}</div><div class="stat-label">Metas cumpridas</div><div class="stat-help">Ultimos 7 dias.</div></article></section><section class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Registro do Dia</h2><span class="badge gold">${esc(fmtDate(isoToday()))}</span></div><form class="form-grid" id="dailyCheckinForm"><label><span class="field-label">Data</span><input class="input" name="referencia" type="date" value="${esc(today?.referencia || isoToday())}" required></label><label><span class="field-label">Horas estudadas</span><input class="input" name="horas_estudo" type="number" step="0.5" min="0" value="${esc(String(today?.horas_estudo ?? today?.horas ?? 0))}"></label><label><span class="field-label">Questoes feitas</span><input class="input" name="questoes_feitas" type="number" min="0" value="${esc(String(today?.questoes_feitas ?? today?.questoes ?? 0))}"></label><label><span class="field-label">Questoes certas</span><input class="input" name="questoes_certas" type="number" min="0" value="${esc(String(today?.questoes_certas ?? today?.acertos ?? 0))}"></label><label><span class="field-label">Pomodoros</span><input class="input" name="pomodoros" type="number" min="0" value="${esc(String(today?.pomodoros ?? 0))}"></label><label><span class="field-label">Metas cumpridas</span><input class="input" name="metas_cumpridas" type="number" min="0" value="${esc(String(today?.metas_cumpridas ?? 0))}"></label><label><span class="field-label">Observacao do dia</span><textarea class="textarea" name="observacao" placeholder="Como foi o dia, onde travou, o que funcionou melhor.">${esc(today?.observacao || "")}</textarea></label><button class="button button-primary" type="submit">Salvar meu dia</button><div class="message" data-checkin-message></div></form></article><article class="card"><div class="card-head"><h2 class="card-title">Metas concluidas recentemente</h2></div><div class="list">${recentGoals.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.descricao || "Meta concluida no plano mensal.")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(item.tipo || "meta")}</span><span class="badge green">${esc(fmtDateTime(item.concluida_em))}</span></div></div>`).join("") || `<div class="empty-state">Nenhuma meta concluida nos ultimos 7 dias.</div>`}</div></article></section><section class="card" style="margin-top:1rem;"><div class="card-head"><h2 class="card-title">Historico diario</h2><span class="badge gold">${esc(String(checkins.length))} registros</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Horas</th><th>Questoes</th><th>Acertos</th><th>%</th><th>Pomodoros</th><th>Metas</th></tr></thead><tbody>${checkins.map((item) => `<tr><td>${esc(fmtDate(item.referencia))}</td><td>${esc(fmtHours(item.horas_estudo ?? item.horas))}</td><td>${esc(String(item.questoes_feitas ?? item.questoes ?? 0))}</td><td>${esc(String(item.questoes_certas ?? item.acertos ?? 0))}</td><td>${esc(fmtPct(item.questoes_certas ?? item.acertos, item.questoes_feitas ?? item.questoes))}</td><td>${esc(String(item.pomodoros ?? 0))}</td><td>${esc(String(item.metas_cumpridas ?? 0))}</td></tr>`).join("") || `<tr><td colspan="7" class="empty-state">Nenhum registro diario encontrado.</td></tr>`}</tbody></table></div></section>`;

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
    client.from("planos_mensais").select("id,mentorado_id,titulo,descricao,mes_referencia,status,pdf_url,pdf_path").order("mes_referencia", { ascending: false }).limit(24),
    client.from("plano_itens").select("id,plano_id,mentorado_id,titulo,descricao,tipo,data_prevista,dia_semana,ordem,concluida,concluida_em,tec_url,material_url").order("created_at", { ascending: false }).limit(60),
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
  return `${plan.titulo} - ${owner} - ${fmtMonth(plan.mes_referencia)}`;
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
  const mentoradosMap = new Map(data.mentorados.map((item) => [item.id, item]));
  const concursosMap = new Map(data.concursos.map((item) => [item.id, item]));
  const plans = buildPlans(data.monthlyPlans, data.monthlyItems);
  const mentorKpis = buildMentorKpis(data, data.mentorados, plans, concursosMap);
  const observationRows = buildObservationRows(data.dailyCheckins, data.mentorados, concursosMap);
  const latestObservations = buildLatestObservationByMentorado(observationRows);
  const evolutionTableRows = mentorKpis.map((item) => {
    const planLabel = item.activePlan
      ? `${item.activePlan.completed}/${item.activePlan.items.length || 0} metas`
      : "Sem plano";
    const simuladoLabel = item.latestSimulado
      ? `${item.latestSimulado.acertos || 0}/${item.latestSimulado.total_questoes || 0}`
      : "--";
    return `<tr><td><strong>${esc(item.nome)}</strong></td><td>${esc(item.concursoNome)}</td><td>${esc(item.lastCheckinAt ? fmtDate(item.lastCheckinAt) : "--")}</td><td>${esc(fmtHours(item.horas7d))}</td><td>${esc(String(item.questoes7d))}</td><td>${esc(fmtPct(item.acertos7d, item.questoes7d))}</td><td>${esc(String(item.metas7d))}</td><td>${esc(planLabel)}</td><td>${esc(simuladoLabel)}</td><td><span class="badge ${item.rhythm.tone}">${esc(item.rhythm.label)}</span></td></tr>`;
  }).join("") || `<tr><td colspan="10" class="empty-state">Sem check-ins diarios ainda.</td></tr>`;
  const evolutionCardsHtml = renderMentorEvolutionCards(mentorKpis);
  const observationsFeedHtml = observationRows.slice(0, 12).map((item) => `<div class="list-item"><strong>${esc(item.mentoradoNome)}</strong><span>${esc(`${fmtDate(item.referencia)} • ${item.concursoNome}`)}</span><p class="page-copy">${esc(item.observacao)}</p><div class="badge-row" style="margin-top:.8rem;"><span class="badge blue">${esc(fmtHours(item.horas_estudo))}</span><span class="badge blue">${esc(`${item.questoes_feitas || 0} questoes`)}</span><span class="badge green">${esc(fmtPct(item.questoes_certas, item.questoes_feitas))}</span></div></div>`).join("") || `<div class="empty-state">As observacoes vao aparecer aqui quando os alunos salvarem o check-in diario.</div>`;
  const latestObservationsHtml = latestObservations.map((item) => `<div class="list-item"><strong>${esc(item.mentoradoNome)}</strong><span>${esc(fmtDate(item.referencia))}</span><p class="page-copy">${esc(item.observacao)}</p><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(item.concursoNome)}</span><span class="badge blue">${esc(`${item.metas_cumpridas || 0} metas`)}</span></div></div>`).join("") || `<div class="empty-state">Nenhum mentorado enviou observacao ainda.</div>`;

  appContent.innerHTML = `<section class="grid-4"><article class="card stat-card"><div class="stat-value">${esc(String(data.mentorados.length))}</div><div class="stat-label">Mentorados</div></article><article class="card stat-card"><div class="stat-value">${esc(String(data.concursos.length))}</div><div class="stat-label">Concursos</div></article><article class="card stat-card"><div class="stat-value">${esc(String(data.materiais.length))}</div><div class="stat-label">Materiais recentes</div></article><article class="card stat-card"><div class="stat-value">${esc(String(data.monthlyItems.length))}</div><div class="stat-label">Metas do mes</div></article></section><section id="sec-mentorados" class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Ajustar Mentorado</h2></div><form class="form-grid" data-form="mentorado-update"><label><span class="field-label">Mentorado</span><select class="select" name="mentorado_id" required><option value="">Selecione</option>${data.mentorados.map((item) => `<option value="${esc(item.id)}">${esc(item.nome || item.email)}</option>`).join("")}</select></label><label><span class="field-label">Nome</span><input class="input" name="nome" type="text" required></label><label><span class="field-label">Concurso</span><select class="select" name="concurso_id"><option value="">Sem vinculo</option>${data.concursos.map((item) => `<option value="${esc(item.id)}">${esc(item.nome)}</option>`).join("")}</select></label><label><span class="field-label">Ativo</span><select class="select" name="ativo"><option value="true">Sim</option><option value="false">Nao</option></select></label><button class="button button-primary" type="submit">Salvar mentorado</button><div class="message" data-form-message></div></form></article><article class="card"><div class="card-head"><h2 class="card-title">Mentorados cadastrados</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>Email</th><th>Concurso</th><th>Status</th></tr></thead><tbody>${data.mentorados.map((item) => `<tr><td>${esc(item.nome || "--")}</td><td>${esc(item.email || "--")}</td><td>${esc(concursosMap.get(item.concurso_id)?.nome || "Nao vinculado")}</td><td>${esc(item.ativo ? "Ativo" : "Inativo")}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-state">Nenhum mentorado encontrado.</td></tr>`}</tbody></table></div></article></section><section id="sec-concursos" class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Novo Concurso</h2></div><form class="form-grid" data-form="concurso-create"><label><span class="field-label">Nome</span><input class="input" name="nome" type="text" required></label><label><span class="field-label">Cargo</span><input class="input" name="cargo" type="text"></label><label><span class="field-label">Orgao</span><input class="input" name="orgao" type="text"></label><label><span class="field-label">Status</span><select class="select" name="status"><option value="ativo">Ativo</option><option value="arquivado">Arquivado</option></select></label><label><span class="field-label">Descricao</span><textarea class="textarea" name="descricao"></textarea></label><button class="button button-primary" type="submit">Criar concurso</button><div class="message" data-form-message></div></form></article><article class="card"><div class="card-head"><h2 class="card-title">Concursos recentes</h2></div><div class="list">${data.concursos.map((item) => `<div class="list-item"><strong>${esc(item.nome)}</strong><span>${esc([item.cargo, item.orgao].filter(Boolean).join(" - ") || "Sem detalhes adicionais.")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge ${badgeClass(item.status)}">${esc(item.status)}</span></div></div>`).join("") || `<div class="empty-state">Nenhum concurso cadastrado ainda.</div>`}</div></article></section><section id="sec-materiais" class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Novo Material</h2></div><form class="form-grid" data-form="material-create"><label><span class="field-label">Titulo</span><input class="input" name="titulo" type="text" required></label><label><span class="field-label">Tipo</span><input class="input" name="tipo" type="text" placeholder="pdf, video, questoes"></label><label><span class="field-label">Visibilidade</span><select class="select" name="visibilidade"><option value="concurso">Concurso</option><option value="aluno">Aluno</option></select></label><label><span class="field-label">Concurso</span><select class="select" name="concurso_id"><option value="">Opcional</option>${data.concursos.map((item) => `<option value="${esc(item.id)}">${esc(item.nome)}</option>`).join("")}</select></label><label><span class="field-label">Mentorado</span><select class="select" name="mentorado_id"><option value="">Opcional</option>${data.mentorados.map((item) => `<option value="${esc(item.id)}">${esc(item.nome || item.email)}</option>`).join("")}</select></label><label><span class="field-label">URL externa</span><input class="input" name="externo_url" type="url"></label><label><span class="field-label">Storage path</span><input class="input" name="file_path" type="text"></label><label><span class="field-label">Descricao</span><textarea class="textarea" name="descricao"></textarea></label><button class="button button-primary" type="submit">Criar material</button><div class="message" data-form-message></div></form></article><article class="card"><div class="card-head"><h2 class="card-title">Materiais recentes</h2></div><div class="list">${data.materiais.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(item.tipo || "Material")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(item.visibilidade)}</span><span class="badge blue">${esc(fmtDate(item.created_at?.slice?.(0, 10) || ""))}</span></div></div>`).join("") || `<div class="empty-state">Nenhum material cadastrado ainda.</div>`}</div></article></section>`;
  appContent.innerHTML += `<section id="sec-planos" class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Novo Plano Mensal</h2></div><form class="form-grid" data-form="plano-mensal-create"><label><span class="field-label">Mentorado</span><select class="select" name="mentorado_id" required><option value="">Selecione</option>${data.mentorados.map((item) => `<option value="${esc(item.id)}">${esc(item.nome || item.email)}</option>`).join("")}</select></label><label><span class="field-label">Titulo</span><input class="input" name="titulo" type="text" placeholder="Plano Abril 2026 - TRF-3" required></label><label><span class="field-label">Mes de referencia</span><input class="input" name="mes_referencia" type="date" required></label><label><span class="field-label">Status</span><select class="select" name="status"><option value="ativo">Ativo</option><option value="rascunho">Rascunho</option><option value="arquivado">Arquivado</option></select></label><label><span class="field-label">URL do PDF</span><input class="input" name="pdf_url" type="url"></label><label><span class="field-label">Storage path do PDF</span><input class="input" name="pdf_path" type="text"></label><label><span class="field-label">Descricao</span><textarea class="textarea" name="descricao"></textarea></label><button class="button button-primary" type="submit">Criar plano mensal</button><div class="message" data-form-message></div></form><div class="card-head" style="margin-top:1.4rem;"><h2 class="card-title">Nova Meta do Plano</h2></div><form class="form-grid" data-form="plano-item-create"><label><span class="field-label">Plano mensal</span><select class="select" name="plano_id" required><option value="">Selecione</option>${data.monthlyPlans.map((item) => `<option value="${esc(item.id)}">${esc(optionLabel(item, mentoradosMap))}</option>`).join("")}</select></label><label><span class="field-label">Titulo</span><input class="input" name="titulo" type="text" required></label><label><span class="field-label">Tipo</span><select class="select" name="tipo"><option value="teoria">Teoria</option><option value="questoes">Questoes</option><option value="revisao">Revisao</option><option value="simulado">Simulado</option><option value="redacao">Redacao</option><option value="meta_mensal">Meta mensal</option></select></label><label><span class="field-label">Data prevista</span><input class="input" name="data_prevista" type="date"></label><label><span class="field-label">Dia da semana</span><select class="select" name="dia_semana"><option value="">Opcional</option>${dayLabels.map((label, index) => `<option value="${index}">${esc(label)}</option>`).join("")}</select></label><label><span class="field-label">Ordem</span><input class="input" name="ordem" type="number" min="0" value="1"></label><label><span class="field-label">Link do TEC</span><input class="input" name="tec_url" type="url"></label><label><span class="field-label">Link complementar ou storage path</span><input class="input" name="material_url" type="text"></label><label><span class="field-label">Descricao</span><textarea class="textarea" name="descricao"></textarea></label><button class="button button-primary" type="submit">Criar meta</button><div class="message" data-form-message></div></form></article><article class="card"><div class="card-head"><h2 class="card-title">Planos Mensais Recentes</h2></div><div class="list">${plans.map((plan) => `<div class="list-item"><strong>${esc(plan.titulo)}</strong><span>${esc(`${mentoradosMap.get(plan.mentorado_id)?.nome || mentoradosMap.get(plan.mentorado_id)?.email || "Mentorado"} - ${fmtMonth(plan.mes_referencia)}`)}</span><div class="metric-bar" style="margin-top:1rem;"><span style="width:${esc(String(plan.progress))}%"></span></div><div class="badge-row" style="margin-top:.8rem;"><span class="badge ${badgeClass(plan.status)}">${esc(plan.status)}</span><span class="badge gold">${esc(`${plan.completed}/${plan.items.length} metas`)}</span></div>${plan.resolved_pdf_url ? `<div class="inline-actions" style="margin-top:1rem;"><a class="button button-secondary" href="${esc(plan.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a></div>` : ""}</div>`).join("") || `<div class="empty-state">Nenhum plano mensal cadastrado ainda.</div>`}</div></article></section><section id="sec-simulados" class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><h2 class="card-title">Novo Simulado</h2></div><form class="form-grid" data-form="simulado-create"><label><span class="field-label">Mentorado</span><select class="select" name="mentorado_id" required><option value="">Selecione</option>${data.mentorados.map((item) => `<option value="${esc(item.id)}">${esc(item.nome || item.email)}</option>`).join("")}</select></label><label><span class="field-label">Concurso</span><select class="select" name="concurso_id"><option value="">Opcional</option>${data.concursos.map((item) => `<option value="${esc(item.id)}">${esc(item.nome)}</option>`).join("")}</select></label><label><span class="field-label">Titulo</span><input class="input" name="titulo" type="text" required></label><label><span class="field-label">Data</span><input class="input" name="data_aplicacao" type="date"></label><label><span class="field-label">Acertos</span><input class="input" name="acertos" type="number" min="0" value="0"></label><label><span class="field-label">Total de questoes</span><input class="input" name="total_questoes" type="number" min="0" value="0"></label><label><span class="field-label">URL do PDF</span><input class="input" name="pdf_url" type="url"></label><label><span class="field-label">Storage path do PDF</span><input class="input" name="pdf_path" type="text"></label><label><span class="field-label">Observacoes</span><textarea class="textarea" name="observacoes"></textarea></label><button class="button button-primary" type="submit">Criar simulado</button><div class="message" data-form-message></div></form></article><article class="card"><div class="card-head"><h2 class="card-title">Simulados recentes</h2></div><div class="list">${data.simulados.map((item) => `<div class="list-item"><strong>${esc(item.titulo)}</strong><span>${esc(mentoradosMap.get(item.mentorado_id)?.nome || "Mentorado nao identificado")}</span><div class="badge-row" style="margin-top:.8rem;"><span class="badge gold">${esc(fmtDate(item.data_aplicacao))}</span><span class="badge blue">${esc(`${item.acertos || 0}/${item.total_questoes || 0}`)}</span></div>${item.resolved_pdf_url ? `<div class="inline-actions" style="margin-top:1rem;"><a class="button button-secondary" href="${esc(item.resolved_pdf_url)}" target="_blank" rel="noopener noreferrer">Abrir PDF</a></div>` : item.pdf_path ? `<div class="message error" style="margin-top:1rem;">PDF privado nao resolvido. Verifique o path <strong>${esc(item.pdf_path)}</strong>.</div>` : ""}</div>`).join("") || `<div class="empty-state">Nenhum simulado cadastrado ainda.</div>`}</div></article></section><section id="sec-evolucao" class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><div><h2 class="card-title">Acompanhamento do mentor</h2><p class="page-copy">Visao consolidada com concurso, ultimo check-in, plano ativo e ultimo simulado por mentorado.</p></div><span class="badge gold">Ultimos 7 dias</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Mentorado</th><th>Concurso</th><th>Ultimo check-in</th><th>Horas 7d</th><th>Questoes 7d</th><th>Acerto 7d</th><th>Metas 7d</th><th>Plano</th><th>Simulado</th><th>Ritmo</th></tr></thead><tbody>${evolutionTableRows}</tbody></table></div></article><article class="card"><div class="card-head"><div><h2 class="card-title">Radar individual</h2><p class="page-copy">Leitura rapida para saber quem esta constante, quem travou e quem precisa de ajuste imediato.</p></div><span class="badge gold">${esc(String(mentorKpis.length))} mentorados</span></div><div class="list">${evolutionCardsHtml}</div></article></section><section id="sec-observacoes" class="grid-2" style="margin-top:1rem;"><article class="card"><div class="card-head"><div><h2 class="card-title">Observacoes dos mentorados</h2><p class="page-copy">Essas mensagens chegam automaticamente quando o aluno salva o check-in diario na aba Evolucao.</p></div><span class="badge gold">${esc(String(observationRows.length))} observacoes</span></div><div class="list">${observationsFeedHtml}</div></article><article class="card"><div class="card-head"><div><h2 class="card-title">Ultima mensagem de cada aluno</h2><p class="page-copy">Visao limpa para saber o que cada mentorado te contou por ultimo.</p></div><span class="badge gold">${esc(String(latestObservations.length))} alunos</span></div><div class="list">${latestObservationsHtml}</div></article></section>`;

  appContent.querySelectorAll("form[data-form]").forEach((form) => {
    form.addEventListener("submit", handleAdminSubmit);
  });
  wireAdminMentoradoForm(data.mentorados);
  syncAdminHashNav();
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

async function handlePlanItemToggle(event) {
  const checkbox = event.currentTarget;
  const itemId = checkbox.dataset.planItemToggle;
  const checked = checkbox.checked;
  checkbox.disabled = true;

  try {
    if (isDemoMode()) {
      const demo = loadDemoData();
      const item = demo.monthlyItems.find((row) => row.id === itemId);
      if (!item) throw new Error("Meta demo nao encontrada.");
      item.concluida = checked;
      item.concluida_em = checked ? new Date().toISOString() : null;
      saveDemoData(demo);
      showLoading("Atualizando plano demo...");
      const data = await fetchMentoradoData();
      renderPlanPage(data);
      return;
    }

    const { ensureSupabase } = await loadSupabaseModule();
    const client = ensureSupabase();
    const { error } = await client.from("plano_itens").update({ concluida: checked, concluida_em: checked ? new Date().toISOString() : null }).eq("id", itemId);
    if (error) throw error;

    showLoading("Atualizando plano...");
    const data = await fetchMentoradoData();
    renderPlanPage(data);
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

  if (state.profile.role === "mentor") {
    await renderAdminPage();
    return;
  }

  showLoading();
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
