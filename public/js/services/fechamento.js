import { getSupabaseClient } from "../config/supabase.js";

export const VIEW_MONTHLY_GRID = "v_monthly_closing_grid";
export const VIEW_MONTHLY_NOTES = "v_monthly_closing_notes";
export const TABLE_MONTHLY_ENTRY = "monthly_closing_entries";
export const TABLE_MONTHLY_NOTE = "monthly_closing_notes";
export const TABLE_MONTHLY_OBSERVATION = "monthly_closing_observations";

export const MONTHS = [
  { number: 1, shortLabel: "Jan", longLabel: "Janeiro" },
  { number: 2, shortLabel: "Fev", longLabel: "Fevereiro" },
  { number: 3, shortLabel: "Mar", longLabel: "Marco" },
  { number: 4, shortLabel: "Abr", longLabel: "Abril" },
  { number: 5, shortLabel: "Mai", longLabel: "Maio" },
  { number: 6, shortLabel: "Jun", longLabel: "Junho" },
  { number: 7, shortLabel: "Jul", longLabel: "Julho" },
  { number: 8, shortLabel: "Ago", longLabel: "Agosto" },
  { number: 9, shortLabel: "Set", longLabel: "Setembro" },
  { number: 10, shortLabel: "Out", longLabel: "Outubro" },
  { number: 11, shortLabel: "Nov", longLabel: "Novembro" },
  { number: 12, shortLabel: "Dez", longLabel: "Dezembro" }
];

export const STATUS_META = {
  confere: { label: "Confere", tone: "success" },
  pendente: { label: "Pendente", tone: "warning" },
  divergente: { label: "Divergente", tone: "danger" },
  sem_nota: { label: "Sem nota", tone: "neutral" }
};

export const notesCache = new Map();
export const itemsCache = new Map();
const SUPABASE_PAGE_SIZE = 1000;
const LOCAL_AUDIT_PREFIX = "fechamento_auditoria_local_v1";

function pageKey(baseKey, page, limit) {
  return `${baseKey}::${page}::${limit}`;
}

export function buildCellKey(cell, filters) {
  return [
    filters.store || cell.store || "TODAS",
    filters.year || cell.year || "",
    filters.type || cell.type || "TODOS",
    cell.sector || "",
    cell.month || cell.monthNumber || ""
  ].join("|");
}

export function clearFechamentoCache() {
  notesCache.clear();
  itemsCache.clear();
}

export function invalidateCellCache(cell, filters) {
  const prefix = buildCellKey(cell, filters);
  [...notesCache.keys()].forEach((key) => {
    if (key.startsWith(prefix)) notesCache.delete(key);
  });
}

function applyGridFilters(query, filters) {
  let nextQuery = query.eq("year", filters.year);
  if (filters.store && filters.store !== "TODAS") nextQuery = nextQuery.eq("store", filters.store);
  if (filters.type && filters.type !== "TODOS") nextQuery = nextQuery.eq("type", filters.type);
  if (filters.status && filters.status !== "TODOS") nextQuery = nextQuery.eq("status", filters.status);
  return nextQuery;
}

function isMissingBackendObject(error) {
  return error?.code === "PGRST205" || /schema cache|Could not find the table/i.test(error?.message || "");
}

function localEntryKey(cell) {
  return [
    LOCAL_AUDIT_PREFIX,
    "entry",
    cell.store || "TODAS",
    cell.year || "",
    cell.month || cell.month_number || "",
    cell.type || "TODOS",
    cell.sector || ""
  ].join("|");
}

function localNoteKey(cell, noteKey) {
  return [
    LOCAL_AUDIT_PREFIX,
    "note",
    cell.store || "TODAS",
    cell.year || "",
    cell.month || cell.month_number || "",
    cell.type || "TODOS",
    cell.sector || "",
    noteKey || ""
  ].join("|");
}

function readLocalAudit(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeLocalAudit(key, payload) {
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Local audit is best-effort only when the monthly backend schema is absent.
  }
}

function monthLabelFromNumber(monthNumber) {
  return MONTHS.find((month) => month.number === Number(monthNumber))?.longLabel || "Mes";
}

function notePeriod(row) {
  const date = new Date(row.emission_date || "");
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1
  };
}

function applyLossNotesFilters(query, filters) {
  const year = Number(filters.year || new Date().getFullYear());
  let nextQuery = query
    .gte("emission_date", `${year}-01-01T00:00:00.000Z`)
    .lt("emission_date", `${year + 1}-01-01T00:00:00.000Z`);

  if (filters.store && filters.store !== "TODAS") nextQuery = nextQuery.eq("store", filters.store);
  if (filters.type && filters.type !== "TODOS") nextQuery = nextQuery.eq("type", filters.type);
  return nextQuery;
}

async function fetchAllLossNotes(client, filters) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await applyLossNotesFilters(
      client
        .from("loss_notes")
        .select("note_key, invoice, store, emission_date, type, sector, total_value, item_count"),
      filters
    )
      .order("sector", { ascending: true })
      .order("emission_date", { ascending: true })
      .range(from, to);

    if (error) {
      error.userMessage = "Nao foi possivel carregar as notas base do fechamento mensal.";
      throw error;
    }

    const pageRows = data || [];
    rows.push(...pageRows);
    if (pageRows.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

async function fetchGridFromLossNotes(filters) {
  if (filters.status && !["TODOS", "pendente"].includes(filters.status)) return [];
  const client = getSupabaseClient();
  const notes = await fetchAllLossNotes(client, filters);

  return notes.map((note) => {
    const period = notePeriod(note) || { year: Number(filters.year), month: 1 };
    const cell = {
      store: note.store || "Loja nao identificada",
      year: period.year,
      month: period.month,
      type: note.type || "Outros",
      sector: note.sector || "Nao classificado"
    };
    const audit = readLocalAudit(localEntryKey(cell));

    return {
      entry_id: audit?.entryId || null,
      store: cell.store,
      year: period.year,
      month_number: period.month,
      month_label: monthLabelFromNumber(period.month),
      type: cell.type,
      sector: cell.sector,
      note_count: 1,
      total_value: Number(note.total_value || 0),
      status: audit?.status || "pendente",
      observation: audit?.observation || ""
    };
  });
}

async function fetchAllGridRows(builder) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await builder(from, to);
    if (error) {
      error.userMessage = "Nao foi possivel carregar a grade do fechamento mensal.";
      throw error;
    }
    const pageRows = data || [];
    rows.push(...pageRows);
    if (pageRows.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows;
}

export async function fetchGrid(filters) {
  const client = getSupabaseClient();
  try {
    return await fetchAllGridRows((from, to) => applyGridFilters(
      client.from(VIEW_MONTHLY_GRID).select("*"),
      filters
    )
      .order("sector", { ascending: true })
      .order("month_number", { ascending: true })
      .order("type", { ascending: true })
      .range(from, to));
  } catch (error) {
    if (isMissingBackendObject(error)) return fetchGridFromLossNotes(filters);
    throw error;
  }
}

/**
 * Estrutura retornada pela view v_monthly_closing_grid:
 * {
 *   entry_id: string | null,
 *   store: string,
 *   year: number,
 *   month_number: number,
 *   month_label: string,
 *   type: string,
 *   sector: string,
 *   note_count: number,
 *   total_value: number,
 *   status: 'confere' | 'pendente' | 'divergente' | 'sem_nota',
 *   observation: string
 * }
 */
export async function fetchCellNotes(cell, filters, { page = 0, limit = 30 } = {}) {
  const baseKey = buildCellKey(cell, filters);
  const cacheKey = pageKey(baseKey, page, limit);
  if (notesCache.has(cacheKey)) return notesCache.get(cacheKey);

  const client = getSupabaseClient();
  let data = [];
  let count = 0;
  let viewError = null;

  try {
    let query = client
      .from(VIEW_MONTHLY_NOTES)
      .select("*", { count: "exact" })
      .eq("year", cell.year)
      .eq("month_number", cell.month)
      .eq("sector", cell.sector);

    if (cell.store && cell.store !== "TODAS") query = query.eq("store", cell.store);
    if (cell.type && cell.type !== "TODOS") query = query.eq("type", cell.type);
    else if (filters.type && filters.type !== "TODOS") query = query.eq("type", filters.type);

    const response = await query
      .order("emission_date", { ascending: true })
      .order("invoice", { ascending: true })
      .range(page * limit, page * limit + limit - 1);

    if (response.error) throw response.error;
    data = response.data || [];
    count = Number(response.count || 0);
  } catch (error) {
    viewError = error;
  }

  if (viewError && !isMissingBackendObject(viewError)) {
    viewError.userMessage = "Nao foi possivel carregar as notas da celula.";
    throw viewError;
  }

  if (viewError) {
    const startMonth = String(cell.month).padStart(2, "0");
    const endDate = cell.month === 12
      ? `${Number(cell.year) + 1}-01-01T00:00:00.000Z`
      : `${cell.year}-${String(cell.month + 1).padStart(2, "0")}-01T00:00:00.000Z`;
    let fallbackQuery = client
      .from("loss_notes")
      .select("note_key, invoice, store, emission_date, type, sector, total_value, item_count", { count: "exact" })
      .gte("emission_date", `${cell.year}-${startMonth}-01T00:00:00.000Z`)
      .lt("emission_date", endDate)
      .eq("sector", cell.sector);

    if (cell.store && cell.store !== "TODAS") fallbackQuery = fallbackQuery.eq("store", cell.store);
    if (cell.type && cell.type !== "TODOS") fallbackQuery = fallbackQuery.eq("type", cell.type);
    else if (filters.type && filters.type !== "TODOS") fallbackQuery = fallbackQuery.eq("type", filters.type);

    const response = await fallbackQuery
      .order("emission_date", { ascending: true })
      .order("invoice", { ascending: true })
      .range(page * limit, page * limit + limit - 1);

    if (response.error) {
      response.error.userMessage = "Nao foi possivel carregar as notas base desta celula.";
      throw response.error;
    }

    data = (response.data || []).map((row) => {
      const noteAudit = readLocalAudit(localNoteKey(cell, row.note_key));
      const entryAudit = readLocalAudit(localEntryKey(cell));
      return {
        note_key: row.note_key,
        invoice: row.invoice,
        store: row.store,
        type: row.type,
        sector: row.sector,
        emission_date: row.emission_date,
        total_value: row.total_value,
        item_count: row.item_count,
        note_status: noteAudit?.status || "pendente",
        note_observation: noteAudit?.observation || "",
        entry_id: entryAudit?.entryId || null,
        entry_status: entryAudit?.status || cell.status || "pendente",
        entry_observation: entryAudit?.observation || cell.observation || ""
      };
    });
    count = Number(response.count || 0);
  }

  const result = {
    entryId: data?.[0]?.entry_id || cell.entryId || null,
    entryStatus: data?.[0]?.entry_status || cell.status || "pendente",
    entryObservation: data?.[0]?.entry_observation || cell.observation || "",
    totalCount: Number(count || 0),
    hasMore: Number(count || 0) > (page + 1) * limit,
    notes: (data || []).map((row) => ({
      entryId: row.entry_id || null,
      noteKey: row.note_key,
      invoice: row.invoice || "-",
      store: row.store || "Loja nao identificada",
      sector: row.sector || "Nao classificado",
      type: row.type || "Outros",
      totalValue: Number(row.total_value || 0),
      itemCount: Number(row.item_count || 0),
      date: row.emission_date || "",
      status: row.note_status || "pendente",
      observation: row.note_observation || ""
    }))
  };

  notesCache.set(cacheKey, result);
  return result;
}

export async function fetchNoteItems(noteKey) {
  if (itemsCache.has(noteKey)) return itemsCache.get(noteKey);

  const client = getSupabaseClient();
  const { data, error } = await client
    .from("loss_items")
    .select("id, note_key, item_index, product, quantity, unit_value, value, reason, sector")
    .eq("note_key", noteKey)
    .order("item_index", { ascending: true });

  if (error) {
    error.userMessage = "Nao foi possivel carregar os produtos da nota.";
    throw error;
  }

  const items = (data || []).map((row) => ({
    id: row.id,
    noteKey: row.note_key,
    itemIndex: Number(row.item_index || 0),
    product: row.product || "Produto",
    quantity: Number(row.quantity || 0),
    unitValue: Number(row.unit_value || 0),
    value: Number(row.value || 0),
    reason: row.reason || "",
    sector: row.sector || "Nao classificado"
  }));

  itemsCache.set(noteKey, items);
  return items;
}

function applyManagerialFilters(query, filters = {}) {
  let nextQuery = query;
  if (filters.store && filters.store !== "TODAS") nextQuery = nextQuery.eq("store", filters.store);
  if (filters.sector && filters.sector !== "TODOS") nextQuery = nextQuery.eq("sector", filters.sector);
  if (filters.product && filters.product !== "TODOS") nextQuery = nextQuery.eq("product", filters.product);
  if (filters.type && filters.type !== "TODOS") nextQuery = nextQuery.eq("type", filters.type);
  if (filters.reason && filters.reason !== "TODOS") {
    nextQuery = filters.reason === "Sem motivo" ? nextQuery.eq("reason", "") : nextQuery.eq("reason", filters.reason);
  }
  return nextQuery;
}

export async function fetchManagerialItems(filters = {}) {
  const client = getSupabaseClient();
  const year = Number(filters.year || new Date().getFullYear());
  const fromDate = `${year - 1}-01-01T00:00:00.000Z`;
  const toDate = `${year + 1}-01-01T00:00:00.000Z`;
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await applyManagerialFilters(
      client
        .from("loss_items")
        .select("id, note_key, invoice, store, emission_date, emission_month, competence_month, operation, type, display_type, sector, product, quantity, unit_value, value, reason")
        .gte("emission_date", fromDate)
        .lt("emission_date", toDate),
      filters
    )
      .order("emission_date", { ascending: true })
      .range(from, to);

    if (error) {
      error.userMessage = "Nao foi possivel carregar a analise gerencial.";
      throw error;
    }

    const pageRows = data || [];
    rows.push(...pageRows);
    if (pageRows.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }

  return rows.map((row) => ({
    id: row.id,
    noteKey: row.note_key,
    invoice: row.invoice || "-",
    store: row.store || "Loja nao identificada",
    date: row.emission_date || "",
    emissionMonth: row.emission_month || "",
    competenceMonth: row.competence_month || "",
    operation: row.operation || "",
    type: row.type || "Outros",
    displayType: row.display_type || row.type || "Outros",
    sector: row.sector || "Nao classificado",
    product: row.product || "Produto",
    quantity: Number(row.quantity || 0),
    unitValue: Number(row.unit_value || 0),
    value: Number(row.value || 0),
    reason: row.reason || ""
  }));
}

export async function saveEntryAudit({ cell, status, observation = "" }) {
  const client = getSupabaseClient();
  const payload = {
    store: cell.store,
    year: cell.year,
    month_number: cell.month,
    month_label: cell.monthLabel,
    type: cell.type,
    sector: cell.sector,
    status,
    observation,
    system_total_value: cell.totalValue,
    system_note_count: cell.noteCount,
    checked_at: new Date().toISOString()
  };

  const { data, error } = await client
    .from(TABLE_MONTHLY_ENTRY)
    .upsert(payload, {
      onConflict: "store,year,month_number,type,sector"
    })
    .select("id, status, observation")
    .single();

  if (error && isMissingBackendObject(error)) {
    const fallback = {
      entryId: cell.entryId || localEntryKey(cell),
      status,
      observation,
      savedAt: new Date().toISOString()
    };
    writeLocalAudit(localEntryKey(cell), fallback);
    return fallback;
  }

  if (error) {
    error.userMessage = "Nao foi possivel salvar a auditoria da celula.";
    throw error;
  }

  if (observation) {
    await client.from(TABLE_MONTHLY_OBSERVATION).insert({
      entry_id: data.id,
      scope: "entry",
      message: observation
    });
  }

  return {
    entryId: data.id,
    status: data.status || status,
    observation: data.observation || observation
  };
}

export async function saveNoteAudit({ cell, noteKey, status, observation = "" }) {
  const entry = await saveEntryAudit({
    cell,
    status: cell.status,
    observation: cell.observation || ""
  });

  const client = getSupabaseClient();
  const { data, error } = await client
    .from(TABLE_MONTHLY_NOTE)
    .upsert({
      entry_id: entry.entryId,
      note_key: noteKey,
      status,
      observation,
      checked_at: new Date().toISOString()
    }, {
      onConflict: "entry_id,note_key"
    })
    .select("entry_id, status, observation")
    .single();

  if (error && isMissingBackendObject(error)) {
    const fallback = {
      entryId: entry.entryId,
      status,
      observation,
      savedAt: new Date().toISOString()
    };
    writeLocalAudit(localNoteKey(cell, noteKey), fallback);
    return fallback;
  }

  if (error) {
    error.userMessage = "Nao foi possivel salvar a auditoria da nota.";
    throw error;
  }

  if (observation) {
    await client.from(TABLE_MONTHLY_OBSERVATION).insert({
      entry_id: entry.entryId,
      note_key: noteKey,
      scope: "note",
      message: observation
    });
  }

  return {
    entryId: data.entry_id,
    status: data.status || status,
    observation: data.observation || observation
  };
}
