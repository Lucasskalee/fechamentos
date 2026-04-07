import { groupItemsByNote, normalizeReason } from "./services/classificacao.js";
import { clearDatabase, deleteNote, importXmlFiles, loadAllItems, updateItemField, updateReasonForNote, updateSectorForNote } from "./services/importacao.js";
import { applyFilters, buildNoteOptions, refreshFilters } from "./services/filtros.js";
import { exportCsv, exportJson, openPrintReport, renderClassification, renderDashboard, renderItems } from "./services/dashboard.js";
import { subscribeRealtime } from "./services/realtime.js";

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
  productSearch: document.getElementById("productSearch"),
  jsonBtn: document.getElementById("jsonBtn"),
  csvBtn: document.getElementById("csvBtn"),
  reportBtn: document.getElementById("reportBtn"),
  clearBtn: document.getElementById("clearBtn"),
  classBody: document.getElementById("classBody"),
  noteSummary: document.getElementById("noteSummary"),
  itemsBody: document.getElementById("itemsBody"),
  productSummary: document.getElementById("productSummary"),
  storesBody: document.getElementById("storesBody"),
  sectorBox: document.getElementById("sectorBox"),
  productRanking: document.getElementById("productRanking"),
  monthChart: document.getElementById("monthChart"),
  typeChart: document.getElementById("typeChart"),
  kpiNotes: document.getElementById("kpiNotes"),
  kpiTotal: document.getElementById("kpiTotal"),
  kpiLoss: document.getElementById("kpiLoss"),
  kpiUsage: document.getElementById("kpiUsage"),
  kpiStore: document.getElementById("kpiStore"),
  statusBanner: document.getElementById("statusBanner"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingText: document.getElementById("loadingText"),
  toast: document.getElementById("toast")
};

const state = {
  items: [],
  notes: [],
  filtered: [],
  monthChart: null,
  typeChart: null,
  realtimeCleanup: null,
  realtimeTimer: null,
  toastTimer: null
};

function setStatus(type, message) {
  refs.statusBanner.className = `status ${type}`;
  refs.statusBanner.textContent = message;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  refs.toast.textContent = message;
  refs.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { refs.toast.hidden = true; }, 3200);
}

function setLoading(active, message = "Aguarde enquanto o sistema atualiza as informações.") {
  refs.loadingText.textContent = message;
  refs.loadingOverlay.hidden = !active;
}

function syncState(items) {
  state.items = items.map((item) => ({ ...item, reason: normalizeReason(item.reason) })).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  state.notes = groupItemsByNote(state.items);
}

function refreshUi() {
  refreshFilters(state, refs);
  state.filtered = applyFilters(state, refs);
  buildNoteOptions(state, refs);
  renderDashboard(state, refs);
  renderItems(state, refs);
  renderClassification(state, refs);
}

async function reloadFromDatabase({ loadingMessage, statusMessage, emptyMessage } = {}) {
  try {
    if (loadingMessage) setLoading(true, loadingMessage);
    const items = await loadAllItems();
    syncState(items);
    refreshUi();
    if (state.items.length) setStatus("success", statusMessage || `${state.items.length} itens carregados em ${state.notes.length} nota(s).`);
    else setStatus("info", emptyMessage || "Nenhum XML importado ainda.");
  } catch (error) {
    setStatus("error", error.userMessage || "Não foi possível carregar os dados do painel.");
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
  state.notes = groupItemsByNote(state.items);
  state.filtered = applyFilters(state, refs);
  renderDashboard(state, refs);
  renderItems(state, refs);
  renderClassification(state, refs);
}

async function handleImport(files) {
  if (!files.length) return;
  try {
    setLoading(true, "Processando XMLs e salvando no Supabase...");
    const result = await importXmlFiles(files);
    await reloadFromDatabase({
      statusMessage: result.importedNotes ? `${result.importedNotes} XML(s) importado(s) com sucesso.` : "Nenhum XML novo foi encontrado para importação.",
      emptyMessage: "Nenhum XML importado ainda."
    });
    if (result.invalidFiles.length) showToast(`Alguns arquivos foram ignorados: ${result.invalidFiles.join(", ")}`);
    else if (result.importedNotes) showToast("Importação concluída com sucesso.");
    else if (result.skippedNotes) showToast("Os XMLs selecionados já estavam salvos.");
  } catch (error) {
    setStatus("error", error.userMessage || "Não foi possível concluir a importação.");
    showToast("Falha ao importar os XMLs.");
  } finally {
    refs.xmlFiles.value = "";
    setLoading(false);
  }
}

async function handleBulkReason(onlySelected) {
  const noteKey = refs.noteSelect.value;
  const reason = normalizeReason(onlySelected ? refs.applySelected.value : refs.applyAll.value);
  if (!noteKey || !reason) { showToast("Selecione a nota e o motivo antes de aplicar."); return; }
  try {
    setLoading(true, "Salvando classificação...");
    await updateReasonForNote(noteKey, reason, onlySelected);
    await reloadFromDatabase({ statusMessage: "Classificação atualizada automaticamente." });
    refs.noteSelect.value = noteKey;
    renderClassification(state, refs);
    showToast("Motivo salvo com sucesso.");
  } catch (error) {
    setStatus("error", error.userMessage || "Não foi possível atualizar o motivo.");
  } finally {
    setLoading(false);
  }
}

function bindEvents() {
  refs.xmlFiles.addEventListener("change", (event) => handleImport([...event.target.files]));

  [refs.basis, refs.storeFilter, refs.typeFilter, refs.sectorFilter, refs.reasonFilter, refs.monthFilter].forEach((element) => {
    element.addEventListener("change", () => {
      refreshUi();
      if (state.items.length) setStatus("success", `${state.filtered.length} item(ns) no filtro atual.`);
    });
  });

  [refs.noteStoreFilter, refs.noteMonthFilter].forEach((element) => element.addEventListener("change", () => { buildNoteOptions(state, refs); renderClassification(state, refs); }));
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
      setLoading(true, "Atualizando seleção...");
      for (const item of note.items) await updateItemField(item.id, { selected: event.target.checked });
      await reloadFromDatabase({ statusMessage: "Seleção atualizada automaticamente." });
      refs.noteSelect.value = noteKey;
      renderClassification(state, refs);
    } catch (error) {
      setStatus("error", error.userMessage || "Não foi possível atualizar a seleção.");
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
        setStatus("error", error.userMessage || "Não foi possível atualizar a seleção do item.");
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
        setStatus("error", error.userMessage || "Não foi possível salvar o motivo.");
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
        showToast("Setor salvo com sucesso.");
      } catch (error) {
        setStatus("error", error.userMessage || "Não foi possível atualizar o setor.");
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
        showToast("Nota excluída com sucesso.");
      } catch (error) {
        setStatus("error", error.userMessage || "Não foi possível excluir a nota.");
      } finally {
        setLoading(false);
      }
    }
  });

  refs.jsonBtn.addEventListener("click", () => { try { exportJson(state); } catch (error) { showToast(error.message); } });
  refs.csvBtn.addEventListener("click", () => { try { exportCsv(state); } catch (error) { showToast(error.message); } });
  refs.reportBtn.addEventListener("click", () => { try { openPrintReport(state, refs); } catch (error) { showToast(error.message); } });

  refs.clearBtn.addEventListener("click", async () => {
    if (!window.confirm("Deseja limpar todos os dados já importados do banco?")) return;
    try {
      setLoading(true, "Limpando base de dados...");
      await clearDatabase();
      await reloadFromDatabase({ statusMessage: "Base limpa com sucesso.", emptyMessage: "Nenhum XML importado ainda." });
      showToast("Base limpa com sucesso.");
    } catch (error) {
      setStatus("error", error.userMessage || "Não foi possível limpar a base.");
    } finally {
      setLoading(false);
    }
  });

  document.querySelectorAll(".tabbtn").forEach((button) => button.addEventListener("click", () => setTab(button.dataset.tab)));
}

async function init() {
  bindEvents();
  await reloadFromDatabase({ loadingMessage: "Carregando dados do Supabase...", statusMessage: "Dados carregados automaticamente.", emptyMessage: "Nenhum XML importado ainda." });
  try {
    state.realtimeCleanup = await subscribeRealtime(() => scheduleRealtimeReload());
  } catch (error) {
    console.error(error);
  }
}

init();
