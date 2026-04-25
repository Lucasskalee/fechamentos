import { SECTOR_OPTIONS, brl, escapeHtml, formatDate, num, sortLabels } from "./services/classificacao.js";
import {
  MONTHS,
  STATUS_META,
  clearFechamentoCache,
  fetchCellNotes,
  fetchGrid,
  fetchNoteItems,
  invalidateCellCache,
  saveEntryAudit,
  saveNoteAudit
} from "./services/fechamento.js";

const refs = {
  storeFilter: document.getElementById("storeFilter"),
  yearFilter: document.getElementById("yearFilter"),
  typeFilter: document.getElementById("typeFilter"),
  statusFilter: document.getElementById("statusFilter"),
  refreshBtn: document.getElementById("refreshBtn"),
  clearBtn: document.getElementById("clearBtn"),
  statusBanner: document.getElementById("statusBanner"),
  summaryCards: document.getElementById("summaryCards"),
  gridState: document.getElementById("gridState"),
  gridTable: document.getElementById("gridTable"),
  drawer: document.getElementById("drawer"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  drawerClose: document.getElementById("drawerClose"),
  drawerTitle: document.getElementById("drawerTitle"),
  drawerMeta: document.getElementById("drawerMeta"),
  drawerBody: document.getElementById("drawerBody"),
  pageLoading: document.getElementById("pageLoading"),
  loadingText: document.getElementById("loadingText"),
  toast: document.getElementById("toast"),
  connectionBadge: document.getElementById("connectionBadge"),
  lastSyncLabel: document.getElementById("lastSyncLabel"),
  currentTime: document.getElementById("currentTime"),
  metaYear: document.getElementById("metaYear")
};

const state = {
  allRows: [],
  grid: { rows: [], totalsByMonth: [], summary: defaultSummary() },
  filters: {
    store: "TODAS",
    year: new Date().getFullYear(),
    type: "TODOS",
    status: "TODOS"
  },
  loadingGrid: false,
  gridError: "",
  drawerOpen: false,
  selectedCell: null,
  notes: [],
  notesPage: 0,
  hasMoreNotes: false,
  totalNotes: 0,
  notesLoading: false,
  notesError: "",
  selectedNoteKey: "",
  noteItems: [],
  itemsLoading: false,
  itemsError: "",
  savingCell: false,
  savingNote: false,
  toastTimer: null
};

function defaultSummary() {
  return {
    totalValue: 0,
    noteCount: 0,
    pendingCount: 0,
    divergentCount: 0,
    checkedCount: 0
  };
}

function setStatus(type, message) {
  refs.statusBanner.className = `status ${type}`;
  refs.statusBanner.textContent = message;
  if (refs.connectionBadge) {
    refs.connectionBadge.textContent = ({
      info: "Sincronizacao em leitura",
      success: "Fechamento sincronizado",
      warning: "Atencao no recorte",
      error: "Falha na leitura"
    })[type] || "Painel operacional";
  }
  if (refs.lastSyncLabel) refs.lastSyncLabel.textContent = `Status atualizado em ${new Date().toLocaleTimeString("pt-BR")}.`;
}

function showToast(type, message, duration = 3200) {
  clearTimeout(state.toastTimer);
  refs.toast.className = `toast ${type}`;
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  if (duration > 0) {
    state.toastTimer = window.setTimeout(() => {
      refs.toast.hidden = true;
    }, duration);
  }
}

function setPageLoading(active, message = "Aguarde enquanto a grade mensal e sincronizada.") {
  refs.loadingText.textContent = message;
  refs.pageLoading.hidden = !active;
}

function fillSelect(select, values, currentValue, formatter = (value) => value) {
  select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(formatter(value))}</option>`).join("");
  if (values.includes(String(currentValue))) select.value = String(currentValue);
}

function monthMeta(monthNumber) {
  return MONTHS.find((month) => month.number === Number(monthNumber)) || { shortLabel: "--", longLabel: "Mes" };
}

function buildBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.pendente;
  return `<span class="status-badge ${meta.tone}">${meta.label}</span>`;
}

function canPersistAudit(cell) {
  return cell?.store && cell.store !== "TODAS" && cell.type && cell.type !== "TODOS";
}

function deriveCellStatus(cell, notes) {
  if (!cell.noteCount && !notes.length) return "sem_nota";
  if (notes.some((note) => note.status === "divergente")) return "divergente";
  if (notes.length && notes.every((note) => note.status === "confere")) return "confere";
  if (cell.status === "sem_nota" && cell.noteCount > 0) return "pendente";
  return cell.status || "pendente";
}

function buildYearOptions(rows) {
  const years = new Set([String(new Date().getFullYear())]);
  rows.forEach((row) => years.add(String(row.year)));
  return sortLabels(years);
}

function buildGridModel(records) {
  const grouped = new Map();
  records.forEach((row) => {
    const key = `${row.sector}::${row.month_number}`;
    const previous = grouped.get(key);
    const current = {
      entryId: state.filters.store === "TODAS" || state.filters.type === "TODOS" ? null : (row.entry_id || null),
      store: state.filters.store === "TODAS" ? "TODAS" : row.store,
      year: Number(row.year),
      month: Number(row.month_number),
      monthLabel: row.month_label || monthMeta(row.month_number).longLabel,
      type: state.filters.type === "TODOS" ? "TODOS" : row.type,
      sector: row.sector,
      status: row.status || "pendente",
      observation: row.observation || "",
      totalValue: Number(row.total_value || 0),
      noteCount: Number(row.note_count || 0)
    };

    if (!previous) {
      grouped.set(key, current);
      return;
    }

    const statuses = [previous.status, current.status];
    grouped.set(key, {
      ...previous,
      totalValue: previous.totalValue + current.totalValue,
      noteCount: previous.noteCount + current.noteCount,
      status: statuses.includes("divergente")
        ? "divergente"
        : (statuses.every((status) => status === "confere")
          ? "confere"
          : (statuses.includes("pendente") ? "pendente" : previous.status))
    });
  });

  const sectors = sortLabels(new Set([
    ...SECTOR_OPTIONS,
    ...records.map((row) => row.sector).filter(Boolean)
  ]));

  const rows = sectors.map((sector) => {
    const months = MONTHS.map((month) => grouped.get(`${sector}::${month.number}`) || {
      entryId: null,
      store: state.filters.store,
      year: Number(state.filters.year),
      month: month.number,
      monthLabel: month.longLabel,
      type: state.filters.type,
      sector,
      status: "sem_nota",
      observation: "",
      totalValue: 0,
      noteCount: 0
    });

    return {
      sector,
      months,
      totalValue: months.reduce((sum, cell) => sum + Number(cell.totalValue || 0), 0),
      noteCount: months.reduce((sum, cell) => sum + Number(cell.noteCount || 0), 0)
    };
  });

  const summary = rows.reduce((acc, row) => {
    row.months.forEach((cell) => {
      acc.totalValue += cell.totalValue;
      acc.noteCount += cell.noteCount;
      if (cell.status === "pendente") acc.pendingCount += 1;
      if (cell.status === "divergente") acc.divergentCount += 1;
      if (cell.status === "confere") acc.checkedCount += 1;
    });
    return acc;
  }, defaultSummary());

  const totalsByMonth = MONTHS.map((month) => rows.reduce((sum, row) => sum + Number(row.months[month.number - 1].totalValue || 0), 0));
  return { rows, totalsByMonth, summary };
}

function renderSummary() {
  refs.summaryCards.innerHTML = `
    <article class="card kpi-card">
      <div class="label">Total do periodo</div>
      <div class="value">${brl(state.grid.summary.totalValue)}</div>
      <div class="meta">Soma consolidada do recorte atual.</div>
    </article>
    <article class="card kpi-card">
      <div class="label">Notas no periodo</div>
      <div class="value">${state.grid.summary.noteCount}</div>
      <div class="meta">Quantidade de notas presentes na grade.</div>
    </article>
    <article class="card kpi-card">
      <div class="label">Pendencias</div>
      <div class="value">${state.grid.summary.pendingCount}</div>
      <div class="meta">Celulas aguardando conferencia operacional.</div>
    </article>
    <article class="card kpi-card">
      <div class="label">Divergencias</div>
      <div class="value">${state.grid.summary.divergentCount}</div>
      <div class="meta">Celulas com diferenca registrada manualmente.</div>
    </article>
  `;
}

function renderGridSkeleton() {
  const cells = MONTHS.map(() => '<div class="fechamento-cell fechamento-skeleton-cell"></div>').join("");
  refs.gridTable.innerHTML = new Array(6).fill("").map((_, index) => `
    <div class="fechamento-grid-row">
      <div class="fechamento-sticky-col fechamento-sector-cell fechamento-skeleton-text">Setor ${index + 1}</div>
      ${cells}
      <div class="fechamento-total-cell fechamento-skeleton-cell"></div>
    </div>
  `).join("");
}

function renderGrid() {
  renderSummary();

  if (state.loadingGrid && !state.grid.rows.length) {
    refs.gridState.innerHTML = "";
    renderGridSkeleton();
    return;
  }

  if (state.gridError && !state.grid.rows.length) {
    refs.gridState.innerHTML = `
      <div class="status error fechamento-state">
        <span>${escapeHtml(state.gridError)}</span>
        <div class="fechamento-inline">
          <button type="button" data-action="retry-grid">Tentar novamente</button>
        </div>
      </div>
    `;
    refs.gridTable.innerHTML = "";
    return;
  }

  if (!state.grid.summary.noteCount) {
    refs.gridState.innerHTML = `
      <div class="empty">
        Nenhum fechamento encontrado para os filtros atuais.
        <div class="fechamento-inline">
          <button type="button" data-action="clear-filters">Limpar filtros</button>
        </div>
      </div>
    `;
    refs.gridTable.innerHTML = "";
    return;
  }

  refs.gridState.innerHTML = state.gridError ? `<div class="status warning">${escapeHtml(state.gridError)}</div>` : "";

  const head = `
    <div class="fechamento-grid-head">
      <div class="fechamento-sticky-col fechamento-head-cell">Setor</div>
      ${MONTHS.map((month) => `<div class="fechamento-head-cell">${month.shortLabel}</div>`).join("")}
      <div class="fechamento-head-cell">Total</div>
    </div>
  `;

  const body = state.grid.rows.map((row) => `
    <div class="fechamento-grid-row">
      <div class="fechamento-sticky-col fechamento-sector-cell">
        <strong>${escapeHtml(row.sector)}</strong>
        <span>${row.noteCount} nota(s)</span>
      </div>
      ${row.months.map((cell) => `
        <button
          type="button"
          class="fechamento-cell fechamento-cell-${(STATUS_META[cell.status] || STATUS_META.pendente).tone}"
          data-action="open-cell"
          data-entry-id="${escapeHtml(cell.entryId || "")}"
          data-store="${escapeHtml(cell.store)}"
          data-year="${cell.year}"
          data-month="${cell.month}"
          data-type="${escapeHtml(cell.type)}"
          data-sector="${escapeHtml(cell.sector)}"
          data-status="${escapeHtml(cell.status)}"
          data-observation="${escapeHtml(cell.observation || "")}"
          data-total-value="${cell.totalValue}"
          data-note-count="${cell.noteCount}"
        >
          <strong>${brl(cell.totalValue)}</strong>
          <span>${cell.noteCount} nota(s)</span>
          ${buildBadge(cell.status)}
        </button>
      `).join("")}
      <div class="fechamento-total-cell">
        <strong>${brl(row.totalValue)}</strong>
        <span>${row.noteCount} nota(s)</span>
      </div>
    </div>
  `).join("");

  const footer = `
    <div class="fechamento-grid-row fechamento-grid-footer">
      <div class="fechamento-sticky-col fechamento-sector-cell">
        <strong>Total geral</strong>
        <span>${state.grid.summary.noteCount} nota(s)</span>
      </div>
      ${state.grid.totalsByMonth.map((value) => `<div class="fechamento-footer-cell"><strong>${brl(value)}</strong></div>`).join("")}
      <div class="fechamento-total-cell">
        <strong>${brl(state.grid.summary.totalValue)}</strong>
        <span>${state.grid.summary.noteCount} nota(s)</span>
      </div>
    </div>
  `;

  refs.gridTable.innerHTML = `${head}${body}${footer}`;
}

function renderNotesList() {
  if (state.notesLoading && !state.notes.length) {
    return '<div class="fechamento-skeleton"></div><div class="fechamento-skeleton"></div><div class="fechamento-skeleton"></div>';
  }

  if (state.notesError) {
    return `
      <div class="empty">
        ${escapeHtml(state.notesError)}
        <div class="fechamento-inline">
          <button type="button" data-action="retry-notes">Tentar novamente</button>
        </div>
      </div>
    `;
  }

  if (!state.notes.length) return '<div class="empty">Nenhuma nota localizada para esta celula.</div>';

  return `
    ${state.notes.map((note) => `
      <button
        type="button"
        class="fechamento-note-card ${state.selectedNoteKey === note.noteKey ? "is-active" : ""}"
        data-action="select-note"
        data-note-key="${escapeHtml(note.noteKey)}"
      >
        <div>
          <strong>NF ${escapeHtml(note.invoice)}</strong>
          <span>${escapeHtml(note.store)} - ${escapeHtml(formatDate(note.date))}</span>
        </div>
        <div class="cell-stack">
          ${buildBadge(note.status)}
          <strong>${brl(note.totalValue)}</strong>
        </div>
      </button>
    `).join("")}
    ${state.hasMoreNotes ? '<button type="button" data-action="load-more-notes">Carregar mais notas</button>' : ""}
  `;
}

function renderItemsPanel() {
  const note = state.notes.find((entry) => entry.noteKey === state.selectedNoteKey);
  if (!note) {
    return '<div class="empty">Selecione uma nota para visualizar os produtos e concluir a auditoria.</div>';
  }

  if (state.itemsLoading && !state.noteItems.length) {
    return '<div class="fechamento-skeleton tall"></div>';
  }

  if (state.itemsError) {
    return `
      <div class="empty">
        ${escapeHtml(state.itemsError)}
        <div class="fechamento-inline">
          <button type="button" data-action="retry-items">Tentar novamente</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="fechamento-note-toolbar">
      <div class="cell-stack">
        <span class="label">Nota em auditoria</span>
        <strong>NF ${escapeHtml(note.invoice)} - ${brl(note.totalValue)}</strong>
      </div>
      ${buildBadge(note.status)}
    </div>

    <div class="fechamento-form-grid">
      <label class="fechamento-field">
        <span>Status da nota</span>
        <select id="noteStatus">
          <option value="pendente" ${note.status === "pendente" ? "selected" : ""}>Pendente</option>
          <option value="confere" ${note.status === "confere" ? "selected" : ""}>Confere</option>
          <option value="divergente" ${note.status === "divergente" ? "selected" : ""}>Divergente</option>
        </select>
      </label>
      <label class="fechamento-field">
        <span>Observacao da nota</span>
        <textarea id="noteObservation" rows="4" placeholder="Registre observacoes da conferencia.">${escapeHtml(note.observation || "")}</textarea>
      </label>
    </div>

    <div class="fechamento-inline">
      <button type="button" data-action="save-note" ${(state.savingNote || !canPersistAudit(state.selectedCell)) ? "disabled" : ""}>${state.savingNote ? "Salvando..." : "Salvar nota"}</button>
    </div>
    ${canPersistAudit(state.selectedCell) ? "" : '<div class="hint">Selecione uma loja e um tipo especificos para salvar auditoria manual.</div>'}

    <div class="table-wrap fechamento-items-table">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Produto</th>
            <th>Qtd</th>
            <th>Valor</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          ${state.noteItems.length ? state.noteItems.map((item) => `
            <tr>
              <td>${item.itemIndex}</td>
              <td>${escapeHtml(item.product)}</td>
              <td>${num(item.quantity)}</td>
              <td>${brl(item.value)}</td>
              <td>${escapeHtml(item.reason || "Sem motivo")}</td>
            </tr>
          `).join("") : '<tr><td colspan="5">Nenhum item encontrado para esta nota.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function renderDrawer() {
  refs.drawerBackdrop.hidden = !state.drawerOpen;
  refs.drawer.hidden = !state.drawerOpen;
  if (!state.drawerOpen || !state.selectedCell) return;

  refs.drawerTitle.textContent = `${state.selectedCell.sector} - ${state.selectedCell.monthLabel}`;
  refs.drawerMeta.innerHTML = `
    <span>${escapeHtml(state.selectedCell.store === "TODAS" ? "Todas as lojas" : state.selectedCell.store)}</span>
    <span>${state.selectedCell.year}</span>
    <span>${escapeHtml(state.selectedCell.type === "TODOS" ? "Todos os tipos" : state.selectedCell.type)}</span>
    <span>${brl(state.selectedCell.totalValue)}</span>
  `;

  refs.drawerBody.innerHTML = `
    <div class="fechamento-drawer-layout">
      <section class="fechamento-panel">
        <div class="fechamento-summary-grid">
          <div class="summary-card">
            <div class="label">Valor da celula</div>
            <strong>${brl(state.selectedCell.totalValue)}</strong>
          </div>
          <div class="summary-card">
            <div class="label">Notas</div>
            <strong>${state.selectedCell.noteCount}</strong>
          </div>
          <div class="summary-card">
            <div class="label">Status</div>
            <strong>${(STATUS_META[state.selectedCell.status] || STATUS_META.pendente).label}</strong>
          </div>
        </div>

        <div class="fechamento-form-grid">
          <label class="fechamento-field">
            <span>Status da celula</span>
            <select id="cellStatus">
              <option value="sem_nota" ${state.selectedCell.status === "sem_nota" ? "selected" : ""}>Sem nota</option>
              <option value="pendente" ${state.selectedCell.status === "pendente" ? "selected" : ""}>Pendente</option>
              <option value="confere" ${state.selectedCell.status === "confere" ? "selected" : ""}>Confere</option>
              <option value="divergente" ${state.selectedCell.status === "divergente" ? "selected" : ""}>Divergente</option>
            </select>
          </label>
          <label class="fechamento-field">
            <span>Observacao da celula</span>
            <textarea id="cellObservation" rows="4" placeholder="Descreva o fechamento do setor neste mes.">${escapeHtml(state.selectedCell.observation || "")}</textarea>
          </label>
        </div>

        <div class="fechamento-inline">
          <button type="button" data-action="save-cell" ${(state.savingCell || !canPersistAudit(state.selectedCell)) ? "disabled" : ""}>${state.savingCell ? "Salvando..." : "Salvar celula"}</button>
        </div>
        ${canPersistAudit(state.selectedCell) ? "" : '<div class="hint">Para salvar auditoria manual, selecione uma loja e um tipo especificos.</div>'}

        <div class="panel-head">
          <div>
            <span class="panel-tag">Notas do periodo</span>
            <h3>Notas relacionadas</h3>
            <p class="muted-note">${state.totalNotes} nota(s) localizadas no recorte atual.</p>
          </div>
        </div>
        <div class="fechamento-notes-list">${renderNotesList()}</div>
      </section>

      <section class="fechamento-panel">
        <div class="panel-head">
          <div>
            <span class="panel-tag">Produtos</span>
            <h3>Detalhamento da nota</h3>
            <p class="muted-note">Abra uma nota para analisar os produtos e confirmar a conferencia.</p>
          </div>
        </div>
        ${renderItemsPanel()}
      </section>
    </div>
  `;
}

function patchGridCell(updatedCell) {
  state.grid.rows = state.grid.rows.map((row) => {
    if (row.sector !== updatedCell.sector) return row;
    const months = row.months.map((cell) => cell.month === updatedCell.month ? { ...cell, ...updatedCell } : cell);
    return {
      ...row,
      months,
      totalValue: months.reduce((sum, cell) => sum + Number(cell.totalValue || 0), 0),
      noteCount: months.reduce((sum, cell) => sum + Number(cell.noteCount || 0), 0)
    };
  });
  state.grid = {
    ...state.grid,
    totalsByMonth: MONTHS.map((month) => state.grid.rows.reduce((sum, row) => sum + Number(row.months[month.number - 1].totalValue || 0), 0)),
    summary: state.grid.rows.reduce((acc, row) => {
      row.months.forEach((cell) => {
        acc.totalValue += cell.totalValue;
        acc.noteCount += cell.noteCount;
        if (cell.status === "pendente") acc.pendingCount += 1;
        if (cell.status === "divergente") acc.divergentCount += 1;
        if (cell.status === "confere") acc.checkedCount += 1;
      });
      return acc;
    }, defaultSummary())
  };
}

function parseCell(button) {
  return {
    entryId: button.dataset.entryId || null,
    store: button.dataset.store,
    year: Number(button.dataset.year || 0),
    month: Number(button.dataset.month || 0),
    monthLabel: monthMeta(button.dataset.month).longLabel,
    type: button.dataset.type,
    sector: button.dataset.sector,
    status: button.dataset.status || "pendente",
    observation: button.dataset.observation || "",
    totalValue: Number(button.dataset.totalValue || 0),
    noteCount: Number(button.dataset.noteCount || 0)
  };
}

async function loadGrid({ silent = false } = {}) {
  try {
    state.loadingGrid = true;
    if (!silent) setPageLoading(true, "Carregando grade mensal do Supabase...");
    renderGrid();
    const rows = await fetchGrid(state.filters);
    state.allRows = rows;
    state.grid = buildGridModel(rows);
    console.log("[Fechamento] Linhas da view carregadas:", rows.length);
    console.log("[Fechamento] Filtros ativos:", state.filters);
    console.log("[Fechamento] Total de notas na grade:", state.grid.summary.noteCount);
    state.gridError = "";
    renderGrid();
    setStatus("success", `${state.grid.summary.noteCount} nota(s) posicionadas na grade mensal.`);
  } catch (error) {
    console.error(error);
    state.gridError = error.userMessage || error.message || "Falha ao carregar a grade do fechamento.";
    renderGrid();
    setStatus("error", state.gridError);
  } finally {
    state.loadingGrid = false;
    setPageLoading(false);
    renderGrid();
  }
}

async function loadNotes({ append = false } = {}) {
  if (!state.selectedCell) return;
  try {
    state.notesLoading = true;
    state.notesError = "";
    renderDrawer();
    const result = await fetchCellNotes(state.selectedCell, state.filters, {
      page: state.notesPage,
      limit: 25
    });
    state.selectedCell = {
      ...state.selectedCell,
      entryId: result.entryId || state.selectedCell.entryId,
      status: result.entryStatus || state.selectedCell.status,
      observation: result.entryObservation || state.selectedCell.observation
    };
    state.notes = append ? [...state.notes, ...result.notes] : result.notes;
    state.totalNotes = result.totalCount;
    state.hasMoreNotes = result.hasMore;

    if (!state.selectedNoteKey && state.notes.length) {
      state.selectedNoteKey = state.notes[0].noteKey;
      await loadItems(state.selectedNoteKey);
    }
  } catch (error) {
    console.error(error);
    state.notesError = error.userMessage || error.message || "Falha ao carregar as notas da celula.";
  } finally {
    state.notesLoading = false;
    renderDrawer();
  }
}

async function loadItems(noteKey) {
  try {
    state.selectedNoteKey = noteKey;
    state.itemsLoading = true;
    state.itemsError = "";
    renderDrawer();
    state.noteItems = await fetchNoteItems(noteKey);
  } catch (error) {
    console.error(error);
    state.itemsError = error.userMessage || error.message || "Falha ao carregar os produtos.";
    state.noteItems = [];
  } finally {
    state.itemsLoading = false;
    renderDrawer();
  }
}

function openDrawerFromCell(button) {
  state.selectedCell = parseCell(button);
  state.drawerOpen = true;
  state.notes = [];
  state.totalNotes = 0;
  state.notesPage = 0;
  state.hasMoreNotes = false;
  state.notesError = "";
  state.selectedNoteKey = "";
  state.noteItems = [];
  state.itemsError = "";
  renderDrawer();
  loadNotes();
}

function closeDrawer() {
  state.drawerOpen = false;
  state.selectedCell = null;
  state.notes = [];
  state.selectedNoteKey = "";
  state.noteItems = [];
  renderDrawer();
}

async function saveCell() {
  if (!state.selectedCell || !canPersistAudit(state.selectedCell)) {
    showToast("warning", "Selecione uma loja e um tipo especificos antes de salvar a celula.");
    return;
  }

  const nextStatus = document.getElementById("cellStatus")?.value || state.selectedCell.status;
  const nextObservation = document.getElementById("cellObservation")?.value || "";

  try {
    state.savingCell = true;
    renderDrawer();
    const result = await saveEntryAudit({
      cell: state.selectedCell,
      status: nextStatus,
      observation: nextObservation
    });
    state.selectedCell = { ...state.selectedCell, entryId: result.entryId, status: result.status, observation: result.observation };
    patchGridCell(state.selectedCell);
    invalidateCellCache(state.selectedCell, state.filters);
    renderGrid();
    renderDrawer();
    showToast("success", "Celula salva com sucesso.");
  } catch (error) {
    console.error(error);
    showToast("error", error.userMessage || "Nao foi possivel salvar a celula.");
  } finally {
    state.savingCell = false;
    renderDrawer();
  }
}

async function saveNote() {
  if (!state.selectedCell || !state.selectedNoteKey || !canPersistAudit(state.selectedCell)) {
    showToast("warning", "Selecione uma loja e um tipo especificos antes de salvar a nota.");
    return;
  }

  const nextStatus = document.getElementById("noteStatus")?.value || "pendente";
  const nextObservation = document.getElementById("noteObservation")?.value || "";

  try {
    state.savingNote = true;
    renderDrawer();
    const noteResult = await saveNoteAudit({
      cell: state.selectedCell,
      noteKey: state.selectedNoteKey,
      status: nextStatus,
      observation: nextObservation
    });

    state.notes = state.notes.map((note) => note.noteKey === state.selectedNoteKey ? {
      ...note,
      status: noteResult.status,
      observation: noteResult.observation
    } : note);

    const derivedStatus = deriveCellStatus(state.selectedCell, state.notes);
    const entryResult = await saveEntryAudit({
      cell: { ...state.selectedCell, entryId: noteResult.entryId },
      status: derivedStatus,
      observation: state.selectedCell.observation || ""
    });

    state.selectedCell = {
      ...state.selectedCell,
      entryId: entryResult.entryId,
      status: entryResult.status,
      observation: entryResult.observation
    };

    patchGridCell(state.selectedCell);
    invalidateCellCache(state.selectedCell, state.filters);
    renderGrid();
    renderDrawer();
    showToast("success", "Nota auditada com sucesso.");
  } catch (error) {
    console.error(error);
    showToast("error", error.userMessage || "Nao foi possivel salvar a nota.");
  } finally {
    state.savingNote = false;
    renderDrawer();
  }
}

function syncFiltersFromData() {
  const stores = sortLabels(new Set(state.allRows.map((row) => row.store).filter(Boolean)));
  const years = buildYearOptions(state.allRows);
  const types = sortLabels(new Set(state.allRows.map((row) => row.type).filter(Boolean)));

  fillSelect(refs.storeFilter, ["TODAS", ...stores], state.filters.store, (value) => value === "TODAS" ? "Todas as lojas" : value);
  fillSelect(refs.yearFilter, years, state.filters.year);
  fillSelect(refs.typeFilter, ["TODOS", ...types], state.filters.type, (value) => value === "TODOS" ? "Todos os tipos" : value);
  fillSelect(refs.statusFilter, ["TODOS", "confere", "pendente", "divergente", "sem_nota"], state.filters.status, (value) => value === "TODOS" ? "Todos os status" : (STATUS_META[value] || STATUS_META.pendente).label);
  refs.metaYear.textContent = String(state.filters.year);
}

function refreshClock() {
  refs.currentTime.textContent = new Date().toLocaleTimeString("pt-BR");
}

function bindEvents() {
  [refs.storeFilter, refs.yearFilter, refs.typeFilter, refs.statusFilter].forEach((element) => {
    element.addEventListener("change", () => {
      state.filters.store = refs.storeFilter.value;
      state.filters.year = Number(refs.yearFilter.value || new Date().getFullYear());
      state.filters.type = refs.typeFilter.value;
      state.filters.status = refs.statusFilter.value;
      refs.metaYear.textContent = String(state.filters.year);
      loadGrid({ silent: true });
    });
  });

  refs.refreshBtn.addEventListener("click", () => loadGrid());
  refs.clearBtn.addEventListener("click", () => {
    state.filters.store = "TODAS";
    state.filters.type = "TODOS";
    state.filters.status = "TODOS";
    state.filters.year = new Date().getFullYear();
    syncFiltersFromData();
    loadGrid();
  });

  refs.gridState.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "retry-grid") loadGrid();
    if (action.dataset.action === "clear-filters") refs.clearBtn.click();
  });

  refs.gridTable.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="open-cell"]');
    if (button) openDrawerFromCell(button);
  });

  refs.drawerClose.addEventListener("click", closeDrawer);
  refs.drawerBackdrop.addEventListener("click", closeDrawer);

  refs.drawerBody.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;

    if (action.dataset.action === "select-note") {
      await loadItems(action.dataset.noteKey);
      return;
    }
    if (action.dataset.action === "load-more-notes") {
      state.notesPage += 1;
      await loadNotes({ append: true });
      return;
    }
    if (action.dataset.action === "retry-notes") {
      state.notesPage = 0;
      await loadNotes();
      return;
    }
    if (action.dataset.action === "retry-items" && state.selectedNoteKey) {
      await loadItems(state.selectedNoteKey);
      return;
    }
    if (action.dataset.action === "save-cell") {
      await saveCell();
      return;
    }
    if (action.dataset.action === "save-note") {
      await saveNote();
    }
  });
}

async function init() {
  refreshClock();
  window.setInterval(refreshClock, 1000);
  bindEvents();
  clearFechamentoCache();
  await loadGrid();
  syncFiltersFromData();
}

init().catch((error) => {
  console.error(error);
  setStatus("error", error.userMessage || error.message || "Nao foi possivel iniciar a tela de fechamento.");
});
