const SUPABASE_URL = "https://khevuaohphrwhjasmbsy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_dof_x7F6Xt7zzLB-N0uf9Q_hm4STzvR";

export const TABLES = {
  notes: "loss_notes",
  items: "loss_items"
};

let client;

export function getSupabaseClient() {
  if (client) return client;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase?.createClient) {
    throw new Error("Configuração do Supabase ausente.");
  }

  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });

  return client;
}
