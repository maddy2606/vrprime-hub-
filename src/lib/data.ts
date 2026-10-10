import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Person, Warehouse } from "@/lib/types";

export type Lookups = {
  people: Person[];
  warehouses: Warehouse[];
  personName: (id: string | null) => string;
  warehouseName: (id: string | null) => string;
};

export function buildLookups(people: Person[], warehouses: Warehouse[]): Lookups {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const warehousesById = new Map(warehouses.map((w) => [w.id, w]));
  return {
    people,
    warehouses,
    personName: (id) => (id ? (peopleById.get(id)?.name ?? "Unknown") : "Nobody"),
    warehouseName: (id) => (id ? (warehousesById.get(id)?.name ?? "Unknown") : "None"),
  };
}

/** People and warehouses: two small lists used on almost every screen. */
export const getLookups = cache(async (): Promise<Lookups> => {
  const supabase = await createClient();
  const [people, warehouses] = await Promise.all([
    supabase.from("profiles").select("id, name, role, active").order("name"),
    supabase.from("warehouses").select("*").order("sort_order"),
  ]);
  return buildLookups(people.data ?? [], warehouses.data ?? []);
});
