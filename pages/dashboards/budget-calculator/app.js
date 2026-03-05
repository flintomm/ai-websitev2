(function () {
  'use strict';

  const STORAGE_KEY    = 'budget_calculator_state_v2';
  const STORAGE_KEY_V1 = 'budget_calculator_state_v1';
  const CHART = { width: 620, height: 220 };

  const palette = [
    "#4fb8ff",
    "#39d98a",
    "#f7b955",
    "#ff7a90",
    "#ad8bff",
    "#70e5ff",
    "#ffd166",
    "#76f7bf",
    "#8ec5ff",
    "#ff9db6",
  ];

  const defaultState = {
    periodType: 'monthly',
    budgetTarget: 5000,
    groupBy: 'category',
    chartType: 'bar',
    metric: 'actual',
    cardOrder: ['setup', 'income', 'finale', 'expense', 'viz', 'insights'],
    cardLayout: {
      setup: { span: 3, height: 250 },
      income: { span: 3, height: 330 },
      finale: { span: 6, height: 330 },
      expense: { span: 5, height: 430 },
      viz: { span: 4, height: 430 },
      insights: { span: 3, height: 430 },
    },
    incomes: [
      { id: 1, source: "Primary Salary", amount: 6500 },
      { id: 2, source: "Side Income", amount: 400 },
    ],
    rows: [
      { id: 1, category: "Housing", item: "Rent", planned: 1900, actual: 1900 },
      { id: 2, category: "Food", item: "Groceries", planned: 600, actual: 540 },
      { id: 3, category: "Transport", item: "Gas + Transit", planned: 280, actual: 320 },
      { id: 4, category: "Utilities", item: "Electric + Water", planned: 230, actual: 210 },
    ],
  };

  let state;
  let rowId;
  let incomeId;
  let storageReady = true;

  const el = {
    periodType:   document.getElementById("period-type"),
    budgetTarget: document.getElementById("budget-target"),
    resetBtn:     document.getElementById("reset-btn"),
    addRowBtn:    document.getElementById("add-row-btn"),
    addIncomeBtn: document.getElementById("add-income-btn"),
    sheetBody:    document.getElementById("sheet-body"),
    incomeBody:   document.getElementById("income-body"),
    finaleCard:   document.querySelector(".finale-card"),
    finaleValue:  document.getElementById("finale-value"),
    finalePill:   document.getElementById("finale-pill"),
    totalIncome:  document.getElementById("total-income"),
    totalPlanned: document.getElementById("total-planned"),
    totalActual:  document.getElementById("total-actual"),
    safeToSpend:  document.getElementById("safe-to-spend"),
    ruleNeeds:    document.getElementById("rule-needs"),
    ruleWants:    document.getElementById("rule-wants"),
    ruleSavings:  document.getElementById("rule-savings"),
    leftToAssign: document.getElementById("left-to-assign"),
    groupBy:      document.getElementById("group-by"),
    chartType:    document.getElementById("chart-type"),
    metric:       document.getElementById("metric"),
    vizTitle:     document.getElementById("viz-title"),
    vizNote:      document.getElementById("viz-note"),
    vizCanvas:    document.getElementById("viz-canvas"),
    vizLegend:    document.getElementById("viz-legend"),
    linesBody:    document.getElementById("lines-body"),
  };

  // ─── Utilities ───────────────────────────────────────────────

  function cloneState(source) {
    return {
      periodType:   source.periodType,
      budgetTarget: Number(source.budgetTarget) || 0,
      groupBy:      source.groupBy   || 'category',
      chartType:    source.chartType || 'bar',
      metric:       source.metric    || 'actual',
      cardOrder: source.cardOrder ? [...source.cardOrder] : [...defaultState.cardOrder],
      cardLayout: source.cardLayout
        ? Object.fromEntries(
            Object.entries(source.cardLayout).map(([key, value]) => [
              key,
              {
                span: toSafeNumber(value.span) || defaultState.cardLayout[key]?.span || 3,
                height: toSafeNumber(value.height) || defaultState.cardLayout[key]?.height || 320,
              },
            ]),
          )
        : JSON.parse(JSON.stringify(defaultState.cardLayout)),
      incomes: source.incomes.map((income) => ({ ...income })),
      rows:    source.rows.map((row) => ({ ...row })),
    };
  }

  function toSafeNumber(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return n;
  }

  function toMoney(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function capitalize(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ─── Storage ─────────────────────────────────────────────────

  function persistState() {
    if (!storageReady) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      storageReady = false;
    }
  }

  const saveDebounced         = debounce(persistState, 120);
  const renderChartsDebounced = debounce(renderVizBoard, 400);

  function loadState() {
    function parseRaw(raw) {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      const rows = Array.isArray(parsed.rows)
        ? parsed.rows.map((row, index) => ({
            id:       Number(row.id) || index + 1,
            category: String(row.category || '').slice(0, 60),
            item:     String(row.item || '').slice(0, 80),
            planned:  toSafeNumber(row.planned),
            actual:   toSafeNumber(row.actual),
          }))
        : [];

      const incomes = Array.isArray(parsed.incomes)
        ? parsed.incomes.map((income, index) => ({
            id:     Number(income.id) || index + 1,
            source: String(income.source || '').slice(0, 80),
            amount: toSafeNumber(income.amount),
          }))
        : [];

      const VALID_CARDS = ['setup', 'income', 'finale', 'expense', 'viz', 'insights'];
      const cardOrder = Array.isArray(parsed.cardOrder) &&
        parsed.cardOrder.length === VALID_CARDS.length &&
        parsed.cardOrder.every(name => VALID_CARDS.includes(name))
          ? [...parsed.cardOrder]
          : [...defaultState.cardOrder];

      const cardLayout = { ...defaultState.cardLayout };
      if (parsed.cardLayout && typeof parsed.cardLayout === 'object') {
        VALID_CARDS.forEach((name) => {
          const entry = parsed.cardLayout[name];
          if (!entry || typeof entry !== 'object') return;
          const span = Math.max(1, Math.min(12, Math.round(Number(entry.span) || cardLayout[name].span)));
          const height = Math.max(220, Math.min(900, Math.round(Number(entry.height) || cardLayout[name].height)));
          cardLayout[name] = { span, height };
        });
      }

      return {
        periodType: ['weekly', 'monthly', 'yearly'].includes(parsed.periodType)
          ? parsed.periodType : defaultState.periodType,
        budgetTarget: toSafeNumber(parsed.budgetTarget),
        groupBy:   ['category', 'item'].includes(parsed.groupBy)
          ? parsed.groupBy : defaultState.groupBy,
        chartType: ['bar', 'donut', 'compare'].includes(parsed.chartType)
          ? parsed.chartType : defaultState.chartType,
        metric:    ['actual', 'planned', 'variance'].includes(parsed.metric)
          ? parsed.metric : defaultState.metric,
        cardOrder,
        cardLayout,
        incomes: incomes.length > 0 ? incomes : cloneState(defaultState).incomes,
        rows:    rows.length    > 0 ? rows    : cloneState(defaultState).rows,
      };
    }

    // Try v2 key
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const result = parseRaw(raw);
        if (result) return result;
      }
    } catch {
      storageReady = false;
      return cloneState(defaultState);
    }

    // Try v1 migration
    try {
      const rawV1 = sessionStorage.getItem(STORAGE_KEY_V1);
      if (rawV1) {
        const result = parseRaw(rawV1);
        sessionStorage.removeItem(STORAGE_KEY_V1);
        if (result) return result;
      }
    } catch {}

    return cloneState(defaultState);
  }

  // ─── Compute ──────────────────────────────────────────────────

  function computeTotals() {
    const totalIncome  = state.incomes.reduce((sum, income) => sum + toSafeNumber(income.amount), 0);
    const totalPlanned = state.rows.reduce((sum, row) => sum + toSafeNumber(row.planned), 0);
    const totalActual  = state.rows.reduce((sum, row) => sum + toSafeNumber(row.actual), 0);

    const budgetTarget = toSafeNumber(state.budgetTarget);
    const variance     = budgetTarget - totalActual;
    const safeToSpend  = totalIncome - totalActual;
    const leftToAssign = totalIncome - totalPlanned;

    return { totalIncome, totalPlanned, totalActual, budgetTarget, variance, safeToSpend, leftToAssign };
  }

  function normalizeRows() {
    return state.rows.map((row) => ({
      category: String(row.category || 'Uncategorized').trim() || 'Uncategorized',
      item:     String(row.item     || 'Untitled').trim()      || 'Untitled',
      planned:  toSafeNumber(row.planned),
      actual:   toSafeNumber(row.actual),
    }));
  }

  function aggregateRows(rows, groupBy) {
    const map = new Map();
    rows.forEach((row) => {
      const key = groupBy === 'item' ? row.item : row.category;
      if (!map.has(key)) {
        map.set(key, { label: key, planned: 0, actual: 0, variance: 0 });
      }
      const entry = map.get(key);
      entry.planned  += row.planned;
      entry.actual   += row.actual;
      entry.variance  = entry.actual - entry.planned;
    });
    return [...map.values()];
  }

  function getMetricValue(entry, metric) {
    if (metric === 'planned')  return entry.planned;
    if (metric === 'variance') return entry.variance;
    return entry.actual;
  }

  function sortByMetric(data, metric) {
    return data
      .slice()
      .sort((a, b) => Math.abs(getMetricValue(b, metric)) - Math.abs(getMetricValue(a, metric)));
  }

  // ─── Render ───────────────────────────────────────────────────

  function renderControls() {
    el.periodType.value   = state.periodType;
    el.budgetTarget.value = toSafeNumber(state.budgetTarget);
    el.groupBy.value      = state.groupBy;
    el.chartType.value    = state.chartType;
    el.metric.value       = state.metric;
  }

  function renderSheet() {
    el.sheetBody.innerHTML = "";
    state.rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.rowId = String(row.id);
      tr.innerHTML = `
        <td><input data-field="category" type="text" value="${escapeHtml(row.category)}" placeholder="Category" /></td>
        <td><input data-field="item" type="text" value="${escapeHtml(row.item)}" placeholder="Item" /></td>
        <td><input data-field="planned" type="number" min="0" step="0.01" value="${toSafeNumber(row.planned)}" /></td>
        <td><input data-field="actual" type="number" min="0" step="0.01" value="${toSafeNumber(row.actual)}" /></td>
        <td><button class="row-remove" type="button" data-action="remove">Remove</button></td>
      `;
      el.sheetBody.appendChild(tr);
    });
  }

  function renderIncomes() {
    el.incomeBody.innerHTML = "";
    state.incomes.forEach((income) => {
      const tr = document.createElement("tr");
      tr.dataset.incomeId = String(income.id);
      tr.innerHTML = `
        <td><input data-field="source" type="text" value="${escapeHtml(income.source)}" placeholder="Income source" /></td>
        <td><input data-field="amount" type="number" min="0" step="0.01" value="${toSafeNumber(income.amount)}" /></td>
        <td><button class="row-remove" type="button" data-action="remove-income">Remove</button></td>
      `;
      el.incomeBody.appendChild(tr);
    });
  }

  function renderFinale() {
    const { totalIncome, totalPlanned, totalActual, budgetTarget, variance, safeToSpend, leftToAssign } = computeTotals();

    let statusClass = 'neutral';
    let statusText  = 'ON TARGET';
    if (variance > 0) {
      statusClass = 'ok';
      statusText  = 'UNDER BUDGET';
    } else if (variance < 0) {
      statusClass = 'bad';
      statusText  = 'OVER BUDGET';
    }

    el.finaleCard.classList.remove('ok', 'bad', 'neutral');
    el.finaleCard.classList.add(statusClass);

    el.finaleValue.textContent  = `${variance >= 0 ? '+' : '-'} ${toMoney(Math.abs(variance))}`;
    el.finalePill.className     = `pill ${statusClass}`;
    el.finalePill.textContent   = statusText;

    el.totalIncome.textContent  = toMoney(totalIncome);
    el.totalPlanned.textContent = toMoney(totalPlanned);
    el.totalActual.textContent  = toMoney(totalActual);
    el.safeToSpend.textContent  = `${safeToSpend >= 0 ? '' : '-'}${toMoney(Math.abs(safeToSpend))}`;

    el.ruleNeeds.textContent    = toMoney(totalIncome * 0.5);
    el.ruleWants.textContent    = toMoney(totalIncome * 0.3);
    el.ruleSavings.textContent  = toMoney(totalIncome * 0.2);
    el.leftToAssign.textContent = `${leftToAssign >= 0 ? '' : '-'}${toMoney(Math.abs(leftToAssign))}`;

    if (!state.budgetTarget || state.budgetTarget <= 0) {
      state.budgetTarget = totalIncome;
      el.budgetTarget.value = toSafeNumber(state.budgetTarget);
    }
  }

  // ─── Chart Renderers ──────────────────────────────────────────

  function chartShell(width, height) {
    const h1 = Math.round(height * 0.25);
    const h2 = Math.round(height * 0.5);
    const h3 = Math.round(height * 0.75);
    return `
      <rect x="0" y="0" width="${width}" height="${height}" fill="#0a192d"></rect>
      <line x1="0" y1="${h1}" x2="${width}" y2="${h1}" stroke="rgba(130,170,220,0.18)" stroke-width="1"></line>
      <line x1="0" y1="${h2}" x2="${width}" y2="${h2}" stroke="rgba(130,170,220,0.18)" stroke-width="1"></line>
      <line x1="0" y1="${h3}" x2="${width}" y2="${h3}" stroke="rgba(130,170,220,0.18)" stroke-width="1"></line>
    `;
  }

  function renderLegend(data, metric) {
    el.vizLegend.innerHTML = "";
    sortByMetric(data, metric)
      .slice(0, 6)
      .forEach((entry, idx) => {
        const value = getMetricValue(entry, metric);
        const item  = document.createElement("div");
        item.className = "legend-item";
        item.innerHTML = `
          <span class="dot" style="background:${palette[idx % palette.length]}"></span>
          <span>${escapeHtml(entry.label)}: ${value >= 0 ? '' : '-'}${toMoney(Math.abs(value))}</span>
        `;
        el.vizLegend.appendChild(item);
      });
  }

  function renderLinesTable(data) {
    el.linesBody.innerHTML = "";
    sortByMetric(data, state.metric)
      .slice(0, 12)
      .forEach((entry) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHtml(entry.label)}</td>
          <td>${toMoney(entry.planned)}</td>
          <td>${toMoney(entry.actual)}</td>
          <td class="${entry.variance > 0 ? 'value-bad' : entry.variance < 0 ? 'value-good' : ''}">
            ${entry.variance >= 0 ? '+' : '-'} ${toMoney(Math.abs(entry.variance))}
          </td>
        `;
        el.linesBody.appendChild(tr);
      });
  }

  function renderBarChart(data, metric) {
    const top    = sortByMetric(data, metric).slice(0, 6);
    const absMax = Math.max(1, ...top.map((d) => Math.abs(getMetricValue(d, metric))));

    const width  = CHART.width;
    const height = CHART.height;
    const left   = 130;
    const right  = 18;
    const topPad = 10;
    const rowH   = (height - topPad - 18) / Math.max(top.length, 1);

    const bars = top
      .map((entry, i) => {
        const value = getMetricValue(entry, metric);
        const abs   = Math.abs(value);
        const barW  = ((width - left - right) * abs) / absMax;
        const y     = topPad + i * rowH + 4;
        const fill  = value < 0 ? "#ff7f8b" : palette[i % palette.length];
        return `
          <text x="8" y="${y + rowH * 0.5 + 3}" class="axis-label">${escapeHtml(entry.label.slice(0, 14))}</text>
          <rect x="${left}" y="${y}" width="${barW}" height="${Math.max(8, rowH - 8)}" fill="${fill}" opacity="0.92"></rect>
          <text x="${left + barW + 6}" y="${y + rowH * 0.5 + 3}" class="bar-label">${value >= 0 ? '' : '-'}${toMoney(abs)}</text>
        `;
      })
      .join("\n");

    el.vizCanvas.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        ${chartShell(width, height)}
        <line x1="${left}" y1="8" x2="${left}" y2="${height - 12}" stroke="rgba(130,170,220,0.36)" stroke-width="1"></line>
        ${bars}
      </svg>
    `;
  }

  function polarToCartesian(cx, cy, r, angle) {
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  function renderDonutChart(data, metric) {
    const top   = sortByMetric(data, metric)
      .slice(0, 6)
      .map((d) => ({ ...d, value: Math.abs(getMetricValue(d, metric)) }));
    const total = top.reduce((sum, d) => sum + d.value, 0);

    if (total <= 0) {
      el.vizCanvas.innerHTML = "<div style='padding:1rem;color:#8ea7c7'>No values available for donut chart.</div>";
      return;
    }

    const cx     = CHART.width / 2;
    const cy     = CHART.height / 2;
    const rOuter = 66;
    const rInner = 38;
    let   angle  = -Math.PI / 2;

    const arcs = top
      .map((entry, idx) => {
        const pct        = entry.value / total;
        const sweep      = pct * Math.PI * 2;
        const start      = polarToCartesian(cx, cy, rOuter, angle);
        const end        = polarToCartesian(cx, cy, rOuter, angle + sweep);
        const innerEnd   = polarToCartesian(cx, cy, rInner, angle + sweep);
        const innerStart = polarToCartesian(cx, cy, rInner, angle);
        const large      = sweep > Math.PI ? 1 : 0;
        angle += sweep;

        return `
          <path d="M ${start.x} ${start.y}
                   A ${rOuter} ${rOuter} 0 ${large} 1 ${end.x} ${end.y}
                   L ${innerEnd.x} ${innerEnd.y}
                   A ${rInner} ${rInner} 0 ${large} 0 ${innerStart.x} ${innerStart.y}
                   Z"
            fill="${palette[idx % palette.length]}" opacity="0.95"></path>
        `;
      })
      .join("\n");

    el.vizCanvas.innerHTML = `
      <svg viewBox="0 0 ${CHART.width} ${CHART.height}" preserveAspectRatio="xMidYMid meet">
        ${chartShell(CHART.width, CHART.height)}
        ${arcs}
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="bar-label">Total</text>
        <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="axis-label">${toMoney(total)}</text>
      </svg>
    `;
  }

  function renderCompareChart(data) {
    const top    = sortByMetric(data, 'actual').slice(0, 5);
    const max    = Math.max(1, ...top.flatMap((entry) => [entry.planned, entry.actual]));

    const width  = CHART.width;
    const height = CHART.height;
    const left   = 40;
    const right  = 12;
    const bottom = 30;
    const topPad = 10;
    const band   = (width - left - right) / Math.max(top.length, 1);

    const bars = top
      .map((entry, i) => {
        const x0      = left + i * band + 6;
        const w       = Math.max(8, (band - 12) / 2 - 2);
        const hPlanned = ((height - bottom - topPad) * entry.planned) / max;
        const hActual  = ((height - bottom - topPad) * entry.actual)  / max;
        const yPlanned = height - bottom - hPlanned;
        const yActual  = height - bottom - hActual;

        return `
          <rect x="${x0}" y="${yPlanned}" width="${w}" height="${hPlanned}" fill="#6fa8ff"></rect>
          <rect x="${x0 + w + 4}" y="${yActual}" width="${w}" height="${hActual}" fill="#39d98a"></rect>
          <text x="${x0 + w}" y="${height - bottom + 12}" text-anchor="middle" class="axis-label">${escapeHtml(entry.label.slice(0, 7))}</text>
        `;
      })
      .join("\n");

    el.vizCanvas.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        ${chartShell(width, height)}
        <line x1="${left}" y1="${height - bottom}" x2="${width - right}" y2="${height - bottom}" stroke="rgba(130,170,220,0.36)" stroke-width="1"></line>
        ${bars}
        <text x="${left + 6}" y="14" class="axis-label">Planned</text>
        <rect x="${left + 52}" y="8" width="12" height="5" fill="#6fa8ff"></rect>
        <text x="${left + 72}" y="14" class="axis-label">Actual</text>
        <rect x="${left + 110}" y="8" width="12" height="5" fill="#39d98a"></rect>
      </svg>
    `;
  }

  function renderVizBoard() {
    const grouped = aggregateRows(normalizeRows(), state.groupBy);
    renderLinesTable(grouped);

    if (state.chartType === 'compare') {
      renderCompareChart(grouped);
      renderLegend(grouped, 'actual');
      el.vizTitle.textContent = `${capitalize(state.groupBy)} Planned vs Actual`;
      el.vizNote.textContent  = 'Blue = planned, green = actual';
      return;
    }

    if (state.chartType === 'donut') {
      if (state.metric === 'variance') {
        state.metric    = 'actual';
        el.metric.value = 'actual';
      }
      renderDonutChart(grouped, state.metric);
      renderLegend(grouped, state.metric);
      el.vizTitle.textContent = `${capitalize(state.groupBy)} ${capitalize(state.metric)} - Donut`;
      el.vizNote.textContent  = 'Donut uses absolute values for segment sizing.';
      return;
    }

    renderBarChart(grouped, state.metric);
    renderLegend(grouped, state.metric);
    el.vizTitle.textContent = `${capitalize(state.groupBy)} ${capitalize(state.metric)} - Bar`;
    el.vizNote.textContent  = 'Negative values are highlighted in red.';
  }

  function applyCardOrder() {
    const main = document.querySelector('main');
    state.cardOrder.forEach((name) => {
      const card = main.querySelector(`.${name}-card`);
      if (card) main.appendChild(card);
    });
  }

  function applyCardLayout() {
    const main = document.querySelector('main');
    state.cardOrder.forEach((name) => {
      const card = main.querySelector(`.${name}-card`);
      if (!card) return;
      const layout = state.cardLayout[name] || defaultState.cardLayout[name];
      const span = Math.max(1, Math.min(12, Math.round(layout.span)));
      const height = Math.max(220, Math.min(900, Math.round(layout.height)));
      card.style.gridColumn = `span ${span}`;
      card.style.height = `${height}px`;
    });
  }

  function ensureResizeGrips() {
    document.querySelectorAll('main .card').forEach((card) => {
      if (card.querySelector('.resize-grip')) return;
      const grip = document.createElement('button');
      grip.type = 'button';
      grip.className = 'resize-grip';
      grip.setAttribute('aria-label', 'Resize card');
      card.appendChild(grip);
    });
  }

  function renderAll() {
    renderControls();
    renderIncomes();
    renderSheet();
    renderFinale();
    renderVizBoard();
    applyCardOrder();
    applyCardLayout();
    ensureResizeGrips();
  }

  // ─── Mutations ────────────────────────────────────────────────

  function addRow() {
    state.rows.push({ id: rowId++, category: '', item: '', planned: 0, actual: 0 });
    renderAll();
    saveDebounced();
    const lastTr = el.sheetBody.querySelector('tr:last-child');
    if (lastTr) {
      lastTr.classList.add('row-new');
      lastTr.addEventListener('animationend', () => lastTr.classList.remove('row-new'), { once: true });
    }
  }

  function removeRow(id) {
    if (state.rows.length <= 1) return;
    state.rows = state.rows.filter((row) => row.id !== id);
    renderAll();
    saveDebounced();
  }

  function addIncome() {
    state.incomes.push({ id: incomeId++, source: '', amount: 0 });
    renderAll();
    saveDebounced();
  }

  function removeIncome(id) {
    if (state.incomes.length <= 1) return;
    state.incomes = state.incomes.filter((income) => income.id !== id);
    renderAll();
    saveDebounced();
  }

  function resetSession() {
    if (storageReady) {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        storageReady = false;
      }
    }
    state    = cloneState(defaultState);
    rowId    = state.rows.length + 1;
    incomeId = state.incomes.length + 1;
    renderAll();
  }

  // ─── Events ───────────────────────────────────────────────────

  function bindEvents() {
    el.periodType.addEventListener('change', () => {
      state.periodType = el.periodType.value;
      saveDebounced();
    });

    el.budgetTarget.addEventListener('input', () => {
      state.budgetTarget = toSafeNumber(el.budgetTarget.value);
      renderFinale();
      saveDebounced();
    });

    el.groupBy.addEventListener('change', () => {
      state.groupBy = el.groupBy.value;
      saveDebounced();
      renderVizBoard();
    });

    el.chartType.addEventListener('change', () => {
      state.chartType = el.chartType.value;
      saveDebounced();
      renderVizBoard();
    });

    el.metric.addEventListener('change', () => {
      state.metric = el.metric.value;
      saveDebounced();
      renderVizBoard();
    });

    el.addRowBtn.addEventListener('click', addRow);
    el.addIncomeBtn.addEventListener('click', addIncome);
    el.resetBtn.addEventListener('click', resetSession);

    el.incomeBody.addEventListener('input', (event) => {
      const input = event.target.closest('input[data-field]');
      if (!input) return;

      const tr = input.closest('tr');
      if (!tr) return;

      const id     = Number(tr.dataset.incomeId);
      const income = state.incomes.find((entry) => entry.id === id);
      if (!income) return;

      const field = input.dataset.field;
      if (field === 'amount') {
        income.amount = toSafeNumber(input.value);
      } else {
        income.source = input.value;
      }

      renderFinale();
      saveDebounced();
    });

    el.incomeBody.addEventListener('click', (event) => {
      const button = event.target.closest("button[data-action='remove-income']");
      if (!button) return;

      const tr = button.closest('tr');
      if (!tr) return;

      removeIncome(Number(tr.dataset.incomeId));
    });

    el.sheetBody.addEventListener('input', (event) => {
      const input = event.target.closest('input[data-field]');
      if (!input) return;

      const tr = input.closest('tr');
      if (!tr) return;

      const id  = Number(tr.dataset.rowId);
      const row = state.rows.find((entry) => entry.id === id);
      if (!row) return;

      const field = input.dataset.field;
      if (field === 'planned' || field === 'actual') {
        row[field] = toSafeNumber(input.value);
      } else {
        row[field] = input.value;
      }

      renderFinale();
      renderChartsDebounced();
      saveDebounced();
    });

    el.sheetBody.addEventListener('click', (event) => {
      const button = event.target.closest("button[data-action='remove']");
      if (!button) return;

      const tr = button.closest('tr');
      if (!tr) return;

      removeRow(Number(tr.dataset.rowId));
    });
  }

  // ─── Drag & Drop ─────────────────────────────────────────────

  function initDragDrop() {
    const VALID_CARDS = ['setup', 'income', 'finale', 'expense', 'viz', 'insights'];
    const main = document.querySelector('main');
    const DRAG_THRESHOLD = 6;
    const EDGE_SCROLL_ZONE = 64;
    const EDGE_SCROLL_STEP = 18;

    let pressedCard = null;
    let pressedId = null;
    let startX = 0;
    let startY = 0;
    let dragging = null;
    let ghost = null;
    let offsetX = 0;
    let offsetY = 0;

    function getCardName(card) {
      return VALID_CARDS.find((name) => card.classList.contains(`${name}-card`)) || null;
    }

    function buildGhost(card, clientX, clientY) {
      const rect = card.getBoundingClientRect();
      offsetX = clientX - rect.left;
      offsetY = clientY - rect.top;
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.style.width = rect.width + 'px';
      ghost.style.height = rect.height + 'px';
      ghost.innerHTML = card.querySelector('.card-head').outerHTML;
      ghost.style.left = (clientX - offsetX) + 'px';
      ghost.style.top = (clientY - offsetY) + 'px';
      document.body.appendChild(ghost);
    }

    function updateHoverTarget(clientX, clientY) {
      if (!ghost) return null;
      ghost.style.display = 'none';
      const hit = document.elementFromPoint(clientX, clientY);
      ghost.style.display = '';

      const target = hit && hit.closest('.card');
      main.querySelectorAll('.card').forEach((card) => card.classList.remove('drop-target'));
      if (target && target !== dragging) {
        target.classList.add('drop-target');
        return target;
      }
      return null;
    }

    function autoScrollViewport(clientY) {
      if (clientY < EDGE_SCROLL_ZONE) {
        window.scrollBy(0, -EDGE_SCROLL_STEP);
      } else if (clientY > window.innerHeight - EDGE_SCROLL_ZONE) {
        window.scrollBy(0, EDGE_SCROLL_STEP);
      }
    }

    function swapCardOrder(dragCard, dropCard) {
      const dragName = getCardName(dragCard);
      const dropName = getCardName(dropCard);
      if (!dragName || !dropName || dragName === dropName) return;

      const order = [...state.cardOrder];
      const dragIndex = order.indexOf(dragName);
      const dropIndex = order.indexOf(dropName);
      if (dragIndex < 0 || dropIndex < 0) return;

      [order[dragIndex], order[dropIndex]] = [order[dropIndex], order[dragIndex]];
      state.cardOrder = order;
      applyCardOrder();
      saveDebounced();
    }

    main.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.card-head');
      if (!handle) return;
      if (e.target.closest('button, input, select')) return;

      const card = handle.closest('.card');
      if (!card) return;

      e.preventDefault();
      pressedCard = card;
      pressedId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      main.setPointerCapture(e.pointerId);
    });

    main.addEventListener('pointermove', (e) => {
      if (!pressedCard || e.pointerId !== pressedId) return;

      if (!dragging) {
        const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (moved < DRAG_THRESHOLD) return;
        dragging = pressedCard;
        dragging.classList.add('is-dragging');
        document.body.classList.add('drag-active');
        buildGhost(dragging, e.clientX, e.clientY);
      }

      if (!ghost) return;
      ghost.style.left = (e.clientX - offsetX) + 'px';
      ghost.style.top  = (e.clientY - offsetY) + 'px';
      updateHoverTarget(e.clientX, e.clientY);
      autoScrollViewport(e.clientY);
    });

    main.addEventListener('pointerup', (e) => {
      if (!pressedCard || e.pointerId !== pressedId) return;

      if (dragging) {
        const target = updateHoverTarget(e.clientX, e.clientY);
        if (target && target !== dragging) {
          swapCardOrder(dragging, target);
        }
      }

      cleanup();
    });

    main.addEventListener('pointercancel', cleanup);

    function cleanup() {
      pressedCard = null;
      pressedId = null;
      if (ghost) { ghost.remove(); ghost = null; }
      if (dragging) { dragging.classList.remove('is-dragging'); dragging = null; }
      document.body.classList.remove('drag-active');
      main.querySelectorAll('.card').forEach(c => c.classList.remove('drop-target'));
    }
  }

  function initResize() {
    const main = document.querySelector('main');
    const MIN_HEIGHT = 220;
    const MAX_HEIGHT = 900;
    const MIN_SPAN = 2;
    const MAX_SPAN = 12;

    let activeCard = null;
    let activeCardName = null;
    let startX = 0;
    let startY = 0;
    let startHeight = 0;
    let startSpan = 0;
    let activePointerId = null;

    function getCardName(card) {
      const classes = ['setup', 'income', 'finale', 'expense', 'viz', 'insights'];
      return classes.find((name) => card.classList.contains(`${name}-card`)) || null;
    }

    function getGridMetrics() {
      const style = getComputedStyle(main);
      const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
      const totalGap = gap * 11;
      const usable = Math.max(1, main.clientWidth - totalGap);
      const colWidth = usable / 12;
      return { colWidth };
    }

    main.addEventListener('pointerdown', (event) => {
      const grip = event.target.closest('.resize-grip');
      if (!grip) return;

      const card = grip.closest('.card');
      if (!card) return;
      const cardName = getCardName(card);
      if (!cardName) return;

      event.preventDefault();
      event.stopPropagation();

      activeCard = card;
      activeCardName = cardName;
      activePointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startHeight = card.getBoundingClientRect().height;
      startSpan = state.cardLayout[cardName]?.span || defaultState.cardLayout[cardName].span;

      activeCard.classList.add('is-resizing');
      document.body.classList.add('resize-active');
      main.setPointerCapture(event.pointerId);
    });

    main.addEventListener('pointermove', (event) => {
      if (!activeCard || event.pointerId !== activePointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const { colWidth } = getGridMetrics();
      const spanDelta = Math.round(dx / Math.max(1, colWidth));

      const nextSpan = Math.max(MIN_SPAN, Math.min(MAX_SPAN, startSpan + spanDelta));
      const nextHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(startHeight + dy)));

      state.cardLayout[activeCardName] = { span: nextSpan, height: nextHeight };
      applyCardLayout();
    });

    main.addEventListener('pointerup', (event) => {
      if (!activeCard || event.pointerId !== activePointerId) return;
      cleanup(true);
    });

    main.addEventListener('pointercancel', () => cleanup(false));

    function cleanup(shouldSave) {
      if (activeCard) activeCard.classList.remove('is-resizing');
      document.body.classList.remove('resize-active');
      activeCard = null;
      activeCardName = null;
      activePointerId = null;
      if (shouldSave) saveDebounced();
    }
  }

  // ─── Init ─────────────────────────────────────────────────────

  state    = loadState();
  rowId    = state.rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  incomeId = state.incomes.reduce((max, income) => Math.max(max, income.id), 0) + 1;
  renderAll();
  initDragDrop();
  initResize();
  bindEvents();

})();
