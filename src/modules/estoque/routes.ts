// Fonte única das rotas do módulo. O prefixo é configurável (VITE_ESTOQUE_BASE_PATH, padrão /app).
export const BASE: string = ((import.meta as any).env?.VITE_ESTOQUE_BASE_PATH as string) || "/app";

/** Caminho absoluto de uma rota do módulo: p("/estoque/entradas") => "/app/estoque/entradas". */
export const p = (path: string) => `${BASE}${path.startsWith("/") ? path : `/${path}`}`;

/** Rotas públicas (fora do prefixo): acesso. */
export const PUBLIC = {
  login: "/login",
  verificacao: "/login/verificacao",
  recuperar: "/login/recuperar",
  definirSenha: "/senha/definir",
} as const;

/** Troca ":param" por valor. */
export const to = (path: string, params: Record<string, string> = {}) =>
  Object.entries(params).reduce((acc, [k, v]) => acc.replace(`:${k}`, encodeURIComponent(v)), path);
