import { integrationMode, type NfePort } from "../ports";

/** Provedor SIMULADO: nunca produz nota com valor fiscal. A transmissão simulada fica em domain/fiscal.ts. */
export const mockNfe: NfePort = {
  async transmit() {
    return { status: "autorizada", message: "SIMULADA, sem valor fiscal" };
  },
  async consultKey() {
    return { found: false, items: [] };
  },
};

/** Esboço: o provedor real será escolhido depois (ponto em aberto na tela B04). */
export const realNfe: NfePort = {
  async transmit() {
    throw new Error("Provedor real de NF-e não configurado.");
  },
  async consultKey() {
    throw new Error("Provedor real de NF-e não configurado.");
  },
};

export const getNfe = (): NfePort => (integrationMode("NFE") === "real" ? realNfe : mockNfe);
