import { getSupabaseClient, TABLES } from "../config/supabase.js";
import { classifySector, classifyType, competenceKey, detailType, monthKey, normalizeReason, safeStore } from "./classificacao.js";

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
    store: row.store || "Loja não identificada",
    date: row.emission_date || "",
    emissionMonth: row.emission_month || monthKey(row.emission_date),
    competenceMonth: row.competence_month || competenceKey(row.emission_date),
    operation: row.operation || "",
    type: row.type || "Outros",
    displayType: row.display_type || detailType(row.type, row.sector),
    sector: row.sector || "Não classificado",
    sectorManual: Boolean(row.sector_manual),
    product: row.product || "Produto",
    quantity: Number(row.quantity || 0),
    unitValue: Number(row.unit_value || 0),
    value: Number(row.value || 0),
    reason: normalizeReason(row.reason),
    selected: Boolean(row.selected)
  };
}

export function parseXmlFile(text, fileName) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");
  if (xml.querySelector("parsererror")) throw new Error(`O arquivo ${fileName} não é um XML válido.`);

  const ide = xml.getElementsByTagNameNS("*", "ide")[0] || xml;
  const emit = xml.getElementsByTagNameNS("*", "emit")[0] || xml;
  const operation = getText(ide, "natOp") || "SEM OPERAÇÃO";
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
      display_type: detailType(type, items[0]?.sector || "Não classificado"),
      sector: items[0]?.sector || "Não classificado",
      sector_manual: false,
      total_value: totalValue,
      item_count: items.length
    },
    items
  };
}

export async function loadAllItems() {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLES.items).select("*").order("emission_date", { ascending: false, nullsFirst: false }).order("item_index", { ascending: true });
  if (error) throw buildFriendlyError("Não foi possível carregar os dados salvos.", error);
  return (data || []).map(mapRowToItem);
}

export async function importXmlFiles(files) {
  const client = getSupabaseClient();
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
  const { data: existingNotes, error: existingError } = await client.from(TABLES.notes).select("note_key").in("note_key", noteKeys);
  if (existingError) throw buildFriendlyError("Não foi possível validar duplicidades antes da importação.", existingError);

  const existingSet = new Set((existingNotes || []).map((row) => row.note_key));
  const notesToInsert = parsed.filter((entry) => !existingSet.has(entry.note.note_key));
  const noteRows = notesToInsert.map((entry) => entry.note);
  const itemRows = notesToInsert.flatMap((entry) => entry.items);

  for (const noteChunk of chunkArray(noteRows, 100)) {
    if (!noteChunk.length) continue;
    const { error } = await client.from(TABLES.notes).upsert(noteChunk, { onConflict: "note_key" });
    if (error) throw buildFriendlyError("Falha ao salvar as notas importadas.", error);
  }

  for (const itemChunk of chunkArray(itemRows, 300)) {
    if (!itemChunk.length) continue;
    const { error } = await client.from(TABLES.items).upsert(itemChunk, { onConflict: "id" });
    if (error) throw buildFriendlyError("Falha ao salvar os itens importados.", error);
  }

  return { importedNotes: noteRows.length, skippedNotes: parsed.length - noteRows.length, invalidFiles };
}

export async function updateItemField(itemId, fields) {
  const client = getSupabaseClient();
  const { error } = await client.from(TABLES.items).update(fields).eq("id", itemId);
  if (error) throw buildFriendlyError("Não foi possível salvar a alteração do item.", error);
}

export async function updateReasonForNote(noteKey, reason, onlySelected = false) {
  const client = getSupabaseClient();
  let query = client.from(TABLES.items).update({ reason }).eq("note_key", noteKey);
  if (onlySelected) query = query.eq("selected", true);
  const { error } = await query;
  if (error) throw buildFriendlyError("Não foi possível atualizar os motivos da nota.", error);
}

export async function updateSectorForNote(noteKey, type, sector) {
  const client = getSupabaseClient();
  const displayType = detailType(type, sector);
  const { error: noteError } = await client.from(TABLES.notes).update({ sector, sector_manual: true, display_type: displayType }).eq("note_key", noteKey);
  if (noteError) throw buildFriendlyError("Não foi possível atualizar o setor da nota.", noteError);
  const { error: itemError } = await client.from(TABLES.items).update({ sector, sector_manual: true, display_type: displayType }).eq("note_key", noteKey);
  if (itemError) throw buildFriendlyError("Não foi possível refletir o setor nos itens da nota.", itemError);
}

export async function deleteNote(noteKey) {
  const client = getSupabaseClient();
  const { error } = await client.from(TABLES.notes).delete().eq("note_key", noteKey);
  if (error) throw buildFriendlyError("Não foi possível excluir a nota selecionada.", error);
}

export async function clearDatabase() {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLES.notes).select("note_key");
  if (error) throw buildFriendlyError("Não foi possível consultar os registros para limpeza.", error);
  const noteKeys = (data || []).map((row) => row.note_key);
  for (const chunk of chunkArray(noteKeys, 100)) {
    if (!chunk.length) continue;
    const { error: deleteError } = await client.from(TABLES.notes).delete().in("note_key", chunk);
    if (deleteError) throw buildFriendlyError("Não foi possível limpar a base de dados.", deleteError);
  }
}
