import { integrationMode, type CorreiosPort } from "../ports";

export const mockCorreios: CorreiosPort = {
  async track(code) {
    return { status: "Simulado", events: [{ at: new Date().toISOString(), text: `Rastreio simulado para ${code}` }] };
  },
};

export const realCorreios: CorreiosPort = {
  async track() {
    throw new Error("Integração real com os Correios desligada.");
  },
};

export const getCorreios = (): CorreiosPort => (integrationMode("CORREIOS") === "real" ? realCorreios : mockCorreios);
