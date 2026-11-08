import { integrationMode, type ArgosPort } from "../ports";

export const mockArgos: ArgosPort = {
  async linkDemand() {
    /* simulado: sem chamada externa */
  },
  async listUsers() {
    return [];
  },
};

/** Esboço: a real chamará o Argos (desligada por configuração). */
export const realArgos: ArgosPort = {
  async linkDemand() {
    throw new Error("Integração real com o Argos desligada.");
  },
  async listUsers() {
    throw new Error("Integração real com o Argos desligada.");
  },
};

export const getArgos = (): ArgosPort => (integrationMode("ARGOS") === "real" ? realArgos : mockArgos);
