#!/usr/bin/env node
/**
 * Gera todos os SVGs usados no README do perfil.
 *
 * Os cards são gerados aqui e commitados como arquivos estáticos, então o
 * perfil carrega direto do repositório, sem depender de serviços de terceiros.
 *
 * Usa o token do `gh` (escopo repo), então os números incluem os repositórios
 * privados.
 *
 * Uso:
 *   node scripts/refresh-cards.mjs            # gera tudo
 *   node scripts/refresh-cards.mjs --no-snake # pula a cobrinha (é a etapa lenta)
 *
 * Requisitos: Node 18+, git, e `gh auth login` já feito.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "profile", "assets");
const CACHE = join(tmpdir(), "gh-profile-cards");

const USER = "oPaozinh0";
const SKIP_SNAKE = process.argv.includes("--no-snake");

/**
 * Os cards com texto são gerados nos dois idiomas. Índice 0 = inglês (README.md),
 * índice 1 = português (README.pt-BR.md). Cada variante ganha o sufixo do idioma.
 */
const LANGS = [
  { i: 0, suffix: "" },
  { i: 1, suffix: ".pt-BR" },
];
/** Escolhe a string do idioma corrente; aceita string simples (igual nos dois). */
const T = (v, i) => (Array.isArray(v) ? v[i] : v);

/** Paleta "radical" — a mesma do github-readme-stats, para tudo combinar. */
const C = {
  bg: "#141321",
  bgAlt: "#1c1a2e",
  title: "#FE428E",
  text: "#A9FEF7",
  icon: "#F8D847",
  accent: "#9D4EDD",
  muted: "#5F5A7A",
};

/** Paleta clara, aplicada por @media dentro do próprio SVG. */
const L = {
  bg: "#FFFFFF",
  text: "#1F2328",
  muted: "#6E7681",
  title: "#D6336C",
};

/**
 * Bloco @media que troca as cores quando o visitante está no tema claro.
 * Fica dentro do SVG, então um único arquivo serve os dois temas — sem
 * precisar de <picture> nem de dois assets.
 */
const lightCss = (rules) => `
      @media (prefers-color-scheme: light) {
${rules}
      }`;

const log = (...a) => console.log(...a);
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function write(name, svg) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), svg.trim() + "\n");
  log(`  ✓ ${name}`);
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------

/** Token: no CI vem do ambiente, na máquina local vem do `gh`. */
function token() {
  return (
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    execSync("gh auth token").toString().trim()
  );
}

function gh(query, vars = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push("-F", `${k}=${v}`);
  const raw = execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const json = JSON.parse(raw);
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

/** Baixa o calendário de contribuições de todos os anos (inclui os privados). */
function fetchCalendar() {
  const { user } = gh(
    `query($login:String!){user(login:$login){contributionsCollection{contributionYears}}}`,
    { login: USER },
  );
  const years = user.contributionsCollection.contributionYears;
  const days = [];

  for (const year of years) {
    const { user: u } = gh(
      `query($login:String!,$from:DateTime!,$to:DateTime!){
         user(login:$login){
           contributionsCollection(from:$from,to:$to){
             contributionCalendar{ weeks{ contributionDays{ date contributionCount } } }
           }
         }
       }`,
      { login: USER, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    for (const w of u.contributionsCollection.contributionCalendar.weeks) {
      for (const d of w.contributionDays) days.push(d);
    }
  }

  // O calendário devolve o ano inteiro, então o range do ano corrente vem com
  // dias futuros zerados. Sem cortar aqui, o streak zera e o gráfico ganha uma
  // cauda de zeros até dezembro.
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // dedup por data e ordena
  const byDate = new Map();
  for (const d of days) byDate.set(d.date, d.contributionCount);
  return [...byDate.entries()]
    .map(([date, count]) => ({ date, count }))
    .filter((d) => d.date <= iso)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Streak atual e mais longo, no mesmo critério do streak-stats. */
function computeStreaks(days) {
  const total = days.reduce((a, d) => a + d.count, 0);
  const today = days[days.length - 1]?.date;

  let longest = 0,
    longestStart = null,
    longestEnd = null,
    run = 0,
    runStart = null;

  for (const d of days) {
    if (d.count > 0) {
      if (run === 0) runStart = d.date;
      run++;
      if (run > longest) {
        longest = run;
        longestStart = runStart;
        longestEnd = d.date;
      }
    } else {
      run = 0;
    }
  }

  // streak atual: anda de trás pra frente. O dia de hoje sem commit ainda não
  // quebra a sequência (o dia não acabou).
  let current = 0,
    currentStart = null,
    currentEnd = null;
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i];
    if (d.count > 0) {
      if (current === 0) currentEnd = d.date;
      current++;
      currentStart = d.date;
    } else if (!(i === days.length - 1 && d.date === today)) {
      break;
    }
  }

  return {
    total,
    longest,
    longestStart,
    longestEnd,
    current,
    currentStart,
    currentEnd,
    firstDate: days.find((d) => d.count > 0)?.date ?? days[0]?.date,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function buildBanner() {
  const W = 1000,
    H = 220;

  // estrelas pseudo-aleatórias, mas determinísticas (não sujam o diff a cada run)
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const stars = Array.from({ length: 55 }, () => ({
    x: +(rnd() * W).toFixed(1),
    y: +(rnd() * (H - 60)).toFixed(1),
    r: +(rnd() * 1.4 + 0.4).toFixed(2),
    d: +(rnd() * 4).toFixed(2),
  }));

  const wave = (y, amp, color, op, dur, delay) => `
    <g opacity="${op}">
      <path fill="${color}" d="M0,${y} C 150,${y - amp} 350,${y + amp} 500,${y} C 650,${y - amp} 850,${y + amp} 1000,${y} L1000,${H} L0,${H} Z">
        <animateTransform attributeName="transform" type="translate"
          values="0,0; -30,6; 0,0; 30,-6; 0,0" dur="${dur}s"
          begin="${delay}s" repeatCount="indefinite" />
      </path>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Davi de Oliveira Vieira — Senior Full Stack Developer">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0D0C1D"/>
      <stop offset="55%" stop-color="${C.bg}"/>
      <stop offset="100%" stop-color="#241a3a"/>
    </linearGradient>
    <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.title}"/>
      <stop offset="50%" stop-color="${C.accent}"/>
      <stop offset="100%" stop-color="${C.text}"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.title}" stop-opacity="0"/>
      <stop offset="50%" stop-color="${C.title}"/>
      <stop offset="100%" stop-color="${C.accent}" stop-opacity="0"/>
    </linearGradient>
    <pattern id="grid" width="34" height="34" patternUnits="userSpaceOnUse">
      <path d="M34 0 L0 0 0 34" fill="none" stroke="${C.text}" stroke-opacity="0.05" stroke-width="1"/>
    </pattern>
    <style>
      .name  { font: 700 46px 'Segoe UI', Ubuntu, Helvetica, sans-serif; fill: url(#ink); }
      .role  { font: 600 17px 'Segoe UI', Ubuntu, Helvetica, sans-serif; fill: ${C.text}; letter-spacing: 2.6px; }
      .tag   { font: 500 13px 'Consolas','Fira Code',monospace; fill: ${C.muted}; letter-spacing: 1px; }
      .fade  { opacity: 0; animation: fade .9s ease forwards; }
      .d1 { animation-delay: .15s } .d2 { animation-delay: .45s } .d3 { animation-delay: .75s }
      @keyframes fade { to { opacity: 1 } }
      @keyframes twinkle { 0%,100% { opacity:.15 } 50% { opacity:.9 } }
      .star { animation: twinkle 3.4s ease-in-out infinite; fill: ${C.text}; }
    </style>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>

  <g>${stars
    .map((s) => `<circle class="star" cx="${s.x}" cy="${s.y}" r="${s.r}" style="animation-delay:${s.d}s"/>`)
    .join("")}</g>

  ${wave(168, 16, C.accent, 0.22, 13, 0)}
  ${wave(182, 12, C.title, 0.18, 17, 1.5)}
  ${wave(196, 9, C.text, 0.1, 21, 3)}

  <g text-anchor="middle">
    <text class="name fade d1" x="500" y="88">Davi de Oliveira Vieira</text>
    <rect class="fade d2" x="290" y="104" width="420" height="2" fill="url(#rule)"/>
    <text class="role fade d2" x="500" y="132">SENIOR FULL STACK DEVELOPER</text>
    <text class="tag fade d3" x="500" y="158">PHP · Laravel · Vue.js · Python · Go · Docker</text>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------

const TYPING = [
  ["6+ years building scalable web systems", "6+ anos construindo sistemas web escaláveis"],
  ["PHP 8 · Laravel 11 · Vue 3 · Python · Go", "PHP 8 · Laravel 11 · Vue 3 · Python · Go"],
  ["ETL, data migration & BI accuracy", "ETL, migração de dados e precisão em BI"],
  ["Founder of AttriOn — TikTok Ads SaaS", "Fundador da AttriOn — SaaS para TikTok Ads"],
];

function buildTyping(li) {
  const lines = TYPING.map((l) => T(l, li));

  const CH = 13.2; // largura fixa por caractere (textLength garante isso)
  const SLOT = 4; // segundos por frase
  const TOTAL = lines.length * SLOT;
  const W = 720,
    H = 64;
  const maxLen = Math.max(...lines.map((l) => l.length));
  const x0 = (W - maxLen * CH) / 2;

  // dentro do ciclo: digita (0-40%), segura (40-85%), apaga do clip (85-100%)
  const keyframes = lines
    .map((line, i) => {
      const w = (line.length * CH).toFixed(1);
      const start = (i * SLOT) / TOTAL;
      const p = (f) => (((start + (f * SLOT) / TOTAL) * 100) % 100.0001).toFixed(3);
      return `
      @keyframes type${i} {
        0%, ${p(0)}%      { width: 0 }
        ${p(0.42)}%       { width: ${w}px }
        ${p(0.86)}%       { width: ${w}px }
        ${p(0.97)}%, 100% { width: 0 }
      }
      @keyframes cur${i} {
        0%, ${p(0)}%      { transform: translateX(0); opacity: 0 }
        ${p(0.02)}%       { opacity: 1 }
        ${p(0.42)}%       { transform: translateX(${w}px); opacity: 1 }
        ${p(0.86)}%       { transform: translateX(${w}px); opacity: 1 }
        ${p(0.97)}%       { transform: translateX(0); opacity: 0 }
        100%              { opacity: 0 }
      }
      #clip${i} rect { animation: type${i} ${TOTAL}s steps(${line.length}, end) infinite }
      #cursor${i}    { animation: cur${i} ${TOTAL}s steps(${line.length}, end) infinite }`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lines.join(" — "))}">
  <defs>
    <linearGradient id="tg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.title}"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>
${lines
  .map(
    (l, i) =>
      `    <clipPath id="clip${i}"><rect x="${x0.toFixed(1)}" y="0" width="0" height="${H}"/></clipPath>`,
  )
  .join("\n")}
    <style>
      text { font: 600 22px 'Consolas','Fira Code','Courier New',monospace; fill: url(#tg); dominant-baseline: middle; }
      rect.cur { fill: ${C.title} }
${keyframes}
    </style>
  </defs>
${lines
  .map(
    (l, i) => `  <g clip-path="url(#clip${i})">
    <text x="${x0.toFixed(1)}" y="${H / 2}" textLength="${(l.length * CH).toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(l)}</text>
  </g>
  <rect id="cursor${i}" class="cur" x="${x0.toFixed(1)}" y="${H / 2 - 13}" width="2.5" height="26" opacity="0"/>`,
  )
  .join("\n")}
</svg>`;
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

function buildStreak(s, li) {
  const t = {
    total: T(["Total Contributions", "Total de Contribuições"], li),
    current: T(["Current Streak", "Sequência Atual"], li),
    longest: T(["Longest Streak", "Maior Sequência"], li),
    present: T(["Present", "Hoje"], li),
  };
  const W = 495,
    H = 195;
  const col = [W * 0.185, W * 0.5, W * 0.815];

  const cell = (i, big, label, sub) => `
  <g class="fade" style="animation-delay:${0.2 + i * 0.18}s">
    <text class="big" x="${col[i]}" y="70" text-anchor="middle">${esc(big)}</text>
    <text class="lbl" x="${col[i]}" y="112" text-anchor="middle">${esc(label)}</text>
    <text class="sub" x="${col[i]}" y="140" text-anchor="middle">${esc(sub)}</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub streak: ${s.current} day current streak, ${s.longest} day longest streak, ${s.total} total contributions">
  <defs>
    <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.title}"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>
    <style>
      .big { font: 700 30px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.text} }
      .cur { font: 700 34px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.title} }
      .lbl { font: 600 13px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.title}; letter-spacing: .6px }
      .sub { font: 400 11px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.muted} }
      .fade { opacity: 0; animation: f .8s ease forwards }
      @keyframes f { to { opacity: 1 } }
      @keyframes pulse { 0%,100% { transform: scale(1); opacity:.85 } 50% { transform: scale(1.05); opacity:1 } }
      .halo { transform-origin: ${col[1]}px 62px; animation: pulse 2.6s ease-in-out infinite }
      .bg { fill: ${C.bg} }${lightCss(`        .bg  { fill: ${L.bg} }
        .big { fill: ${L.text} }
        .cur { fill: ${L.title} }
        .lbl { fill: ${L.title} }
        .sub { fill: ${L.muted} }`)}
    </style>
  </defs>
  <rect class="bg" width="${W}" height="${H}" rx="8"/>

  <line x1="${W * 0.345}" y1="34" x2="${W * 0.345}" y2="${H - 34}" stroke="${C.muted}" stroke-opacity=".35"/>
  <line x1="${W * 0.655}" y1="34" x2="${W * 0.655}" y2="${H - 34}" stroke="${C.muted}" stroke-opacity=".35"/>

  ${cell(0, s.total.toLocaleString("en-US"), t.total, `${fmtDate(s.firstDate)} — ${t.present}`)}

  <g class="fade" style="animation-delay:.38s">
    <circle class="halo" cx="${col[1]}" cy="62" r="42" fill="none" stroke="url(#ring)" stroke-width="4"/>
    <text class="cur" x="${col[1]}" y="72" text-anchor="middle">${s.current}</text>
    <text class="lbl" x="${col[1]}" y="126" text-anchor="middle">${esc(t.current)}</text>
    <text class="sub" x="${col[1]}" y="148" text-anchor="middle">${esc(
      s.current ? `${fmtDate(s.currentStart)} — ${fmtDate(s.currentEnd)}` : "—",
    )}</text>
  </g>

  ${cell(2, s.longest.toLocaleString("en-US"), t.longest, `${fmtDate(s.longestStart)} — ${fmtDate(s.longestEnd)}`)}
</svg>`;
}

// ---------------------------------------------------------------------------
// Activity graph
// ---------------------------------------------------------------------------

function buildActivity(days, li) {
  const t = {
    title: T(["Contribution Activity", "Atividade de Contribuições"], li),
    sub: T(
      ["contributions in the last year — private repositories included", "contribuições no último ano — repositórios privados incluídos"],
      li,
    ),
  };
  const W = 1000,
    H = 300;
  const pad = { t: 58, r: 34, b: 42, l: 52 };
  const iw = W - pad.l - pad.r,
    ih = H - pad.t - pad.b;

  const last = days.slice(-371);
  // agrupa em semanas para uma curva legível
  const weeks = [];
  for (let i = 0; i < last.length; i += 7) {
    const chunk = last.slice(i, i + 7);
    weeks.push({
      date: chunk[0].date,
      count: chunk.reduce((a, d) => a + d.count, 0),
    });
  }

  const max = Math.max(1, ...weeks.map((w) => w.count));
  const yMax = Math.ceil(max / 10) * 10;
  const X = (i) => pad.l + (i / (weeks.length - 1)) * iw;
  const Y = (v) => pad.t + ih - (v / yMax) * ih;

  const pts = weeks.map((w, i) => [X(i), Y(w.count)]);

  // Catmull-Rom -> cubic bezier, para a curva não ficar quebrada
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i],
      p1 = pts[i],
      p2 = pts[i + 1],
      p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area = `${d} L${pts[pts.length - 1][0].toFixed(1)},${pad.t + ih} L${pts[0][0].toFixed(1)},${pad.t + ih} Z`;

  // rótulos de mês
  const seen = new Set();
  const labels = weeks
    .map((w, i) => {
      const [y, m] = w.date.split("-").map(Number);
      const key = `${y}-${m}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return `<text class="ax" x="${X(i).toFixed(1)}" y="${H - 16}" text-anchor="middle">${MONTHS[m - 1]}</text>`;
    })
    .filter(Boolean)
    .join("");

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = Math.round(yMax * f);
      const y = Y(v);
      return `<line x1="${pad.l}" y1="${y.toFixed(1)}" x2="${W - pad.r}" y2="${y.toFixed(1)}" stroke="${C.muted}" stroke-opacity=".22"/>
      <text class="ax" x="${pad.l - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
    })
    .join("");

  const total = last.reduce((a, x) => a + x.count, 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution activity over the last year: ${total} contributions">
  <defs>
    <linearGradient id="ln" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${C.title}"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>
    <linearGradient id="ar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${C.title}" stop-opacity=".45"/>
      <stop offset="100%" stop-color="${C.title}" stop-opacity="0"/>
    </linearGradient>
    <style>
      .ttl { font: 700 18px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.title} }
      .sub { font: 400 12px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.muted} }
      .ax  { font: 400 11px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.muted} }
      .line { fill: none; stroke: url(#ln); stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round;
              stroke-dasharray: 6000; stroke-dashoffset: 6000; animation: draw 2.6s ease-out forwards .2s }
      .area { opacity: 0; animation: rise 1.4s ease-out forwards 1.1s }
      @keyframes draw { to { stroke-dashoffset: 0 } }
      @keyframes rise { to { opacity: 1 } }
      .bg { fill: ${C.bg} }${lightCss(`        .bg  { fill: ${L.bg} }
        .ttl { fill: ${L.title} }
        .sub, .ax { fill: ${L.muted} }`)}
    </style>
  </defs>
  <rect class="bg" width="${W}" height="${H}" rx="8"/>
  <text class="ttl" x="${pad.l}" y="32">${esc(t.title)}</text>
  <text class="sub" x="${pad.l}" y="50">${total.toLocaleString("en-US")} ${esc(t.sub)}</text>
  ${grid}
  <path class="area" d="${area}" fill="url(#ar)"/>
  <path class="line" d="${d}"/>
  ${labels}
</svg>`;
}

// ---------------------------------------------------------------------------
// Tech stack — um único SVG no lugar de ~45 badges do shields.io
// ---------------------------------------------------------------------------

/** Largura aproximada de um texto, para dimensionar os chips. */
function textWidth(s, size) {
  let w = 0;
  for (const ch of s) {
    if ("iljtI.,;:'!|()[]".includes(ch)) w += 0.33;
    else if ("mMWw@".includes(ch)) w += 0.95;
    else if (ch === " ") w += 0.3;
    else if (ch >= "A" && ch <= "Z") w += 0.69;
    else if (ch >= "0" && ch <= "9") w += 0.58;
    else w += 0.56;
  }
  return w * size;
}

const STACK = [
  {
    title: ["Backend & APIs", "Backend & APIs"],
    items: [
      ["PHP 8", "siPhp"],
      ["Laravel 11", "siLaravel"],
      ["Python", "siPython"],
      ["Go", "siGo"],
      ["GraphQL", "siGraphql"],
      ["OpenAPI", "siSwagger"],
      ["Composer", "siComposer"],
    ],
  },
  {
    title: ["Frontend", "Frontend"],
    items: [
      ["Vue.js 3", "siVuedotjs"],
      ["TypeScript", "siTypescript"],
      ["JavaScript", "siJavascript"],
      ["Tailwind CSS", "siTailwindcss"],
      ["Bootstrap", "siBootstrap"],
      ["Vite", "siVite"],
    ],
  },
  {
    title: ["Databases & Cache", "Bancos de Dados & Cache"],
    items: [
      ["MySQL", "siMysql"],
      ["PostgreSQL", "siPostgresql"],
      ["MariaDB", "siMariadb"],
      ["MongoDB", "siMongodb"],
      ["Redis", "siRedis"],
      ["SQLite", "siSqlite"],
    ],
  },
  {
    title: ["Infrastructure & DevOps", "Infraestrutura & DevOps"],
    items: [
      ["Docker", "siDocker"],
      ["Kubernetes", "siKubernetes"],
      ["Linux", "siLinux"],
      ["Nginx", "siNginx"],
      ["AWS", null, "#FF9900"],
      ["DigitalOcean", "siDigitalocean"],
      ["GitHub Actions", "siGithubactions"],
    ],
  },
  {
    title: ["Tools & Practices", "Ferramentas & Práticas"],
    items: [
      ["Git", "siGit"],
      ["Jira", "siJira"],
      ["Bitbucket", "siBitbucket"],
      ["Claude Code", "siClaudecode"],
      ["TDD / PHPUnit", null, "#6DB33F"],
      ["Clean Architecture", null, "#A9FEF7"],
      ["SOLID", null, "#A9FEF7"],
      ["Scrum / Kanban", null, "#009FDA"],
    ],
  },
];

function buildStack(si, li) {
  const W = 1000;
  const FS = 13.5; // font-size do rótulo
  const CH = 34; // altura do chip
  const GAP = 9;
  const PAD = 13;
  const ICON = 16;

  let y = 10;
  const out = [];
  let idx = 0;

  for (const group of STACK) {
    y += 22;
    out.push(
      `  <text class="cat" x="0" y="${y}">${esc(T(group.title, li).toUpperCase())}</text>`,
    );
    y += 16;

    // mede e quebra em linhas
    const chips = group.items.map(([label, slug, forced]) => {
      const icon = slug ? si[slug] : null;
      const tw = textWidth(label, FS);
      const w = PAD + (icon ? ICON + 8 : 0) + tw + PAD;
      return { label, icon, tw, w, color: forced || (icon ? `#${icon.hex}` : C.text) };
    });

    const rows = [[]];
    let rowW = 0;
    for (const c of chips) {
      if (rowW + c.w > W && rows[rows.length - 1].length) {
        rows.push([]);
        rowW = 0;
      }
      rows[rows.length - 1].push(c);
      rowW += c.w + GAP;
    }

    for (const row of rows) {
      let x = 0;
      for (const c of row) {
        const delay = (0.05 + idx++ * 0.022).toFixed(3);
        const ix = x + PAD;
        const tx = x + PAD + (c.icon ? ICON + 8 : 0);
        out.push(`  <g class="chip" style="animation-delay:${delay}s">
    <rect x="${x.toFixed(1)}" y="${y}" width="${c.w.toFixed(1)}" height="${CH}" rx="${CH / 2}" fill="${c.color}" fill-opacity=".13" stroke="${c.color}" stroke-opacity=".45"/>${
      c.icon
        ? `
    <g transform="translate(${ix.toFixed(1)},${y + (CH - ICON) / 2}) scale(${(ICON / 24).toFixed(4)})"><path d="${c.icon.path}" fill="${c.color}"/></g>`
        : ""
    }
    <text class="chp" x="${tx.toFixed(1)}" y="${y + CH / 2 + 4.5}" textLength="${c.tw.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(c.label)}</text>
  </g>`);
        x += c.w + GAP;
      }
      y += CH + GAP;
    }
  }

  const H = y + 8;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T(['Tech stack','Stack'], li)}: ${esc(STACK.flatMap((g) => g.items.map((i) => i[0])).join(", "))}">
  <defs>
    <style>
      .cat { font: 700 11.5px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.title}; letter-spacing: 2.4px }
      .chp { font: 600 ${FS}px 'Segoe UI', Ubuntu, sans-serif; dominant-baseline: auto; fill: #EAF6FF }
      .chip { opacity: 0; animation: pop .5s cubic-bezier(.2,.8,.3,1) forwards }
      @keyframes pop { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }${lightCss(`        .cat { fill: ${L.title} }
        .chp { fill: ${L.text} }`)}
    </style>
  </defs>
${out.join("\n")}
</svg>`;
}

// ---------------------------------------------------------------------------
// Métricas de impacto
// ---------------------------------------------------------------------------

const METRICS = [
  ["30%", ["faster API responses", "de latência a menos na API"], ["critical endpoint tuning", "otimização de endpoints críticos"]],
  ["80%", ["test coverage", "de cobertura de testes"], ["PHPUnit on new features", "PHPUnit nas novas features"]],
  ["20h", ["saved per month", "economizadas por mês"], ["manual ETL automated", "ETL manual automatizado"]],
  ["99.9%", ["production uptime", "de uptime em produção"], ["Dockerized SaaS", "SaaS em Docker"]],
  ["100%", ["data integrity", "de integridade de dados"], ["millions of health records", "milhões de registros de saúde"]],
  ["10h", ["migration, was 2 days", "por migração, eram 2 dias"], ["custom conversion tooling", "ferramentas próprias de conversão"]],
  ["+50%", ["faster onboarding", "mais rápido no onboarding"], ["documented data architecture", "arquitetura de dados documentada"]],
  ["95%+", ["support CSAT", "de CSAT no suporte"], ["complex incident resolution", "resolução de incidentes complexos"]],
];

function buildMetrics(li) {
  const W = 1000,
    COLS = 4,
    CW = W / COLS,
    RH = 104;
  const rows = Math.ceil(METRICS.length / COLS);
  const H = rows * RH + 16;

  const cells = METRICS.map(([big, label, sub], i) => {
    const cx = (i % COLS) * CW + CW / 2;
    const cy = Math.floor(i / COLS) * RH + 20;
    return `  <g class="m" style="animation-delay:${(0.08 + i * 0.07).toFixed(2)}s">
    <text class="big" x="${cx.toFixed(1)}" y="${cy + 38}" text-anchor="middle">${esc(big)}</text>
    <text class="lbl" x="${cx.toFixed(1)}" y="${cy + 62}" text-anchor="middle">${esc(T(label, li))}</text>
    <text class="sub" x="${cx.toFixed(1)}" y="${cy + 80}" text-anchor="middle">${esc(T(sub, li))}</text>
  </g>`;
  }).join("\n");

  const seps = Array.from({ length: COLS - 1 }, (_, i) => {
    const x = (i + 1) * CW;
    return `  <line x1="${x}" y1="18" x2="${x}" y2="${H - 18}" stroke="${C.muted}" stroke-opacity=".25"/>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${T(["Impact", "Impacto"], li)}: ${esc(METRICS.map((m) => `${m[0]} ${T(m[1], li)}`).join(", "))}">
  <defs>
    <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.title}"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>
    <style>
      .big { font: 700 32px 'Segoe UI', Ubuntu, sans-serif; fill: url(#mg) }
      .lbl { font: 600 13px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.text} }
      .sub { font: 400 11px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.muted} }
      .m { opacity: 0; animation: up .6s ease forwards }
      @keyframes up { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }${lightCss(`        .lbl { fill: ${L.text} }
        .sub { fill: ${L.muted} }`)}
    </style>
  </defs>
${seps}
${cells}
</svg>`;
}

// ---------------------------------------------------------------------------
// Conquistas — medalhas montadas com números reais do perfil.
// ---------------------------------------------------------------------------

const compact = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K` : String(n);

function buildAchievements({ stats, streaks, repos }, li) {
  const items = [
    [compact(stats.totalCommits), ["Commits", "Commits"], ["all time", "no total"]],
    [stats.rank.level.replace("-", "−"), ["GitHub Rank", "Rank no GitHub"], [`top ${Math.round(stats.rank.percentile)}%`, `top ${Math.round(stats.rank.percentile)}%`]],
    [String(stats.totalPRs), ["Pull Requests", "Pull Requests"], [`${Math.round(stats.mergedPRsPercentage)}% merged`, `${Math.round(stats.mergedPRsPercentage)}% aprovados`]],
    [compact(streaks.total), ["Contributions", "Contribuições"], ["and counting", "e subindo"]],
    [String(streaks.longest), ["Day Streak", "Dias Seguidos"], ["personal best", "recorde pessoal"]],
    [String(repos), ["Repositories", "Repositórios"], ["built & shipped", "criados e entregues"]],
    ["6+", ["Years", "Anos"], ["in production", "em produção"]],
    ["99.9%", ["Uptime", "Uptime"], ["on my SaaS", "no meu SaaS"]],
    ["MBA", ["Data Science", "Data Science"], ["& Big Data", "e Big Data"]],
    ["Summa", ["Cum Laude", "Cum Laude"], ["game dev degree", "tecnólogo em jogos"]],
  ].map(([big, label, sub]) => [big, T(label, li), T(sub, li)]);

  const W = 1000,
    COLS = 5,
    CW = W / COLS,
    RH = 158,
    R = 40;
  const rows = Math.ceil(items.length / COLS);
  const H = rows * RH + 10;

  const hex = (cx, cy, r) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 180) * (60 * i - 90);
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ");

  const cells = items
    .map(([big, label, sub], i) => {
      const cx = (i % COLS) * CW + CW / 2;
      const cy = Math.floor(i / COLS) * RH + 62;
      const size = big.length > 5 ? 15 : big.length > 3 ? 18 : 22;
      return `  <g class="a" style="animation-delay:${(0.06 + i * 0.06).toFixed(2)}s">
    <polygon class="hexbg" points="${hex(cx, cy, R)}"/>
    <polygon class="hexln" points="${hex(cx, cy, R)}"/>
    <text class="av" x="${cx.toFixed(1)}" y="${cy + size / 3}" text-anchor="middle" style="font-size:${size}px">${esc(big)}</text>
    <text class="al" x="${cx.toFixed(1)}" y="${cy + R + 26}" text-anchor="middle">${esc(label)}</text>
    <text class="as" x="${cx.toFixed(1)}" y="${cy + R + 43}" text-anchor="middle">${esc(sub)}</text>
  </g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Achievements: ${esc(items.map((i) => `${i[0]} ${i[1]}`).join(", "))}">
  <defs>
    <linearGradient id="ag" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${C.title}"/>
      <stop offset="100%" stop-color="${C.accent}"/>
    </linearGradient>
    <style>
      .hexbg { fill: url(#ag); fill-opacity: .13 }
      .hexln { fill: none; stroke: url(#ag); stroke-width: 2 }
      .av { font: 700 22px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.text} }
      .al { font: 700 12px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.title}; letter-spacing: .4px }
      .as { font: 400 10.5px 'Segoe UI', Ubuntu, sans-serif; fill: ${C.muted} }
      .a { opacity: 0; animation: rise .55s cubic-bezier(.2,.8,.3,1) forwards }
      @keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.95) } to { opacity: 1; transform: none } }${lightCss(`        .av { fill: ${L.text} }
        .al { fill: ${L.title} }
        .as { fill: ${L.muted} }`)}
    </style>
  </defs>
${cells}
</svg>`;
}

// ---------------------------------------------------------------------------
// Rodapé
// ---------------------------------------------------------------------------

function buildFooter(li) {
  const sig = T(
    ["thanks for scrolling — let's build something together", "obrigado por rolar até aqui — vamos construir algo juntos"],
    li,
  );
  const W = 1000,
    H = 130;
  const wave = (y, amp, color, op, dur, delay) => `
  <g opacity="${op}">
    <path fill="${color}" d="M0,${y} C 150,${y + amp} 350,${y - amp} 500,${y} C 650,${y + amp} 850,${y - amp} 1000,${y} L1000,0 L0,0 Z">
      <animateTransform attributeName="transform" type="translate"
        values="0,0; 30,-5; 0,0; -30,5; 0,0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>
    </path>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="">
  <defs>
    <linearGradient id="fg" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#241a3a"/>
      <stop offset="100%" stop-color="#0D0C1D"/>
    </linearGradient>
    <style>
      .sig { font: 500 12px 'Consolas','Fira Code',monospace; fill: ${C.muted}; letter-spacing: 1.4px }
    </style>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fg)"/>
  ${wave(56, 14, C.accent, 0.22, 15, 0)}
  ${wave(42, 11, C.title, 0.18, 19, 1.5)}
  <text class="sig" x="500" y="112" text-anchor="middle">${esc(sig)}</text>
</svg>`;
}

// ---------------------------------------------------------------------------
// Cards do github-readme-stats (rodados localmente, com o seu token)
// ---------------------------------------------------------------------------

/** simple-icons fornece os paths dos logos usados em stack.svg. */
async function loadSimpleIcons() {
  const dir = join(CACHE, "icons");
  if (!existsSync(join(dir, "node_modules", "simple-icons"))) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{"name":"icons","private":true}\n');
    log("  · instalando simple-icons…");
    execSync("npm install simple-icons --no-audit --no-fund --silent", {
      cwd: dir,
      stdio: "inherit",
    });
  }
  return (await import("file:///" + join(dir, "node_modules", "simple-icons", "index.mjs").replace(/\\/g, "/"))).default ??
    (await import("file:///" + join(dir, "node_modules", "simple-icons", "index.mjs").replace(/\\/g, "/")));
}

async function buildStatsCards() {
  const repo = join(CACHE, "github-readme-stats");
  if (!existsSync(repo)) {
    mkdirSync(CACHE, { recursive: true });
    log("  · clonando github-readme-stats…");
    execSync(
      `git clone --depth 1 -q https://github.com/anuraghazra/github-readme-stats.git "${repo}"`,
      { stdio: "inherit" },
    );
    log("  · instalando dependências…");
    execSync("npm install --omit=dev --no-audit --no-fund --silent --ignore-scripts", {
      cwd: repo,
      stdio: "inherit",
    });
  }

  process.env.PAT_1 = token();

  const src = (p) => "file:///" + join(repo, "src", p).replace(/\\/g, "/");
  const { fetchStats } = await import(src("fetchers/stats.js"));
  const { renderStatsCard } = await import(src("cards/stats.js"));
  const { fetchTopLanguages } = await import(src("fetchers/top-languages.js"));
  const { renderTopLanguages } = await import(src("cards/top-languages.js"));

  const stats = await fetchStats(USER, true, [], true);
  log(
    `  · ${stats.totalCommits} commits · ${stats.totalPRs} PRs · rank ${stats.rank.level}`,
  );
  const langs = await fetchTopLanguages(USER, [], 1, 0);

  const base = { theme: "radical", hide_border: true, border_radius: 8 };
  for (const { i, suffix } of LANGS) {
    write(
      `stats${suffix}.svg`,
      renderStatsCard(stats, {
        ...base,
        show_icons: true,
        include_all_commits: true,
        rank_icon: "github",
        custom_title: T(["GitHub Stats", "Estatísticas do GitHub"], i),
      }),
    );
    write(
      `top-langs${suffix}.svg`,
      renderTopLanguages(langs, {
        ...base,
        layout: "compact",
        langs_count: 8,
        custom_title: T(["Most Used Languages", "Linguagens Mais Usadas"], i),
      }),
    );
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Cobrinha
// ---------------------------------------------------------------------------

function buildSnake() {
  const env = { ...process.env, GITHUB_TOKEN: token() };
  execSync(
    `npx --yes generate-snake-animation --github_user=${USER}` +
      ` --output="${join(OUT, "github-snake.svg")}"` +
      ` --output="${join(OUT, "github-snake-dark.svg")}?palette=github-dark"`,
    { stdio: "inherit", env },
  );
  log("  ✓ github-snake.svg + github-snake-dark.svg");
}

// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });

  log("\n▸ Banner (idioma-neutro)");
  write("banner.svg", buildBanner());

  log("\n▸ Assets bilíngues (en + pt-BR)");
  const si = await loadSimpleIcons();
  for (const { i, suffix } of LANGS) {
    write(`typing${suffix}.svg`, buildTyping(i));
    write(`footer${suffix}.svg`, buildFooter(i));
    write(`stack${suffix}.svg`, buildStack(si, i));
    write(`metrics${suffix}.svg`, buildMetrics(i));
  }

  log("\n▸ Contribuições (via GraphQL, inclui repositórios privados)");
  const days = fetchCalendar();
  const streaks = computeStreaks(days);
  log(
    `  · ${streaks.total.toLocaleString("en-US")} contribuições · streak atual ${streaks.current}d · maior ${streaks.longest}d`,
  );
  for (const { i, suffix } of LANGS) {
    write(`streak${suffix}.svg`, buildStreak(streaks, i));
    write(`activity${suffix}.svg`, buildActivity(days, i));
  }

  log("\n▸ Cards de stats");
  const stats = await buildStatsCards();

  log("\n▸ Conquistas");
  const { user } = gh(
    `query($login:String!){user(login:$login){repositories(ownerAffiliations:OWNER,isFork:false){totalCount}}}`,
    { login: USER },
  );
  for (const { i, suffix } of LANGS) {
    write(
      `achievements${suffix}.svg`,
      buildAchievements({ stats, streaks, repos: user.repositories.totalCount }, i),
    );
  }

  if (SKIP_SNAKE) {
    log("\n▸ Cobrinha ignorada (--no-snake)");
  } else {
    log("\n▸ Cobrinha (leva ~1 min)");
    buildSnake();
  }

  log("\n✅ Tudo gerado em profile/assets/\n");
}

main().catch((e) => {
  console.error("\n❌ Falhou:", e.message);
  process.exit(1);
});
