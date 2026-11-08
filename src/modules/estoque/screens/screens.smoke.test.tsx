// Teste de fumaça: cada uma das 124 telas renderiza sem quebrar para um administrador e para a operação.
import { beforeAll, describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ComponentType } from "react";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

type Mods = {
  SCREENS: typeof import("./registry").SCREENS;
  groups: Record<string, Record<string, ComponentType>>;
  SessionProvider: typeof import("../session").SessionProvider;
  ToastProvider: typeof import("../components/ui").ToastProvider;
  getDb: typeof import("../data/store").getDb;
  GROUP: string;
};
let M: Mods;

async function load(userId: string, companyId?: string) {
  (globalThis as any).localStorage = new MemoryStorage();
  (globalThis as any).sessionStorage = new MemoryStorage();
  localStorage.setItem("estoque.demo.session.v1", JSON.stringify({ userId, companyId }));
  const [reg, ses, ui, store] = await Promise.all([import("./registry"), import("../session"), import("../components/ui"), import("../data/store")]);
  const files = import.meta.glob("./[A-N]_*.tsx", { eager: true }) as Record<string, { screens: Record<string, ComponentType> }>;
  const groups: Mods["groups"] = {};
  for (const [path, mod] of Object.entries(files)) groups[path.replace("./", "")[0]] = mod.screens;
  M = { SCREENS: reg.SCREENS, groups, SessionProvider: ses.SessionProvider, ToastProvider: ui.ToastProvider, getDb: store.getDb, GROUP: ses.GROUP };
}

function idFor(code: string, db: ReturnType<Mods["getDb"]>): string {
  const first = <T extends { id: string }>(a: T[]) => a[0]?.id ?? "x";
  const map: Record<string, string> = {
    C03: first(db.products), C06: first(db.customers), C07: first(db.customers), C09: first(db.suppliers), C11: first(db.locations), C13: first(db.taxTypes),
    D04: first(db.orders), D07: first(db.imports), D08: first(db.imports), D09: first(db.imports),
    E03: first(db.inbounds), E04: db.inbounds.find((i) => i.status === "em_conferencia")?.id ?? first(db.inbounds), E05: first(db.inbounds), E06: first(db.inbounds), E07: first(db.inbounds), E08: first(db.inbounds),
    F04: first(db.motherCodes), G03: first(db.outbounds), G04: first(db.outbounds), G05: first(db.outbounds), G09: first(db.returns), G12: first(db.transfers), G13: "",
    H02: first(db.products), H03: first(db.serials), H05: first(db.inventories), H06: first(db.inventories),
    I02: db.events.find((e) => e.status === "recebido" && e.type === "opportunity.won")?.id ?? "x", I05: first(db.contracts), I06: first(db.contracts),
    J03: first(db.workOrders), J04: first(db.workOrders), J05: first(db.workOrders), J06: first(db.workOrders), J07: first(db.workOrders), J10: first(db.assists), J11: first(db.assists), J12: first(db.assists), J13: first(db.assists),
    J16: first(db.kitOrders), J18: first(db.chips), J22: "ABC1D23", J23: first(db.workOrders),
    K03: first(db.invoices), K04: first(db.invoices), L02: first(db.serials), M02: "crm", N02: first(db.profiles), N04: "estoque", N06: first(db.companies), N08: first(db.hcontrol),
  };
  return map[code] ?? "x";
}

function patternFor(def: { code: string; paths: string[] }) {
  const raw = def.paths.find((p) => p.includes(":id")) ?? def.paths[0];
  return raw.startsWith("!") ? raw.slice(1) : raw;
}

function render(code: string, companyId?: string) {
  const def = M.SCREENS.find((s) => s.code === code)!;
  const C = M.groups[code[0]][code];
  expect(C, `tela ${code} exportada`).toBeTruthy();
  const pattern = patternFor(def);
  const concrete = pattern.replace(":id", idFor(code, M.getDb()));
  return renderToString(
    <MemoryRouter initialEntries={[`/app${concrete}`]}>
      <M.ToastProvider><M.SessionProvider>
        <Routes><Route path={`/app${pattern}`} element={<C />} /></Routes>
      </M.SessionProvider></M.ToastProvider>
    </MemoryRouter>,
  ) + (companyId ?? "");
}

const NO_DATA_IN_SEED = ["G09", "N08", "J22x"];

describe("124 telas renderizam (administrador, Traxor)", () => {
  beforeAll(async () => { await load("u_admin", "emp_traxor"); });
  it("o registro tem 124 telas únicas", () => {
    expect(M.SCREENS).toHaveLength(124);
    expect(new Set(M.SCREENS.map((s) => s.code)).size).toBe(124);
  });
  it("cada tela está implementada", () => {
    for (const s of M.SCREENS) expect(M.groups[s.code[0]][s.code], s.code).toBeTruthy();
  });
  it("renderiza todas sem erro e sem mensagem de falha", () => {
    const failed: string[] = [];
    for (const s of M.SCREENS) {
      try {
        const html = render(s.code);
        if (!html || html.length < 20) failed.push(`${s.code}: vazio`);
        if (/Não foi possível abrir/.test(html)) failed.push(`${s.code}: erro de tela`);
        if (/não encontrad/i.test(html) && !NO_DATA_IN_SEED.includes(s.code)) failed.push(`${s.code}: abriu como "não encontrado" (sem dado de demonstração?)`);
      } catch (e) {
        failed.push(`${s.code}: ${(e as Error).message}`);
      }
    }
    expect(failed).toEqual([]);
  });
});

describe("visão Grupo e perfil de Operação", () => {
  it("visão Grupo (somente leitura) renderiza as telas operacionais", async () => {
    await load("u_admin", "grupo");
    const failed: string[] = [];
    for (const code of ["B01", "C01", "E01", "G01", "H01", "I03", "J01", "K01"]) {
      try { render(code); } catch (e) { failed.push(`${code}: ${(e as Error).message}`); }
    }
    expect(failed).toEqual([]);
  });
  it("Operação sem custo não vê valores de custo na E08 nem na L03 (mostra sem permissão)", async () => {
    await load("u_oper", "emp_traxor");
    const e08 = render("E08");
    expect(e08).toContain("Sem permissão");
    const l03 = render("L03");
    expect(l03).toContain("Sem permissão");
    const j23 = render("J23");
    expect(j23).toContain("Sem permissão");
  });
});

describe("casca da aplicação", () => {
  it("o layout (menu, empresa, busca, pendências) renderiza para administrador e operação", async () => {
    for (const [u, c] of [["u_admin", "emp_traxor"], ["u_admin", "grupo"], ["u_oper", "emp_traxor"], ["u_oper_alisat", "emp_alisat"]] as const) {
      await load(u, c);
      const { Layout } = await import("../../../shell/Layout");
      const html = renderToString(
        <MemoryRouter initialEntries={["/app"]}>
          <M.ToastProvider><M.SessionProvider><Routes><Route path="/app" element={<Layout />} /></Routes></M.SessionProvider></M.ToastProvider>
        </MemoryRouter>,
      );
      expect(html).toContain("Busca global");
      expect(html).toContain(u === "u_oper_alisat" ? "Ali Sat" : "Traxor");
    }
  });
});
