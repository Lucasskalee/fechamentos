import { groupItemsByNote, normalizeReason } from "./services/classificacao.js";
import { clearDatabase, deleteNote, getPersistenceInfo, importXmlFiles, loadAllData, updateItemField, updateReasonForNote, updateSectorForNote } from "./services/importacao.js";
import { applyFilters, buildNoteOptions, refreshFilters } from "./services/filtros.js";
import { exportCsv, openPrintReport, renderClassification, renderDashboard, renderItems } from "./services/dashboard.js";
import { subscribeRealtime } from "./services/realtime.js";
import { initUi, touchLastSync } from "./services/ui.js";

const refs = {
  basis: document.getElementById("basis"),
  storeFilter: document.getElementById("storeFilter"),
  typeFilter: document.getElementById("typeFilter"),
  sectorFilter: document.getElementById("sectorFilter"),
  reasonFilter: document.getElementById("reasonFilter"),
  monthFilter: document.getElementById("monthFilter"),
  noteStoreFilter: document.getElementById("noteStoreFilter"),
  noteMonthFilter: document.getElementById("noteMonthFilter"),
  noteSelect: document.getElementById("noteSelect"),
  applyAll: document.getElementById("applyAll"),
  applySelected: document.getElementById("applySelected"),
  applyAllBtn: document.getElementById("applyAllBtn"),
  applySelectedBtn: document.getElementById("applySelectedBtn"),
  selectAll: document.getElementById("selectAll"),
  xmlFiles: document.getElementById("xmlFiles"),
  xmlFolder: document.getElementById("xmlFolder"),
  clearDatabaseBtn: document.getElementById("clearDatabaseBtn"),
  productSearch: document.getElementById("productSearch"),
  pendingOnlyBtn: document.getElementById("pendingOnlyBtn"),
  csvBtn: document.getElementById("csvBtn"),
  reportBtn: document.getElementById("reportBtn"),
  classBody: document.getElementById("classBody"),
  noteSummary: document.getElementById("noteSummary"),
  itemsBody: document.getElementById("itemsBody"),
  productSummary: document.getElementById("productSummary"),
  storesBody: document.getElementById("storesBody"),
  sectorBox: document.getElementById("sectorBox"),
  productRanking: document.getElementById("productRanking"),
  monthChart: document.getElementById("monthChart"),
  typeChart: document.getElementById("typeChart"),
  sectorChart: document.getElementById("sectorChart"),
  sectorChartEmpty: document.getElementById("sectorChartEmpty"),
  sectorChartSummary: document.getElementById("sectorChartSummary"),
  pendingExecutive: document.getElementById("pendingExecutive"),
  pendingExecutiveTitle: document.getElementById("pendingExecutiveTitle"),
  pendingExecutiveText: document.getElementById("pendingExecutiveText"),
  pendingExecutiveBadge: document.getElementById("pendingExecutiveBadge"),
  pendingItemsCount: document.getElementById("pendingItemsCount"),
  pendingNotesCount: document.getElementById("pendingNotesCount"),
  pendingCompletion: document.getElementById("pendingCompletion"),
  pendingFocus: document.getElementById("pendingFocus"),
  pendingFocusMeta: document.getElementById("pendingFocusMeta"),
  pendingKpiCard: document.getElementById("pendingKpiCard"),
  kpiNotes: document.getElementById("kpiNotes"),
  kpiTotal: document.getElementById("kpiTotal"),
  kpiLoss: document.getElementById("kpiLoss"),
  kpiUsage: document.getElementById("kpiUsage"),
  kpiPending: document.getElementById("kpiPending"),
  kpiPendingMeta: document.getElementById("kpiPendingMeta"),
  kpiStore: document.getElementById("kpiStore"),
  statusBanner: document.getElementById("statusBanner"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
  loadingProgressShell: document.getElementById("loadingProgressShell"),
  loadingProgressMeta: document.getElementById("loadingProgressMeta"),
  loadingProgressBar: document.getElementById("loadingProgressBar"),
  toast: document.getElementById("toast"),
  importSummaryModal: document.getElementById("importSummaryModal"),
  importSummaryTitle: document.getElementById("importSummaryTitle"),
  importSummaryContent: document.getElementById("importSummaryContent"),
  importSummaryClose: document.getElementById("importSummaryClose"),
  resetImportModal: document.getElementById("resetImportModal"),
  resetImportClose: document.getElementById("resetImportClose"),
  resetImportConfirmBtn: document.getElementById("resetImportConfirmBtn"),
  resetImportConfirmInput: document.getElementById("resetImportConfirmInput"),
  resetImportMonthlyToggle: document.getElementById("resetImportMonthlyToggle"),
  themeToggle: document.getElementById("themeToggle"),
  themeToggleLabel: document.getElementById("themeToggleLabel"),
  currentDate: document.getElementById("currentDate"),
  currentWeekday: document.getElementById("currentWeekday"),
  currentTime: document.getElementById("currentTime"),
  connectionBadge: document.getElementById("connectionBadge"),
  lastSyncLabel: document.getElementById("lastSyncLabel")
};

const state = {
  items: [],
  notes: [],
  filtered: [],
  totals: {
    bankNotes: 0,
    bankItems: 0,
    filteredNotes: 0,
    displayedNotes: 0,
    orphanNotes: 0
  },
  monthChart: null,
  typeChart: null,
  sectorChart: null,
  realtimeCleanup: null,
  realtimeTimer: null,
  toastTimer: null,
  uiCleanup: null
};

function setStatus(type, message) {
  refs.statusBanner.className = `status ${type}`;
  refs.statusBanner.textContent = message;
  if (refs.connectionBadge) {
    const labelMap = {
      info: "Sincronizacao em observacao",
      success: "Operacao sincronizada",
      warning: "Atencao ao modo atual",
      error: "Falha na sincronizacao"
    };
    refs.connectionBadge.textContent = labelMap[type] || "Painel operacional";
  }
  touchLastSync(refs, "Status atualizado");
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

function hideToast() {
  clearTimeout(state.toastTimer);
  refs.toast.hidden = true;
}

function setLoading(active, message = "Aguarde enquanto o sistema atualiza as informacoes.") {
  refs.loadingText.textContent = message;
  refs.loadingOverlay.hidden = !active;
}

function updateLoadingProgress(current, total, fileLabel = "") {
  if (!refs.loadingProgressShell || !refs.loadingProgressBar || !refs.loadingProgressMeta) return;
  if (!total) {
    refs.loadingProgressShell.hidden = true;
    refs.loadingProgressBar.style.width = "0%";
    refs.loadingProgressMeta.textContent = "Preparando importacao...";
    return;
  }

  const safeTotal = Math.max(total, 1);
  const percent = Math.min(100, Math.round((current / safeTotal) * 100));
  refs.loadingProgressShell.hidden = false;
  refs.loadingProgressBar.style.width = `${percent}%`;
  refs.loadingProgressMeta.textContent = fileLabel
    ? `Importando ${current} de ${total}: ${fileLabel}`
    : `Importando ${current} de ${total}...`;
}

function closeImportSummary() {
  if (refs.importSummaryModal) refs.importSummaryModal.hidden = true;
}

function isAdminTestModeEnabled() {
  const search = new URLSearchParams(window.location.search);
  const byQuery = ["admin", "modo", "mode", "teste", "test"].some((key) => {
    const value = search.get(key);
    return value === "1" || value === "true" || value === "admin" || value === "teste" || value === "test";
  });
  const byHash = /admin|teste|test/i.test(window.location.hash || "");
  const byPath = /admin/i.test(window.location.pathname || "");
  const byHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const byStorage = window.localStorage.getItem("razarth-admin-mode") === "enabled";
  return byQuery || byHash || byPath || byHost || byStorage;
}

function applyAdminTestModeVisibility() {
  if (!refs.clearDatabaseBtn) return;
  refs.clearDatabaseBtn.hidden = !isAdminTestModeEnabled();
}

function closeResetImportModal() {
  if (refs.resetImportModal) refs.resetImportModal.hidden = true;
  if (refs.resetImportConfirmInput) refs.resetImportConfirmInput.value = "";
  if (refs.resetImportMonthlyToggle) refs.resetImportMonthlyToggle.checked = false;
}

function openResetImportModal() {
  if (!refs.resetImportModal) return;
  refs.resetImportModal.hidden = false;
  refs.resetImportConfirmInput?.focus();
}

function resetScreenState() {
  state.items = [];
  state.notes = [];
  state.filtered = [];
  refreshUi();
}

function buildSummaryErrors(errors) {
  if (!errors.length) return '<div class="empty">Nenhum erro encontrado na importacao.</div>';
  return `<div class="import-summary-list">${errors.map((entry) => `
    <article class="import-summary-item">
      <strong>${entry.file}</strong>
      <span>Loja: ${entry.store}</span>
      <span>Tipo: ${entry.type}</span>
      <span>Nota: ${entry.note}</span>
      <span>Motivo: ${entry.reason}</span>
    </article>
  `).join("")}</div>`;
}

function openImportSummary(result) {
  if (!refs.importSummaryModal || !refs.importSummaryTitle || !refs.importSummaryContent) return;
  refs.importSummaryTitle.textContent = result.errorCount ? "Importacao concluida com pendencias" : "Importacao concluida";
  refs.importSummaryContent.innerHTML = `
    <div class="import-summary-grid">
      <article class="import-summary-card"><span class="label">Arquivos selecionados</span><strong>${result.totalSelectedFiles}</strong></article>
      <article class="import-summary-card"><span class="label">XML encontrados</span><strong>${result.totalXmlFiles}</strong></article>
      <article class="import-summary-card"><span class="label">Importados</span><strong>${result.importedNotes}</strong></article>
      <article class="import-summary-card"><span class="label">Duplicados</span><strong>${result.skippedNotes}</strong></article>
      <article class="import-summary-card"><span class="label">Com erro</span><strong>${result.errorCount}</strong></article>
    </div>
    <section>
      <h4>Arquivos com erro</h4>
      ${buildSummaryErrors(result.errors)}
    </section>
  `;
  refs.importSummaryModal.hidden = false;
}

function syncState(database) {
  state.items = (database.items || [])
    .map((item) => ({ ...item, reason: normalizeReason(item.reason) }))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  state.notes = groupItemsByNote(state.items, database.notes || []);
  state.totals.bankNotes = (database.notes || []).length;
  state.totals.bankItems = state.items.length;
  state.totals.orphanNotes = state.notes.filter((note) => !note.items?.length).length;
}

function refreshUi() {
  refreshFilters(state, refs);
  state.filtered = applyFilters(state, refs);
  state.totals.filteredNotes = new Set(state.filtered.map((item) => item.noteKey)).size;
  state.totals.displayedNotes = state.totals.filteredNotes;
  buildNoteOptions(state, refs);
  renderDashboard(state, refs);
  renderItems(state, refs);
  renderClassification(state, refs);
}

async function reloadFromDatabase({ loadingMessage, statusMessage, emptyMessage } = {}) {
  try {
    if (loadingMessage) setLoading(true, loadingMessage);
    const database = await loadAllData();
    syncState(database);
    refreshUi();
    console.log("[Dashboard] Banco oficial:", {
      totalNotasBanco: state.totals.bankNotes,
      totalItensBanco: state.totals.bankItems,
      totalNotasComItens: state.notes.length,
      totalNotasSemItens: state.totals.orphanNotes
    });
    const persistence = getPersistenceInfo();
    if (persistence.mode === "local") {
      const message = state.items.length
        ? `${persistence.detail} Fonte oficial: Supabase. Exibindo ${state.items.length} itens e ${state.notes.length} nota(s) do fallback temporario.`
        : `${persistence.detail} Fonte oficial: Supabase. Nenhum XML visivel no fallback temporario.`;
      setStatus("warning", message);
    } else if (persistence.mode === "remote_partial") {
      const noteMessage = state.notes.length
        ? `${state.notes.length} nota(s) oficial(is) carregada(s) do banco.`
        : "Nenhuma nota oficial foi encontrada no banco.";
      const itemMessage = state.items.length
        ? ` ${state.items.length} item(ns) tambem foram carregados.`
        : " Os itens ainda nao puderam ser lidos do banco.";
      setStatus("warning", `${noteMessage}${itemMessage} ${persistence.detail}`.trim());
    } else if (state.items.length) {
      const metrics = `Banco: ${state.totals.bankNotes} nota(s). Filtro: ${state.totals.filteredNotes} nota(s). Tela: ${state.totals.displayedNotes} nota(s).`;
      const orphanMessage = state.totals.orphanNotes ? ` ${state.totals.orphanNotes} nota(s) estao sem itens associados.` : "";
      setStatus("success", statusMessage || `${metrics}${orphanMessage}`.trim());
    } else if (state.notes.length) {
      const orphanMessage = state.totals.orphanNotes ? ` ${state.totals.orphanNotes} nota(s) estao sem itens associados.` : "";
      setStatus("success", statusMessage || `${state.notes.length} nota(s) carregada(s) do banco.${orphanMessage}`.trim());
    }
    else setStatus("info", emptyMessage || "Nenhum XML importado ainda.");
  } catch (error) {
    setStatus("error", error.userMessage || "Nao foi possivel carregar os dados do painel.");
  } finally {
    setLoading(false);
  }
}

function scheduleRealtimeReload() {
  clearTimeout(state.realtimeTimer);
  state.realtimeTimer = window.setTimeout(() => {
    reloadFromDatabase({ statusMessage: "Dados atualizados automaticamente.", emptyMessage: "Nenhum XML importado ainda." });
  }, 500);
}

function setTab(targetId) {
  document.querySelectorAll(".tabbtn").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === targetId));
  document.querySelectorAll(".tab").forEach((section) => section.classList.toggle("is-active", section.id === targetId));
}

function updateLocalItem(itemId, patch) {
  state.items = state.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item));
  state.notes = groupItemsByNote(state.items, state.notes);
  state.filtered = applyFilters(state, refs);
  renderDashboard(state, refs);
  renderItems(state, refs);
  renderClassification(state, refs);
}

async function handleImport(files) {
  if (!files.length) return;
  const totalFiles = files.length;
  try {
    closeImportSummary();
    updateLoadingProgress(0, 0);
    setStatus("info", `Iniciando a leitura de ${totalFiles} arquivo(s)...`);
    showToast("info", `Importacao iniciada. Processando ${totalFiles} arquivo(s)...`, 0);
    setLoading(true, `Preparando a importacao de ${totalFiles} arquivo(s)...`);
    const result = await importXmlFiles(files, {
      onProgress(progress) {
        setLoading(true, progress.message);
        updateLoadingProgress(progress.current, progress.total, progress.fileLabel);
      }
    });
    await reloadFromDatabase({
      statusMessage: result.importedNotes
        ? `${result.importedNotes} XML(s) importado(s) com sucesso. ${result.skippedNotes} duplicado(s) ignorado(s). ${result.errorCount} com erro.`
        : "Nenhum XML novo foi encontrado para importacao.",
      emptyMessage: "Nenhum XML importado ainda."
    });
    openImportSummary(result);
    if (result.errorCount) {
      showToast("warning", `Importacao concluida com ${result.errorCount} erro(s). Veja o resumo para os detalhes.`);
    } else if (result.importedNotes && result.skippedNotes) {
      showToast("warning", `${result.importedNotes} XML(s) importado(s). ${result.skippedNotes} duplicado(s) foram ignorados.`);
    } else if (result.importedNotes) {
      showToast("success", `${result.importedNotes} XML(s) importado(s) com sucesso.`);
    } else if (result.skippedNotes) {
      setStatus("warning", "Os XMLs selecionados ja existiam e foram ignorados.");
      showToast("warning", "Os XMLs selecionados ja existiam e foram ignorados.");
    } else {
      showToast("info", "Nenhum XML novo foi encontrado para importacao.");
    }
  } catch (error) {
    const message = error.userMessage || "Falha ao enviar XMLs para o banco de dados.";
    setStatus("error", message);
    showToast("error", message);
  } finally {
    refs.xmlFiles.value = "";
    if (refs.xmlFolder) refs.xmlFolder.value = "";
    updateLoadingProgress(0, 0);
    setLoading(false);
    if (!refs.toast.hidden && refs.toast.classList.contains("info")) {
      hideToast();
    }
  }
}

async function handleClearDatabase() {
  const confirmationText = refs.resetImportConfirmInput?.value?.trim();
  if (confirmationText !== "LIMPAR") {
    showToast("warning", "Digite exatamente LIMPAR para confirmar a limpeza.");
    return;
  }

  const includeMonthlyClosing = Boolean(refs.resetImportMonthlyToggle?.checked);

  try {
    closeResetImportModal();
    closeImportSummary();
    updateLoadingProgress(0, 0);
    setLoading(true, includeMonthlyClosing ? "Limpando importacoes e fechamento mensal..." : "Limpando loss_items e loss_notes...");
    setStatus("warning", includeMonthlyClosing
      ? "Limpando dados de importacao e apoio do fechamento mensal..."
      : "Limpando os dados atuais de importacao do banco...");
    await clearDatabase({ includeMonthlyClosing });
    resetScreenState();
    await reloadFromDatabase({
      statusMessage: "Banco limpo com sucesso.",
      emptyMessage: "Banco limpo. Nenhum XML importado ainda."
    });
    showToast("success", includeMonthlyClosing
      ? "Dados de importacao e fechamento mensal limpos com sucesso."
      : "Dados de importacao limpos com sucesso.");
  } catch (error) {
    console.error("[reset-import-data]", error);
    const message = error.userMessage || "Nao foi possivel limpar o banco.";
    setStatus("error", message);
    showToast("error", message);
  } finally {
    updateLoadingProgress(0, 0);
    setLoading(false);
  }
}

async function handleBulkReason(onlySelected) {
  const noteKey = refs.noteSelect.value;
  const reason = normalizeReason(onlySelected ? refs.applySelected.value : refs.applyAll.value);
  if (!noteKey || !reason) {
    showToast("warning", "Selecione a nota e o motivo antes de aplicar.");
    return;
  }

  try {
    setLoading(true, "Salvando classificacao...");
    await updateReasonForNote(noteKey, reason, onlySelected);
    await reloadFromDatabase({ statusMessage: "Classificacao atualizada automaticamente." });
    refs.noteSelect.value = noteKey;
    renderClassification(state, refs);
    showToast("success", "Motivo salvo com sucesso.");
  } catch (error) {
    setStatus("error", error.userMessage || "Nao foi possivel atualizar o motivo.");
  } finally {
    setLoading(false);
  }
}

function bindEvents() {
  window.addEventListener("app-theme-change", () => {
    if (state.items.length) refreshUi();
  });

  refs.pendingOnlyBtn?.addEventListener("click", () => {
    const active = refs.pendingOnlyBtn.getAttribute("aria-pressed") === "true";
    refs.pendingOnlyBtn.setAttribute("aria-pressed", String(!active));
    refreshUi();
    if (state.items.length) {
      setStatus("success", !active ? `${state.filtered.length} item(ns) pendente(s) no filtro atual.` : `${state.filtered.length} item(ns) no filtro atual.`);
    }
  });

  refs.xmlFiles.addEventListener("change", (event) => handleImport([...event.target.files]));
  refs.xmlFolder?.addEventListener("change", (event) => handleImport([...event.target.files]));
  refs.clearDatabaseBtn?.addEventListener("click", openResetImportModal);
  refs.importSummaryClose?.addEventListener("click", closeImportSummary);
  refs.importSummaryModal?.addEventListener("click", (event) => {
    if (event.target === refs.importSummaryModal) closeImportSummary();
  });
  refs.resetImportClose?.addEventListener("click", closeResetImportModal);
  refs.resetImportConfirmBtn?.addEventListener("click", handleClearDatabase);
  refs.resetImportModal?.addEventListener("click", (event) => {
    if (event.target === refs.resetImportModal) closeResetImportModal();
  });

  [refs.basis, refs.storeFilter, refs.typeFilter, refs.sectorFilter, refs.reasonFilter, refs.monthFilter].forEach((element) => {
    element.addEventListener("change", () => {
      refreshUi();
      if (state.items.length) setStatus("success", `${state.filtered.length} item(ns) no filtro atual.`);
    });
  });

  [refs.noteStoreFilter, refs.noteMonthFilter].forEach((element) => {
    element.addEventListener("change", () => {
      buildNoteOptions(state, refs);
      renderClassification(state, refs);
    });
  });

  refs.noteSelect.addEventListener("change", () => renderClassification(state, refs));
  refs.productSearch.addEventListener("input", () => renderItems(state, refs));
  refs.applyAllBtn.addEventListener("click", () => handleBulkReason(false));
  refs.applySelectedBtn.addEventListener("click", () => handleBulkReason(true));

  refs.selectAll.addEventListener("change", async (event) => {
    const noteKey = refs.noteSelect.value;
    if (!noteKey) return;
    const note = state.notes.find((entry) => entry.key === noteKey);
    if (!note) return;
    try {
      setLoading(true, "Atualizando selecao...");
      for (const item of note.items) await updateItemField(item.id, { selected: event.target.checked });
      await reloadFromDatabase({ statusMessage: "Selecao atualizada automaticamente." });
      refs.noteSelect.value = noteKey;
      renderClassification(state, refs);
    } catch (error) {
      setStatus("error", error.userMessage || "Nao foi possivel atualizar a selecao.");
    } finally {
      setLoading(false);
    }
  });

  refs.classBody.addEventListener("change", async (event) => {
    const action = event.target.dataset.action;
    const itemId = event.target.dataset.id;
    if (!action || !itemId) return;

    if (action === "toggle-selected") {
      updateLocalItem(itemId, { selected: event.target.checked });
      try {
        await updateItemField(itemId, { selected: event.target.checked });
      } catch (error) {
        await reloadFromDatabase({ statusMessage: "Dados atualizados automaticamente." });
        setStatus("error", error.userMessage || "Nao foi possivel atualizar a selecao do item.");
      }
      return;
    }

    if (action === "set-reason") {
      const reason = normalizeReason(event.target.value);
      updateLocalItem(itemId, { reason });
      try {
        await updateItemField(itemId, { reason });
        setStatus("success", "Motivo salvo automaticamente.");
      } catch (error) {
        await reloadFromDatabase({ statusMessage: "Dados atualizados automaticamente." });
        setStatus("error", error.userMessage || "Nao foi possivel salvar o motivo.");
      }
    }
  });

  refs.noteSummary.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    const noteKey = event.target.dataset.noteKey;
    if (!action || !noteKey) return;

    if (action === "save-sector") {
      const note = state.notes.find((entry) => entry.key === noteKey);
      const sectorField = document.getElementById("noteSectorEdit");
      if (!note || !sectorField) return;
      try {
        setLoading(true, "Atualizando setor da nota...");
        await updateSectorForNote(noteKey, note.type, sectorField.value);
        await reloadFromDatabase({ statusMessage: "Setor atualizado automaticamente." });
        refs.noteSelect.value = noteKey;
        renderClassification(state, refs);
        showToast("success", "Setor salvo com sucesso.");
      } catch (error) {
        setStatus("error", error.userMessage || "Nao foi possivel atualizar o setor.");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (action === "remove-note") {
      if (!window.confirm("Deseja excluir esta nota do painel e do banco de dados?")) return;
      try {
        setLoading(true, "Excluindo nota...");
        await deleteNote(noteKey);
        refs.noteSelect.value = "";
        await reloadFromDatabase({ statusMessage: "Nota removida com sucesso.", emptyMessage: "Nenhum XML importado ainda." });
        showToast("success", "Nota excluida com sucesso.");
      } catch (error) {
        setStatus("error", error.userMessage || "Nao foi possivel excluir a nota.");
      } finally {
        setLoading(false);
      }
    }
  });

  refs.csvBtn.addEventListener("click", () => {
    try {
      exportCsv(state);
    } catch (error) {
      showToast("warning", error.message);
    }
  });

  refs.reportBtn.addEventListener("click", () => {
    try {
      openPrintReport(state, refs);
    } catch (error) {
      showToast("warning", error.message);
    }
  });

  document.querySelectorAll(".tabbtn").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
}

async function init() {
  state.uiCleanup = initUi(refs);
  applyAdminTestModeVisibility();
  bindEvents();
  await reloadFromDatabase({
    loadingMessage: "Carregando dados oficiais do Supabase...",
    statusMessage: "Dados oficiais carregados automaticamente do Supabase.",
    emptyMessage: "Nenhum XML importado ainda."
  });
  try {
    state.realtimeCleanup = await subscribeRealtime(() => scheduleRealtimeReload());
  } catch (error) {
    console.error(error);
    setStatus("warning", error.userMessage || "Realtime indisponivel. O Supabase continua sendo a fonte oficial, mas sem atualizacao automatica.");
  }
}

init();
