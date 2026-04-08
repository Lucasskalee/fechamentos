import { getSupabaseClient, TABLES } from "../config/supabase.js";
import { classifySector, classifyType, competenceKey, detailType, monthKey, normalizeReason, safeStore } from "./classificacao.js";

const STORAGE_KEY = "gestao_perdas_local_db_v2";

const persistenceState = {
  mode: "remote",
  detail: ""
};

function setPersistence(mode, detail = "") {
  persistenceState.mode = mode;
  persistenceState.detail = detail;
}

export function getPersistenceInfo() {
  return { ...persistenceState };
}

function buildFriendlyError(message, error) {
  console.error(error);
  const wrapped = new Error(message);
  wrapped.userMessage = message;
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
  return "Supabase indisponivel; usando os dados salvos neste navegador.";
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
  return withLocalFallback(
    async () => {
      const client = getSupabaseClient();
      const { data, error } = await client
        .from(TABLES.items)
        .select("*")
        .order("emission_date", { ascending: false, nullsFirst: false })
        .order("item_index", { ascending: true });
      if (error) throw error;
      return (data || []).map(mapRowToItem);
    },
    async () => readLocalDatabase().items.map(mapRowToItem)
  );
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

  if (!parsed.length) return { importedNotes: 0, skippedNotes: 0, invalidFiles };

  const noteKeys = parsed.map((entry) => entry.note.note_key);

  return withLocalFallback(
    async () => {
      const client = getSupabaseClient();
      const { data: existingNotes, error: existingError } = await client.from(TABLES.notes).select("note_key").in("note_key", noteKeys);
      if (existingError) throw existingError;

      const existingSet = new Set((existingNotes || []).map((row) => row.note_key));
      const notesToInsert = parsed.filter((entry) => !existingSet.has(entry.note.note_key));
      const noteRows = notesToInsert.map((entry) => entry.note);
      const itemRows = notesToInsert.flatMap((entry) => entry.items);

      for (const noteChunk of chunkArray(noteRows, 100)) {
        if (!noteChunk.length) continue;
        const { error } = await client.from(TABLES.notes).upsert(noteChunk, { onConflict: "note_key" });
        if (error) throw error;
      }

      for (const itemChunk of chunkArray(itemRows, 300)) {
        if (!itemChunk.length) continue;
        const { error } = await client.from(TABLES.items).upsert(itemChunk, { onConflict: "id" });
        if (error) throw error;
      }

      return { importedNotes: noteRows.length, skippedNotes: parsed.length - noteRows.length, invalidFiles };
    },
    async () => {
      const database = readLocalDatabase();
      const existingSet = new Set((database.notes || []).map((row) => row.note_key));
      const notesToInsert = parsed.filter((entry) => !existingSet.has(entry.note.note_key));
      database.notes = [...(database.notes || []), ...notesToInsert.map((entry) => entry.note)];
      database.items = [...(database.items || []), ...notesToInsert.flatMap((entry) => entry.items)];
      writeLocalDatabase(database);
      return { importedNotes: notesToInsert.length, skippedNotes: parsed.length - notesToInsert.length, invalidFiles };
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
