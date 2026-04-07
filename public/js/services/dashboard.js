import { REASON_COLORS, REASONS, SECTOR_OPTIONS, brl, escapeHtml, formatDate, num } from "./classificacao.js";
import { currentFilterSummary } from "./filtros.js";

function renderEmpty(message) {
  return `<div class="empty">${message}</div>`;
}

function chartLabelsFromMap(map) {
  return Object.keys(map).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
}

export function renderDashboard(state, refs) {
  const dashboardItems = state.filtered.filter((item) => item.type !== "Outros");
  const basis = refs.basis.value;
  const notesCount = new Set(dashboardItems.map((item) => item.noteKey)).size;
  const total = dashboardItems.reduce((sum, item) => sum + item.value, 0);
  const loss = dashboardItems.filter((item) => item.type === "Perdas").reduce((sum, item) => sum + item.value, 0);
  const usage = dashboardItems.filter((item) => item.type === "Uso/Consumo").reduce((sum, item) => sum + item.value, 0);
  const stores = {};
  dashboardItems.forEach((item) => { stores[item.store] = (stores[item.store] || 0) + item.value; });
  const topStore = Object.entries(stores).sort((a, b) => b[1] - a[1])[0];

  refs.kpiNotes.textContent = notesCount;
  refs.kpiTotal.textContent = brl(total);
  refs.kpiLoss.textContent = brl(loss);
  refs.kpiUsage.textContent = brl(usage);
  refs.kpiStore.textContent = topStore ? topStore[0] : "-";

  refs.storesBody.innerHTML = Object.entries(stores).sort((a, b) => b[1] - a[1]).map(([storeName, value]) => {
    const storeItems = dashboardItems.filter((item) => item.store === storeName);
    const monthGroups = {};
    storeItems.forEach((item) => {
      const monthValue = basis === "competence" ? item.competenceMonth : item.emissionMonth;
      if (!monthGroups[monthValue]) monthGroups[monthValue] = { total: 0, loss: 0, usage: 0, notes: new Set() };
      monthGroups[monthValue].total += item.value;
      if (item.type === "Perdas") monthGroups[monthValue].loss += item.value;
      if (item.type === "Uso/Consumo") monthGroups[monthValue].usage += item.value;
      monthGroups[monthValue].notes.add(item.noteKey);
    });
    const monthRows = chartLabelsFromMap(monthGroups).map((month) => {
      const info = monthGroups[month];
      return `<div class="store-month-row"><div><strong>${escapeHtml(month)}</strong><span>${info.notes.size} nota(s)</span></div><strong>${brl(info.total)}</strong><strong>${brl(info.loss)}</strong><strong>${brl(info.usage)}</strong><strong>${info.notes.size}</strong></div>`;
    }).join("");
    return `<details class="sector-accordion"><summary><div><strong>${escapeHtml(storeName)}</strong><div class="sector-meta">${new Set(storeItems.map((item) => item.noteKey)).size} nota(s)</div></div><div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><span>${brl(value)}</span><span class="sector-meta">Perdas ${brl(storeItems.filter((item) => item.type === "Perdas").reduce((sum, item) => sum + item.value, 0))}</span><span class="sector-meta">Uso ${brl(storeItems.filter((item) => item.type === "Uso/Consumo").reduce((sum, item) => sum + item.value, 0))}</span></div></summary><div class="store-month-grid">${monthRows}</div></details>`;
  }).join("") || renderEmpty("Nenhum XML importado ainda.");

  const sectors = {};
  dashboardItems.forEach((item) => {
    if (!sectors[item.sector]) sectors[item.sector] = { total: 0, reasons: {} };
    sectors[item.sector].total += item.value;
    const reason = item.reason || "Sem motivo";
    if (!sectors[item.sector].reasons[reason]) sectors[item.sector].reasons[reason] = { value: 0, items: 0, notes: new Set() };
    sectors[item.sector].reasons[reason].value += item.value;
    sectors[item.sector].reasons[reason].items += 1;
    sectors[item.sector].reasons[reason].notes.add(item.noteKey);
  });

  refs.sectorBox.innerHTML = Object.entries(sectors).sort((a, b) => b[1].total - a[1].total).map(([sectorName, data]) => {
    const reasons = Object.entries(data.reasons).sort((a, b) => b[1].value - a[1].value);
    return `<details class="sector-accordion"><summary><div><strong>${escapeHtml(sectorName)}</strong><div class="sector-meta">${reasons.length} motivo(s)</div></div><span>${brl(data.total)}</span></summary><div class="sector-details">${reasons.map(([reason, info]) => `<div class="sector-reason"><div><strong>${escapeHtml(reason)}</strong><span>${info.items} item(ns) · ${info.notes.size} nota(s)</span></div><strong>${brl(info.value)}</strong></div>`).join("")}</div></details>`;
  }).join("") || renderEmpty("Nenhum XML importado ainda.");

  const productMap = {};
  dashboardItems.forEach((item) => {
    const key = (item.product || "Produto").trim() || "Produto";
    const monthValue = basis === "competence" ? item.competenceMonth : item.emissionMonth;
    if (!productMap[key]) productMap[key] = { value: 0, quantity: 0, items: 0, notes: new Set(), reasons: {}, stores: {} };
    productMap[key].value += Number(item.value || 0);
    productMap[key].quantity += Number(item.quantity || 0);
    productMap[key].items += 1;
    productMap[key].notes.add(item.noteKey);
    const reason = item.reason || "Sem motivo";
    productMap[key].reasons[reason] = (productMap[key].reasons[reason] || 0) + Number(item.value || 0);
    if (!productMap[key].stores[item.store]) productMap[key].stores[item.store] = { value: 0, quantity: 0, items: 0, notes: new Set(), months: {} };
    const store = productMap[key].stores[item.store];
    store.value += Number(item.value || 0);
    store.quantity += Number(item.quantity || 0);
    store.items += 1;
    store.notes.add(item.noteKey);
    if (!store.months[monthValue]) store.months[monthValue] = { value: 0, quantity: 0, items: 0, notes: {} };
    const monthInfo = store.months[monthValue];
    monthInfo.value += Number(item.value || 0);
    monthInfo.quantity += Number(item.quantity || 0);
    monthInfo.items += 1;
    if (!monthInfo.notes[item.noteKey]) monthInfo.notes[item.noteKey] = { invoice: item.invoice, value: 0, quantity: 0, items: 0 };
    monthInfo.notes[item.noteKey].value += Number(item.value || 0);
    monthInfo.notes[item.noteKey].quantity += Number(item.quantity || 0);
    monthInfo.notes[item.noteKey].items += 1;
  });

  refs.productRanking.innerHTML = Object.entries(productMap).sort((a, b) => b[1].value - a[1].value).slice(0, 15).map(([product, data], index) => {
    const topReason = Object.entries(data.reasons).sort((a, b) => b[1] - a[1])[0];
    const storesMarkup = Object.entries(data.stores).sort((a, b) => b[1].value - a[1].value).map(([storeName, storeData]) => {
      const monthsMarkup = chartLabelsFromMap(storeData.months).map((month) => {
        const monthData = storeData.months[month];
        const notesMarkup = Object.values(monthData.notes).sort((a, b) => b.value - a.value).map((note) => `<div class="sector-reason"><div><strong>NF ${escapeHtml(note.invoice)}</strong><span>${note.items} lançamento(s) · qtd ${num(note.quantity)}</span></div><strong>${brl(note.value)}</strong></div>`).join("");
        return `<details class="sector-accordion"><summary><div><strong>${escapeHtml(month)}</strong><div class="sector-meta">${monthData.items} lançamento(s) · qtd ${num(monthData.quantity)}</div></div><span>${brl(monthData.value)}</span></summary><div class="sector-details">${notesMarkup}</div></details>`;
      }).join("");
      return `<details class="sector-accordion"><summary><div><strong>${escapeHtml(storeName)}</strong><div class="sector-meta">${storeData.notes.size} nota(s) · ${storeData.items} lançamento(s) · qtd ${num(storeData.quantity)}</div></div><strong>${brl(storeData.value)}</strong></summary><div class="sector-details">${monthsMarkup}</div></details>`;
    }).join("");
    return `<details class="sector-accordion"><summary><div style="display:flex;align-items:center;gap:12px"><div class="rank-pos">${index + 1}</div><div><strong>${escapeHtml(product)}</strong><div class="sector-meta">${data.notes.size} nota(s) · ${data.items} lançamento(s)</div></div></div><div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><span>${brl(data.value)}</span><span class="sector-meta">Qtd ${num(data.quantity)}</span><span class="sector-meta">Motivo ${escapeHtml(topReason ? topReason[0] : "-")}</span><span class="sector-meta">${total ? ((data.value / total) * 100).toFixed(1).replace(".", ",") + "%" : "0,0%"}</span></div></summary><div class="sector-details">${storesMarkup}</div></details>`;
  }).join("") || renderEmpty("Nenhum produto no filtro atual.");

  renderCharts(state, refs);
}

export function renderCharts(state, refs) {
  const chartItems = state.filtered.filter((item) => item.type !== "Outros");
  const basis = refs.basis.value;
  const focusedSector = refs.sectorFilter.value !== "TODOS";
  if (state.monthChart) state.monthChart.destroy();
  if (state.typeChart) state.typeChart.destroy();
  if (!chartItems.length) { state.monthChart = null; state.typeChart = null; return; }

  if (focusedSector) {
    const monthMap = {}, reasonMap = {};
    chartItems.forEach((item) => {
      const month = basis === "competence" ? item.competenceMonth : item.emissionMonth;
      const reason = item.reason || "Sem motivo";
      if (!monthMap[month]) monthMap[month] = {};
      monthMap[month][reason] = (monthMap[month][reason] || 0) + item.value;
      reasonMap[reason] = (reasonMap[reason] || 0) + item.value;
    });
    const labels = chartLabelsFromMap(monthMap);
    const reasons = Object.keys(reasonMap).sort((a, b) => reasonMap[b] - reasonMap[a]);
    state.monthChart = new window.Chart(refs.monthChart, { type: "bar", data: { labels, datasets: reasons.map((reason) => ({ label: reason, data: labels.map((label) => monthMap[label][reason] || 0), backgroundColor: REASON_COLORS[reason] || "#64748b", borderRadius: 8 })) }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } } });
    state.typeChart = new window.Chart(refs.typeChart, { type: "doughnut", data: { labels: reasons, datasets: [{ data: reasons.map((reason) => reasonMap[reason] || 0), backgroundColor: reasons.map((reason) => REASON_COLORS[reason] || "#64748b") }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } } });
    return;
  }

  const typeMap = {}, monthMap = {};
  chartItems.forEach((item) => {
    typeMap[item.type] = (typeMap[item.type] || 0) + item.value;
    const month = basis === "competence" ? item.competenceMonth : item.emissionMonth;
    if (!monthMap[month]) monthMap[month] = { Perdas: 0, "Uso/Consumo": 0, "Saída entre lojas": 0 };
    monthMap[month][item.type] = (monthMap[month][item.type] || 0) + item.value;
  });
  const labels = chartLabelsFromMap(monthMap);
  state.monthChart = new window.Chart(refs.monthChart, { type: "bar", data: { labels, datasets: [{ label: "Perdas", data: labels.map((label) => monthMap[label].Perdas || 0), backgroundColor: "#0f172a", borderRadius: 8 }, { label: "Uso/Consumo", data: labels.map((label) => monthMap[label]["Uso/Consumo"] || 0), backgroundColor: "#94a3b8", borderRadius: 8 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { beginAtZero: true } } } });
  state.typeChart = new window.Chart(refs.typeChart, { type: "doughnut", data: { labels: Object.keys(typeMap), datasets: [{ data: Object.values(typeMap), backgroundColor: ["#0f172a", "#1d4ed8", "#94a3b8"] }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } } });
}

export function renderItems(state, refs) {
  const query = refs.productSearch.value.trim().toLowerCase();
  const itemRows = query ? state.filtered.filter((item) => (item.product || "").toLowerCase().includes(query)) : state.filtered;
  refs.itemsBody.innerHTML = itemRows.map((item) => `<tr><td>${formatDate(item.date)}</td><td>${escapeHtml(item.competenceMonth)}</td><td>${escapeHtml(item.store)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.sector)}</td><td>${escapeHtml(item.invoice)}</td><td>${escapeHtml(item.product)}</td><td>${num(item.quantity)}</td><td>${brl(item.value)}</td><td>${escapeHtml(item.reason || "-")}</td></tr>`).join("") || `<tr><td colspan="10">${renderEmpty(state.items.length ? "Nenhum item encontrado para esse filtro." : "Nenhum XML importado ainda.")}</td></tr>`;
  renderProductSummary(itemRows, query, refs);
}

function renderProductSummary(itemRows, query, refs) {
  if (!query) { refs.productSummary.innerHTML = renderEmpty("Pesquise um produto para ver resumo por período, notas e motivos."); return; }
  if (!itemRows.length) { refs.productSummary.innerHTML = renderEmpty("Nenhum produto encontrado para essa busca nos filtros atuais."); return; }
  const noteCount = new Set(itemRows.map((item) => item.noteKey)).size;
  const storeCount = new Set(itemRows.map((item) => item.store)).size;
  const totalValue = itemRows.reduce((sum, item) => sum + item.value, 0);
  const totalQty = itemRows.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const reasons = {};
  itemRows.forEach((item) => {
    const reason = item.reason || "Sem motivo";
    if (!reasons[reason]) reasons[reason] = { value: 0, items: 0, notes: new Set() };
    reasons[reason].value += item.value;
    reasons[reason].items += 1;
    reasons[reason].notes.add(item.noteKey);
  });
  const reasonRows = Object.entries(reasons).sort((a, b) => b[1].value - a[1].value);
  refs.productSummary.innerHTML = `<div class="summary-grid"><div class="summary-card"><div class="label">Busca</div><strong>${escapeHtml(query)}</strong></div><div class="summary-card"><div class="label">Notas no período</div><strong>${noteCount}</strong></div><div class="summary-card"><div class="label">Quantidade total</div><strong>${num(totalQty)}</strong></div><div class="summary-card"><div class="label">Valor total</div><strong>${brl(totalValue)}</strong></div></div><div class="summary-grid"><div class="summary-card"><div class="label">Itens encontrados</div><strong>${itemRows.length}</strong></div><div class="summary-card"><div class="label">Lojas</div><strong>${storeCount}</strong></div><div class="summary-card"><div class="label">Primeiro período</div><strong>${escapeHtml(itemRows[0]?.competenceMonth || "-")}</strong></div><div class="summary-card"><div class="label">Motivos</div><strong>${reasonRows.length}</strong></div></div><div class="reason-list">${reasonRows.map(([reason, info]) => `<div class="reason-chip"><div><strong>${escapeHtml(reason)}</strong><div class="hint">${info.items} item(ns) · ${info.notes.size} nota(s)</div></div><strong>${brl(info.value)}</strong></div>`).join("")}</div>`;
}

export function renderClassification(state, refs) {
  const noteKey = refs.noteSelect.value;
  const note = state.notes.find((entry) => entry.key === noteKey);
  refs.selectAll.checked = false;
  if (!note) {
    refs.classBody.innerHTML = `<tr><td colspan="5">${renderEmpty("Selecione uma nota para começar a classificação.")}</td></tr>`;
    refs.noteSummary.innerHTML = renderEmpty("Nenhuma nota selecionada.");
    return;
  }
  refs.classBody.innerHTML = note.items.map((item) => `<tr><td><input type="checkbox" data-action="toggle-selected" data-id="${escapeHtml(item.id)}" ${item.selected ? "checked" : ""}></td><td>${escapeHtml(item.product)}</td><td>${num(item.quantity)}</td><td>${brl(item.value)}</td><td><select data-action="set-reason" data-id="${escapeHtml(item.id)}"><option value="">Selecionar</option>${REASONS.map((reason) => `<option value="${escapeHtml(reason)}" ${item.reason === reason ? "selected" : ""}>${escapeHtml(reason)}</option>`).join("")}</select></td></tr>`).join("");
  refs.selectAll.checked = note.items.length > 0 && note.items.every((item) => item.selected);
  const pending = note.items.filter((item) => !item.reason).length;
  refs.noteSummary.innerHTML = `<div class="mini-item"><strong>Loja</strong><span>${escapeHtml(note.store)}</span></div><div class="mini-item"><strong>Nota</strong><span>${escapeHtml(note.invoice)}</span></div><div class="mini-item"><strong>Tipo</strong><span>${escapeHtml(note.displayType || note.type)}</span></div><div class="mini-item editor"><strong>Setor</strong><div class="inline-edit"><select id="noteSectorEdit">${SECTOR_OPTIONS.map((sector) => `<option value="${escapeHtml(sector)}" ${note.sector === sector ? "selected" : ""}>${escapeHtml(sector)}</option>`).join("")}</select><button type="button" data-action="save-sector" data-note-key="${escapeHtml(note.key)}">Salvar setor</button></div><div class="hint">Use esse ajuste quando a nota vier sem setor identificado ou com setor incorreto.</div></div><div class="mini-item"><strong>Operação</strong><span>${escapeHtml(note.operation || "-")}</span></div><div class="mini-item"><strong>Itens sem motivo</strong><span>${pending}</span></div><div class="mini-item editor"><strong>Ações</strong><div class="inline-edit"><button type="button" class="danger-btn" data-action="remove-note" data-note-key="${escapeHtml(note.key)}">Excluir esta nota</button></div><div class="hint">A exclusão remove a nota e todos os seus itens do banco e do dashboard.</div></div>`;
}

function buildReportHtml(state, refs) {
  const reportItems = state.filtered.filter((item) => item.type !== "Outros");
  const basis = refs.basis.value;
  const notesCount = new Set(reportItems.map((item) => item.noteKey)).size;
  const total = reportItems.reduce((sum, item) => sum + item.value, 0);
  const losses = reportItems.filter((item) => item.type === "Perdas").reduce((sum, item) => sum + item.value, 0);
  const usage = reportItems.filter((item) => item.type === "Uso/Consumo").reduce((sum, item) => sum + item.value, 0);
  const stores = {}, sectors = {}, reasons = {}, months = {}, products = {};
  reportItems.forEach((item) => {
    stores[item.store] = (stores[item.store] || 0) + item.value;
    sectors[item.sector] = (sectors[item.sector] || 0) + item.value;
    const reason = item.reason || "Sem motivo";
    reasons[reason] = (reasons[reason] || 0) + item.value;
    const month = basis === "competence" ? item.competenceMonth : item.emissionMonth;
    if (!months[month]) months[month] = { total: 0, notes: new Set(), losses: 0, usage: 0 };
    months[month].total += item.value;
    months[month].notes.add(item.noteKey);
    if (item.type === "Perdas") months[month].losses += item.value;
    if (item.type === "Uso/Consumo") months[month].usage += item.value;
    const product = (item.product || "Produto").trim() || "Produto";
    if (!products[product]) products[product] = { value: 0, quantity: 0, notes: new Set(), stores: {} };
    products[product].value += item.value;
    products[product].quantity += Number(item.quantity || 0);
    products[product].notes.add(item.noteKey);
    products[product].stores[item.store] = (products[product].stores[item.store] || 0) + item.value;
  });
  const topStore = Object.entries(stores).sort((a, b) => b[1] - a[1])[0];
  const topSector = Object.entries(sectors).sort((a, b) => b[1] - a[1])[0];
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
  const monthRows = chartLabelsFromMap(months).map((month) => { const data = months[month]; return `<tr><td>${escapeHtml(month)}</td><td>${data.notes.size}</td><td>${brl(data.losses)}</td><td>${brl(data.usage)}</td><td>${brl(data.total)}</td></tr>`; }).join("");
  const sectorRows = Object.entries(sectors).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([sector, value]) => `<tr><td>${escapeHtml(sector)}</td><td>${brl(value)}</td><td>${total ? ((value / total) * 100).toFixed(1).replace(".", ",") + "%" : "0,0%"}</td></tr>`).join("");
  const reasonRows = Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, value]) => `<tr><td>${escapeHtml(reason)}</td><td>${brl(value)}</td><td>${total ? ((value / total) * 100).toFixed(1).replace(".", ",") + "%" : "0,0%"}</td></tr>`).join("");
  const productRows = Object.entries(products).sort((a, b) => b[1].value - a[1].value).slice(0, 15).map(([product, data], index) => { const topStoreName = Object.entries(data.stores).sort((a, b) => b[1] - a[1])[0]; return `<tr><td>${index + 1}</td><td>${escapeHtml(product)}</td><td>${data.notes.size}</td><td>${num(data.quantity)}</td><td>${brl(data.value)}</td><td>${escapeHtml(topStoreName ? topStoreName[0] : "-")}</td></tr>`; }).join("");
  const filters = currentFilterSummary(refs).map((filter) => `<span class="chip"><strong>${escapeHtml(filter.label)}:</strong> ${escapeHtml(filter.value)}</span>`).join("") || '<span class="chip">Sem filtros específicos</span>';
  const generatedAt = new Date().toLocaleString("pt-BR");
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório Operacional de Perdas</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Tahoma,sans-serif;color:#122033;background:#eef3f9}.page{width:100%;max-width:190mm;margin:0 auto;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.08);overflow:hidden}.hero{padding:24px 26px;background:linear-gradient(135deg,#081a3a 0%,#133b73 55%,#e8f0ff 160%);color:#fff}.hero h1{margin:0;font-size:28px;line-height:1.08}.hero p{margin:10px 0 0;color:rgba(255,255,255,.82);font-size:13px;line-height:1.5}.stamp{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.stamp-box{padding:12px 14px;border:1px solid rgba(255,255,255,.18);border-radius:18px;background:rgba(255,255,255,.08);min-width:165px;text-align:right}.content{padding:20px 26px 28px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}.chip{padding:8px 10px;border-radius:999px;background:#edf4ff;border:1px solid #cfe0ff;font-size:12px;color:#17325c}.section{margin-top:18px;break-inside:avoid}.section h2{margin:0 0 10px;font-size:16px;color:#102546}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{padding:14px 16px;border-radius:18px;background:linear-gradient(180deg,#fbfdff 0%,#f4f8ff 100%);border:1px solid #dbe5f3;break-inside:avoid}.card .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#5b6f90}.card .value{margin-top:8px;font-size:24px;font-weight:800;color:#0f172a}.card .meta{margin-top:8px;font-size:12px;color:#62748f}.split{display:grid;grid-template-columns:1.15fr .85fr;gap:14px;align-items:start}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{padding:10px 12px;border-bottom:1px solid #e6ecf5;text-align:left;font-size:12px;vertical-align:top;overflow-wrap:anywhere}th{background:#f5f8fc;color:#46607f;font-weight:700}.table-card{border:1px solid #dbe5f3;border-radius:18px;overflow:hidden;background:#fff;break-inside:avoid}.summary-band{display:grid;grid-template-columns:1.2fr .8fr .8fr;gap:12px;margin-top:14px}.highlight{padding:16px;border-radius:20px;background:#0f172a;color:#fff;break-inside:avoid}.highlight .small{font-size:12px;color:rgba(255,255,255,.74)}.highlight strong{display:block;margin-top:6px;font-size:22px}.foot{margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;display:flex;justify-content:space-between;gap:12px}</style></head><body><div class="page"><div class="hero"><div class="stamp"><div><h1>Relatório Operacional de Perdas</h1><p>Documento executivo gerado a partir do filtro atual do dashboard.</p></div><div class="stamp-box"><div style="font-size:11px;opacity:.8">Gerado em</div><div style="margin-top:6px;font-weight:700">${escapeHtml(generatedAt)}</div></div></div></div><div class="content"><div class="chips">${filters}</div><div class="grid"><div class="card"><div class="label">Notas</div><div class="value">${notesCount}</div><div class="meta">Quantidade no recorte filtrado</div></div><div class="card"><div class="label">Valor total</div><div class="value">${brl(total)}</div><div class="meta">Soma consolidada do filtro</div></div><div class="card"><div class="label">Perdas</div><div class="value">${brl(losses)}</div><div class="meta">Volume classificado como perdas</div></div><div class="card"><div class="label">Uso/Consumo</div><div class="value">${brl(usage)}</div><div class="meta">Volume de uso interno</div></div></div><div class="summary-band"><div class="highlight"><div class="small">Loja com maior impacto</div><strong>${escapeHtml(topStore ? topStore[0] : "-")}</strong><div class="small">${topStore ? brl(topStore[1]) : "Sem dados"}</div></div><div class="highlight" style="background:#17325c"><div class="small">Setor dominante</div><strong>${escapeHtml(topSector ? topSector[0] : "-")}</strong><div class="small">${topSector ? brl(topSector[1]) : "Sem dados"}</div></div><div class="highlight" style="background:#1e3a8a"><div class="small">Motivo dominante</div><strong>${escapeHtml(topReason ? topReason[0] : "-")}</strong><div class="small">${topReason ? brl(topReason[1]) : "Sem dados"}</div></div></div><div class="section"><h2>Movimentação por mês</h2><div class="table-card"><table><thead><tr><th>Mês</th><th>Notas</th><th>Perdas</th><th>Uso/Consumo</th><th>Total</th></tr></thead><tbody>${monthRows || '<tr><td colspan="5">Sem dados</td></tr>'}</tbody></table></div></div><div class="section split"><div><h2>Ranking de produtos</h2><div class="table-card"><table><thead><tr><th>#</th><th>Produto</th><th>Notas</th><th>Qtd</th><th>Valor</th><th>Loja líder</th></tr></thead><tbody>${productRows || '<tr><td colspan="6">Sem dados</td></tr>'}</tbody></table></div></div><div><h2>Distribuição por setor</h2><div class="table-card"><table><thead><tr><th>Setor</th><th>Valor</th><th>Peso</th></tr></thead><tbody>${sectorRows || '<tr><td colspan="3">Sem dados</td></tr>'}</tbody></table></div><div class="section"><h2>Distribuição por motivo</h2><div class="table-card"><table><thead><tr><th>Motivo</th><th>Valor</th><th>Peso</th></tr></thead><tbody>${reasonRows || '<tr><td colspan="3">Sem dados</td></tr>'}</tbody></table></div></div></div></div><div class="foot"><span>Painel de Perdas</span><span>Use Imprimir &gt; Salvar em PDF para gerar o arquivo final.</span></div></div></div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250));<\/script></body></html>`;
}

export function openPrintReport(state, refs) {
  if (!state.filtered.length) throw new Error("Carregue ou filtre dados antes de gerar o relatório.");
  const reportWindow = window.open("about:blank", "_blank");
  if (!reportWindow) throw new Error("Não foi possível abrir a janela do relatório.");
  reportWindow.document.open();
  reportWindow.document.write(buildReportHtml(state, refs));
  reportWindow.document.close();
  reportWindow.focus();
}

export function exportJson(state) {
  if (!state.items.length) throw new Error("Não há dados para exportar.");
  const blob = new Blob([JSON.stringify({ itens: state.items }, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "gestao_perdas.json";
  link.click();
}

export function exportCsv(state) {
  if (!state.filtered.length) throw new Error("Não há dados filtrados para exportar.");
  const rows = [["emissao", "competencia", "loja", "tipo", "setor", "nota", "produto", "qtd", "valor", "motivo"], ...state.filtered.map((item) => [item.date, item.competenceMonth, item.store, item.type, item.sector, item.invoice, item.product, item.quantity, item.value, item.reason || ""])];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "gestao_perdas.csv";
  link.click();
}
