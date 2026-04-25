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
  return fetchAllGridRows((from, to) => applyGridFilters(
    client.from(VIEW_MONTHLY_GRID).select("*"),
    filters
  )
    .order("sector", { ascending: true })
    .order("month_number", { ascending: true })
    .order("type", { ascending: true })
    .range(from, to));
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
  let query = client
    .from(VIEW_MONTHLY_NOTES)
    .select("*", { count: "exact" })
    .eq("year", cell.year)
    .eq("month_number", cell.month)
    .eq("sector", cell.sector);

  if (cell.store && cell.store !== "TODAS") query = query.eq("store", cell.store);
  if (cell.type && cell.type !== "TODOS") query = query.eq("type", cell.type);
  else if (filters.type && filters.type !== "TODOS") query = query.eq("type", filters.type);

  const { data, error, count } = await query
    .order("emission_date", { ascending: true })
    .order("invoice", { ascending: true })
    .range(page * limit, page * limit + limit - 1);

  if (error) {
    error.userMessage = "Nao foi possivel carregar as notas da celula.";
    throw error;
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
