import { getSupabaseClient, TABLES } from "../config/supabase.js";

export function subscribeRealtime(onChange) {
  const client = getSupabaseClient();
  const channel = client
    .channel("gestao-perdas-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLES.notes }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: TABLES.items }, onChange)
    .subscribe();

  return async () => {
    await client.removeChannel(channel);
  };
}
