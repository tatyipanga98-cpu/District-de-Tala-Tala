// =========================================================================
// js/charts.js — Graphiques SVG minimalistes, sans dépendance.
// Exposé globalement via window.TTChart pour rester compatible
// avec le chargement <script> classique (non module).
// =========================================================================

function esc(s) {
  return String(s != null ? s : '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function lineChart(opts) {
  const {
    data = [], labels = [],
    width = 600, height = 220,
    ariaLabel = 'Évolution',
    annotations = [],
    formatter = (v) => String(v),
  } = opts;

  if (data.length < 2) return { svg: '', table: '' };

  const pad = { t: 24, r: 16, b: 30, l: 48 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(...data, 1);
  const min = 0;
  const range = max - min || 1;

  const xAt = (i) => pad.l + (i / (data.length - 1)) * w;
  const yAt = (v) => pad.t + h - ((v - min) / range) * h;

  let grid = '';
  for (let f = 0; f <= 4; f++) {
    const y = pad.t + h - (f / 4) * h;
    const val = Math.round(min + (f / 4) * range);
    grid += `<line x1="${pad.l}" y1="${y}" x2="${pad.l + w}" y2="${y}"
              stroke="currentColor" stroke-opacity="0.08" stroke-width="1"/>`;
    grid += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end"
              font-size="10" fill="currentColor" fill-opacity="0.55">${esc(formatter(val))}</text>`;
  }

  const d = data.map((v, i) =>
    `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`
  ).join(' ');

  const points = data.map((v, i) =>
    `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="2.5"
             fill="var(--navy)"/>`
  ).join('');

  const step = data.length > 8 ? 2 : 1;
  const xLabels = labels.map((l, i) =>
    (i % step === 0 || i === labels.length - 1)
      ? `<text x="${xAt(i).toFixed(1)}" y="${height - 8}"
               text-anchor="middle" font-size="10"
               fill="currentColor" fill-opacity="0.55">${esc(l)}</text>`
      : ''
  ).join('');

  const annos = annotations.map((a) => {
    if (!Number.isInteger(a.index) || !data[a.index]) return '';
    const x = xAt(a.index), y = yAt(data[a.index]);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--navy)"/>
            <text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle"
                  font-size="10" font-weight="600" fill="var(--navy)">${esc(a.label)}</text>`;
  }).join('');

  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}" class="chart-line">
    ${grid}
    <path d="${d}" fill="none" stroke="var(--navy)" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round"/>
    ${points}
    ${xLabels}
    ${annos}
  </svg>`;

  const table = `<table class="sr-only">
    <caption>${esc(ariaLabel)}</caption>
    <thead><tr><th>Période</th><th>Valeur</th></tr></thead>
    <tbody>${data.map((v, i) => `<tr><td>${esc((labels[i] != null ? labels[i] : i))}</td><td>${esc(formatter(v))}</td></tr>`).join('')}</tbody>
  </table>`;

  return { svg, table };
}

function barChart(opts) {
  const {
    items = [], width = 600, barHeight = 28, gap = 6,
    ariaLabel = 'Classement', highlightIndex = -1,
    formatter = (v) => String(v),
  } = opts;

  if (!items.length) return { svg: '', table: '' };

  const labelW = 130, valueW = 56;
  const barW = width - labelW - valueW;
  const max = Math.max(...items.map((i) => i.value), 1);
  const height = items.length * (barHeight + gap);

  const bars = items.map((item, i) => {
    const y = i * (barHeight + gap);
    const bw = Math.max(2, (item.value / max) * barW);
    const hi = i === highlightIndex;
    return `
      <text x="0" y="${y + barHeight * 0.7}" font-size="12"
            fill="currentColor" text-anchor="start">${esc(item.label)}</text>
      <rect x="${labelW}" y="${y}" width="${bw.toFixed(1)}"
            height="${barHeight}" rx="2"
            fill="var(--navy)" ${hi ? 'opacity="0.85"' : ''}/>
      <text x="${width - 4}" y="${y + barHeight * 0.7}" font-size="12"
            fill="currentColor" text-anchor="end"
            style="font-variant-numeric: tabular-nums">${esc(formatter(item.value))}</text>
    `;
  }).join('');

  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}" class="chart-bar">${bars}</svg>`;

  const table = `<table class="sr-only">
    <caption>${esc(ariaLabel)}</caption>
    <thead><tr><th>Élément</th><th>Valeur</th></tr></thead>
    <tbody>${items.map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(formatter(i.value))}</td></tr>`).join('')}</tbody>
  </table>`;

  return { svg, table };
}

function stackedBar(opts) {
  const {
    segments = [], width = 600, height = 44,
    ariaLabel = 'Répartition', formatter = (v) => String(v),
  } = opts;

  if (!segments.length) return { svg: '', legend: '', table: '' };

  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const colors = ['var(--navy)', 'var(--sky)', '#7cc8ff'];

  let x = 0;
  const rects = segments.map((s, i) => {
    const w = (s.value / total) * width;
    const pct = Math.round((s.value / total) * 100);
    const showLabel = w > 60;
    const fill = colors[i % colors.length];
    const textColor = i < 2 ? '#fff' : 'var(--ink)';
    const rect = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${height}" fill="${fill}"/>`;
    const label = showLabel
      ? `<text x="${(x + w / 2).toFixed(1)}" y="${height / 2 + 4}" text-anchor="middle"
              font-size="12" font-weight="600" fill="${textColor}">${pct}%</text>`
      : '';
    x += w;
    return rect + label;
  }).join('');

  const svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}" class="chart-stack">${rects}</svg>`;

  const legend = `<ul class="chart-legend" aria-hidden="true">
    ${segments.map((s, i) =>
      `<li><span style="background:${colors[i % colors.length]}"></span>${esc(s.label)} (${esc(formatter(s.value))})</li>`
    ).join('')}
  </ul>`;

  const table = `<table class="sr-only">
    <caption>${esc(ariaLabel)}</caption>
    <thead><tr><th>Type</th><th>Valeur</th></tr></thead>
    <tbody>${segments.map((s) => `<tr><td>${esc(s.label)}</td><td>${esc(formatter(s.value))}</td></tr>`).join('')}</tbody>
  </table>`;

  return { svg, legend, table };
}

function animateCounter(el, target, opts = {}) {
  const { duration = 500, formatter = (v) => v.toLocaleString('fr-FR') } = opts;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = formatter(target);
    return;
  }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatter(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Exposition globale pour compatibilité <script> classique
window.TTChart = { lineChart, barChart, stackedBar, animateCounter };