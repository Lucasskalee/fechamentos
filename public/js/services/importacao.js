import { getSupabaseClient, TABLES } from "../config/supabase.js";
import { classifySector, classifyType, competenceKey, detailType, monthKey, normalizeReason, safeStore } from "./classificacao.js";

const STORAGE_KEY = "gestao_perdas_local_db_v2";
const PRIMARY_PERSISTENCE = "remote";

const persistenceState = {
  mode: "remote",
  detail: ""
};

function setPersistence(mode, detail = "") {
  persistenceState.mode = mode;
  persistenceState.detail = detail;
}

export function getPersistenceInfo() {
  return { ...persistenceState, primary: PRIMARY_PERSISTENCE };
}

function buildFriendlyError(message, error) {
  console.error(error);
  const wrapped = new Error(message);
  const details = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ");
  wrapped.userMessage = details ? `${message} Detalhe: ${details}` : message;
  return wrapped;
}

function getText(parent, tag) {
  const nodes = parent.getElementsByTagNameNS("*", tag);
  return nodes && nodes[0] ? nodes[0].textContent.trim() : "";
}

function getAccessKey(xml) {
  const explicit = getText(xml, "chNFe");
  if (explicit) return explicit.replace(/\D/g, "");
  const infNFe = xml.getElementsByTagNameNS("*", "infNFe")[0];
  const infId = infNFe?.getAttribute("Id") || "";
  return infId ? infId.replace(/^NFe/i, "").replace(/\D/g, "") : "";
}

function chunkArray(items, size = 200) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function mapRowToItem(row) {
  return {
    id: row.id,
    noteKey: row.note_key,
    accessKey: row.access_key || "",
    fileName: row.source_file || "",
    invoice: row.invoice || "-",
    store: row.store || "Loja nao identificada",
    date: row.emission_date || "",
    emissionMonth: row.emission_month || monthKey(row.emission_date),
    competenceMonth: row.competence_month || competenceKey(row.emission_date),
    operation: row.operation || "",
    type: row.type || "Outros",
    displayType: row.display_type || detailType(row.type, row.sector),
    sector: row.sector || "Nao classificado",
    sectorManual: Boolean(row.sector_manual),
    product: row.product || "Produto",
    quantity: Number(row.quantity || 0),
    unitValue: Number(row.unit_value || 0),
    value: Number(row.value || 0),
    reason: normalizeReason(row.reason),
    selected: Boolean(row.selected)
  };
}

function mapRowToNote(row) {
  return {
    noteKey: row.note_key,
    accessKey: row.access_key || "",
    fileName: row.source_file || "",
    invoice: row.invoice || "-",
    store: row.store || "Loja nao identificada",
    date: row.emission_date || "",
    emissionMonth: row.emission_month || monthKey(row.emission_date),
    competenceMonth: row.competence_month || competenceKey(row.emission_date),
    operation: row.operation || "",
    type: row.type || "Outros",
    displayType: row.display_type || detailType(row.type, row.sector),
    sector: row.sector || "Nao classificado",
    sectorManual: Boolean(row.sector_manual),
    totalValue: Number(row.total_value || 0),
    itemCount: Number(row.item_count || 0)
  };
}

function mapItemToRow(item) {
  return {
    id: item.id,
    note_key: item.noteKey,
    item_index: item.itemIndex || Number(String(item.id).split("::").pop()) || 0,
    access_key: item.accessKey || null,
    source_file: item.fileName || "",
    invoice: item.invoice || "-",
    store: item.store || "Loja nao identificada",
    emission_date: item.date || null,
    emission_month: item.emissionMonth || monthKey(item.date),
    competence_month: item.competenceMonth || competenceKey(item.date),
    operation: item.operation || "",
    type: item.type || "Outros",
    display_type: item.displayType || detailType(item.type, item.sector),
    sector: item.sector || "Nao classificado",
    sector_manual: Boolean(item.sectorManual),
    product: item.product || "Produto",
    quantity: Number(item.quantity || 0),
    unit_value: Number(item.unitValue || 0),
    value: Number(item.value || 0),
    reason: normalizeReason(item.reason),
    selected: Boolean(item.selected)
  };
}

function localStorageAvailable() {
  try {
    return Boolean(window.localStorage);
  } catch {
    return false;
  }
}

function readLocalDatabase() {
  if (!localStorageAvailable()) return { notes: [], items: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { notes: [], items: [] };
    const parsed = JSON.parse(raw);
    return {
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      items: Array.isArray(parsed.items) ? parsed.items : []
    };
  } catch (error) {
    console.error(error);
    return { notes: [], items: [] };
  }
}

function writeLocalDatabase(database) {
  if (!localStorageAvailable()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    notes: database.notes || [],
    items: database.items || []
  }));
}

function localDetail() {
  return "Supabase indisponivel; exibindo fallback temporario do navegador.";
}

async function requireRemote(remoteAction) {
  try {
    const result = await remoteAction();
    setPersistence("remote");
    return result;
  } catch (error) {
    setPersistence("remote");
    throw error;
  }
}

async function withLocalFallback(remoteAction, fallbackAction) {
  try {
    const result = await remoteAction();
    setPersistence("remote");
    return result;
  } catch (error) {
    console.error(error);
    const result = await fallbackAction(error);
    setPersistence("local", localDetail());
    return result;
  }
}

async function loadNotesFromDatabase(client) {
  const { data, error } = await client
    .from(TABLES.notes)
    .select("*")
    .order("emission_date", { ascending: false, nullsFirst: false })
    .order("invoice", { ascending: true });

  if (error) throw buildFriendlyError("Nao foi possivel carregar as notas salvas no banco.", error);
  return (data || []).map(mapRowToNote);
}

async function loadItemsFromDatabase(client) {
  const { data, error } = await client
    .from(TABLES.items)
    .select("*")
    .order("emission_date", { ascending: false, nullsFirst: false })
    .order("item_index", { ascending: true });

  if (error) throw buildFriendlyError("Nao foi possivel carregar os itens salvos no banco.", error);
  return (data || []).map(mapRowToItem);
}

export function parseXmlFile(text, fileName) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");
  if (xml.querySelector("parsererror")) throw new Error(`O arquivo ${fileName} nao e um XML valido.`);

  const ide = xml.getElementsByTagNameNS("*", "ide")[0] || xml;
  const emit = xml.getElementsByTagNameNS("*", "emit")[0] || xml;
  const operation = getText(ide, "natOp") || "SEM OPERACAO";
  const invoice = getText(ide, "nNF") || "-";
  const date = getText(ide, "dhEmi") || getText(ide, "dEmi") || "";
  const store = safeStore(getText(emit, "xFant") || getText(emit, "xNome"));
  const accessKey = getAccessKey(xml);
  const noteKey = accessKey || [invoice, store, date, operation].join("::");
  const dets = [...xml.getElementsByTagNameNS("*", "det")];
  const type = classifyType(operation);

  const items = dets.map((det, index) => {
    const productNode = det.getElementsByTagNameNS("*", "prod")[0] || det;
    const product = getText(productNode, "xProd") || "Produto";
    const sector = classifySector(operation, product);
    return {
      id: `${noteKey}::${index + 1}`,
      note_key: noteKey,
      item_index: index + 1,
      access_key: accessKey || null,
      source_file: fileName,
      invoice,
      store,
      emission_date: date || null,
      emission_month: monthKey(date),
      competence_month: competenceKey(date),
      operation,
      type,
      display_type: detailType(type, sector),
      sector,
      sector_manual: false,
      product,
      quantity: Number.parseFloat(getText(productNode, "qCom") || "0") || 0,
      unit_value: Number.parseFloat(getText(productNode, "vUnCom") || "0") || 0,
      value: Number.parseFloat(getText(productNode, "vProd") || "0") || 0,
      reason: "",
      selected: false
    };
  });

  const totalValue = items.reduce((sum, item) => sum + Number(item.value || 0), 0);

  return {
    note: {
      note_key: noteKey,
      access_key: accessKey || null,
      source_file: fileName,
      invoice,
      store,
      emission_date: date || null,
      emission_month: monthKey(date),
      competence_month: competenceKey(date),
      operation,
      type,
      display_type: detailType(type, items[0]?.sector || "Nao classificado"),
      sector: items[0]?.sector || "Nao classificado",
      sector_manual: false,
      total_value: totalValue,
      item_count: items.length
    },
    items
  };
}

export async function loadAllItems() {
  const database = await loadAllData();
  return database.items;
}

export async function loadAllData() {
  // Fonte oficial do sistema: Supabase. O fallback local existe apenas como contingencia temporaria.
  try {
    const client = getSupabaseClient();
    const notes = await loadNotesFromDatabase(client);

    try {
      const items = await loadItemsFromDatabase(client);
      setPersistence("remote");
      return { notes, items };
    } catch (error) {
      setPersistence("remote_partial", `Notas oficiais carregadas do Supabase, mas os itens falharam. ${error.userMessage || ""}`.trim());
      return { notes, items: [] };
    }
  } catch (error) {
    console.error(error);
    const database = readLocalDatabase();
    setPersistence("local", `${localDetail()} ${error.userMessage || "Falha ao ler os dados oficiais do Supabase."}`.trim());
    return {
      notes: (database.notes || []).map(mapRowToNote),
      items: (database.items || []).map(mapRowToItem)
    };
  }
}

async function verifyImportedData(client, parsedEntries) {
  const noteKeys = parsedEntries.map((entry) => entry.note.note_key);
  const expectedItemCountByNote = new Map(parsedEntries.map((entry) => [entry.note.note_key, entry.items.length]));

  const { data: noteRows, error: notesError } = await client
    .from(TABLES.notes)
    .select("note_key, item_count")
    .in("note_key", noteKeys);
  if (notesError) throw buildFriendlyError("Falha ao confirmar as notas salvas no banco.", notesError);

  const { data: itemRows, error: itemsError } = await client
    .from(TABLES.items)
    .select("note_key")
    .in("note_key", noteKeys);
  if (itemsError) throw buildFriendlyError("Falha ao confirmar os itens salvos no banco.", itemsError);

  const savedNotes = new Map((noteRows || []).map((row) => [row.note_key, Number(row.item_count || 0)]));
  const savedItemCountByNote = new Map();
  (itemRows || []).forEach((row) => {
    savedItemCountByNote.set(row.note_key, (savedItemCountByNote.get(row.note_key) || 0) + 1);
  });

  for (const noteKey of noteKeys) {
    if (!savedNotes.has(noteKey)) {
      throw buildFriendlyError(`A nota ${noteKey} nao foi localizada no Supabase apos a importacao.`, new Error("missing_note_after_import"));
    }

    const expectedCount = expectedItemCountByNote.get(noteKey) || 0;
    const savedCount = savedItemCountByNote.get(noteKey) || 0;
    const savedHeaderCount = savedNotes.get(noteKey) || 0;
    if (savedCount < expectedCount || savedHeaderCount < expectedCount) {
      throw buildFriendlyError(`A nota ${noteKey} foi salva de forma incompleta no Supabase.`, new Error("partial_items_after_import"));
    }
  }
}

function dedupeParsedEntries(entries) {
  const entriesByNoteKey = new Map();
  entries.forEach((entry) => {
    if (!entry?.note?.note_key) return;
    entriesByNoteKey.set(entry.note.note_key, entry);
  });
  return [...entriesByNoteKey.values()];
}

export async function importXmlFiles(files) {
  const parsed = [];
  const invalidFiles = [];

  for (const file of files) {
    const text = await file.text();
    try {
      parsed.push(parseXmlFile(text, file.name));
    } catch (error) {
      invalidFiles.push(file.name);
      console.error(error);
    }
  }

  const uniqueParsed = dedupeParsedEntries(parsed);
  if (!uniqueParsed.length) return { importedNotes: 0, skippedNotes: 0, invalidFiles };

  return requireRemote(
    async () => {
      const client = getSupabaseClient();
      const noteRows = uniqueParsed.map((entry) => entry.note);
      const itemRows = uniqueParsed.flatMap((entry) => entry.items);

      for (const noteChunk of chunkArray(noteRows, 100)) {
        if (!noteChunk.length) continue;
        const { error } = await client.from(TABLES.notes).upsert(noteChunk, { onConflict: "note_key" });
        if (error) throw buildFriendlyError("Falha ao salvar as notas importadas no banco.", error);
      }

      for (const itemChunk of chunkArray(itemRows, 300)) {
        if (!itemChunk.length) continue;
        const { error } = await client.from(TABLES.items).upsert(itemChunk, { onConflict: "id" });
        if (error) throw buildFriendlyError("Falha ao salvar os itens importados no banco.", error);
      }

      await verifyImportedData(client, uniqueParsed);

      return {
        importedNotes: uniqueParsed.length,
        skippedNotes: Math.max(parsed.length - uniqueParsed.length, 0),
        invalidFiles
      };
    }
  );
}

export async function updateItemField(itemId, fields) {
  return withLocalFallback(
    async () => {
      const client = getSupabaseClient();
      const { error } = await client.from(TABLES.items).update(fields).eq("id", itemId);
      if (error) throw error;
    },
    async () => {
      const database = readLocalDatabase();
      database.items = (database.items || []).map((row) => row.id === itemId ? { ...row, ...fields } : row);
      writeLocalDatabase(database);
    }
  );
}

export async function updateReasonForNote(noteKey, reason, onlySelected = false) {
  return withLocalFallback(
    async () => {
      const client = getSupabaseClient();
      let query = client.from(TABLES.items).update({ reason }).eq("note_key", noteKey);
      if (onlySelected) query = query.eq("selected", true);
      const { error } = await query;
      if (error) throw error;
    },
    async () => {
      const database = readLocalDatabase();
      database.items = (database.items || []).map((row) => {
        if (row.note_key !== noteKey) return row;
        if (onlySelected && !row.selected) return row;
        return { ...row, reason };
      });
      writeLocalDatabase(database);
    }
  );
}

export async function updateSectorForNote(noteKey, type, sector) {
  const displayType = detailType(type, sector);
  return withLocalFallback(
    async () => {
      const client = getSupabaseClient();
      const { error: noteError } = await client.from(TABLES.notes).update({ sector, sector_manual: true, display_type: displayType }).eq("note_key", noteKey);
      if (noteError) throw noteError;
      const { error: itemError } = await client.from(TABLES.items).update({ sector, sector_manual: true, display_type: displayType }).eq("note_key", noteKey);
      if (itemError) throw itemError;
    },
    async () => {
      const database = readLocalDatabase();
      database.notes = (database.notes || []).map((row) => row.note_key === noteKey ? { ...row, sector, sector_manual: true, display_type: displayType } : row);
      database.items = (database.items || []).map((row) => row.note_key === noteKey ? { ...row, sector, sector_manual: true, display_type: displayType } : row);
      writeLocalDatabase(database);
    }
  );
}

export async function deleteNote(noteKey) {
  return withLocalFallback(
    async () => {
      const client = getSupabaseClient();
      const { error } = await client.from(TABLES.notes).delete().eq("note_key", noteKey);
      if (error) throw error;
    },
    async () => {
      const database = readLocalDatabase();
      database.notes = (database.notes || []).filter((row) => row.note_key !== noteKey);
      database.items = (database.items || []).filter((row) => row.note_key !== noteKey);
      writeLocalDatabase(database);
    }
  );
}

export async function clearDatabase() {
  return withLocalFallback(
    async () => {
      const client = getSupabaseClient();
      const { data, error } = await client.from(TABLES.notes).select("note_key");
      if (error) throw error;
      const noteKeys = (data || []).map((row) => row.note_key);
      for (const chunk of chunkArray(noteKeys, 100)) {
        if (!chunk.length) continue;
        const { error: deleteError } = await client.from(TABLES.notes).delete().in("note_key", chunk);
        if (deleteError) throw deleteError;
      }
    },
    async () => {
      writeLocalDatabase({ notes: [], items: [] });
    }
  );
}
