import { balance } from "./core";
import type { Db, Id } from "./types";

export interface PositionRow {
  companyId: Id;
  productId: Id;
  locationId: Id;
  physical: number;
  available: number;
  reserved: number;
  transit: number;
  quarantine: number;
}

/** Posição de estoque derivada: físico não é disponível. Séries pelo estado da série; materiais pelo razão. */
export function stockPosition(db: Db, companyIds: Id[]): PositionRow[] {
  const map = new Map<string, PositionRow>();
  const row = (companyId: Id, productId: Id, locationId: Id) => {
    const k = `${companyId}|${productId}|${locationId}`;
    let r = map.get(k);
    if (!r) {
      r = { companyId, productId, locationId, physical: 0, available: 0, reserved: 0, transit: 0, quarantine: 0 };
      map.set(k, r);
    }
    return r;
  };
  for (const s of db.serials) {
    if (!s.locationId) continue;
    const loc = db.locations.find((l) => l.id === s.locationId);
    if (!loc || !companyIds.includes(loc.companyId)) continue;
    const r = row(loc.companyId, s.productId, loc.id);
    r.physical += 1;
    const blocked = s.technical === "quarentena" || s.technical === "defeito" || s.technical === "reparo" || loc.type === "quarentena";
    if (loc.type === "transito" || s.commercial === "em_transito") r.transit += 1;
    else if (blocked) r.quarantine += 1;
    else if (s.commercial === "reservado") r.reserved += 1;
    else if (s.commercial === "disponivel" && loc.type === "deposito") r.available += 1;
  }
  for (const p of db.products.filter((x) => !x.requiresSerial)) {
    for (const loc of db.locations.filter((l) => companyIds.includes(l.companyId))) {
      const q = balance(db, loc.companyId, p.id, loc.id);
      if (q === 0) continue;
      const r = row(loc.companyId, p.id, loc.id);
      r.physical = q;
      if (loc.type === "deposito") r.available = q;
      if (loc.type === "transito") r.transit = q;
      if (loc.type === "quarentena") r.quarantine = q;
    }
  }
  return [...map.values()].filter((r) => r.physical !== 0);
}
