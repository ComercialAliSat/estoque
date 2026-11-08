# Gestão Integrada Ali Sat — Estoque (Traxor + Ali Sat)

Base do sistema de estoque do Grupo Ali Sat: React + Vite + TypeScript, Tailwind, Supabase (migrations com RLS prontas). Em português do Brasil, para computador e tablet.

> **Estado atual:** funciona em **modo demonstração** (dados simulados no navegador, autenticação e NF-e simuladas). As 124 telas existem; veja `docs/status-telas.md` para o que está pronto e parcial. A camada Supabase está escrita (`supabase/migrations`), mas ainda não foi executada contra um banco real.

## Como rodar

```bash
npm install
npm run dev          # http://localhost:5173
```

Entre com (senha de todos: `demo123`; código de verificação dos administradores: `000000`):

| Usuário | Perfil |
|---|---|
| `admin@demo.local` | Administrador, Traxor + Ali Sat |
| `admin2@demo.local` | Outro administrador (para aprovações: quem pede não aprova) |
| `oper@demo.local` | Operação, só Traxor, sem custos |
| `oper2@demo.local` | Operação, só Ali Sat |

O rodapé tem “Restaurar dados de demonstração”. Os dados de demonstração incluem duas empresas, produtos P e C, séries, uma entrada nacional, uma importação com custo provisório, uma conferência em andamento, código-mãe, uma venda com nota simulada, um comodato com OS finalizada, chips, vínculo, pedido aguardando aprovação, transferência, chamado de assistência, ordem de kit, inventário e uma oportunidade do CRM aguardando reserva.

## Verificações

```bash
npm run check        # typecheck + lint + testes
npm run build
npm run e2e          # com `npm run dev` rodando: percurso no navegador (Playwright)
```

Os testes (Vitest) cobrem: idempotência, RN-011, RN-015, RN-018, RN-020, permissões entre empresas, leitura de código-mãe, margem de produto e de serviço, jornadas (compra, CRM → nota, comodato, técnico N3, inventário) e uma renderização de fumaça das 124 telas. O e2e (Playwright) faz login, conferência, fechamento com custo, venda com nota simulada e abre 72 telas sem erro de console (na primeira vez: `npx playwright install chromium`).

## Variáveis (`.env.example`)

`VITE_ESTOQUE_DATA_MODE` (demo), `VITE_ESTOQUE_BASE_PATH` (prefixo das rotas, padrão `/app`), `VITE_INTEGRATION_CRM|ARGOS|NFE|CORREIOS` (`mock` por padrão), `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. A chave de serviço do Supabase, o token do provedor de NF-e e o segredo do CRM **só** existem em Edge Functions e nunca no repositório ou no navegador.

## Banco (Supabase)

Migrations numeradas em `supabase/migrations/` (tabelas `est_*` no schema `public`; só dependem de `auth.users`):

1. `0001` empresas, perfis, permissões por usuário/empresa/área, auditoria imutável, exportações, parâmetros
2. `0002` cadastros, serviços e tributação (regras como dados editáveis)
3. `0003` compras, importação, entradas, conferência, lotes e preço por série
4. `0004` séries, histórico por data, razão imutável + saldo derivado, `est_close_conference` (RN-020)
5. `0005` código-mãe, reservas por série (RN-018), notas simuladas, transferências, perdas, comodato, OS, assistência, kits, chips, integrações
6. `0006` RLS por empresa e por área, custos só para quem tem permissão

Aplicar: `supabase db push` (projeto ligado) ou rodar os arquivos em ordem no SQL editor. **Atenção:** nunca foram executados contra um Postgres real; revise antes de aplicar.

## Estrutura e cópia para o Argos

- Todo o sistema fica em `src/modules/estoque/` (telas, componentes, domínio, dados, integrações). Fora dele só `src/shell/` (layout, login/roteamento) e `src/main.tsx`.
- Rotas num único arquivo: `src/modules/estoque/routes.ts` (prefixo configurável) e o mapa das telas em `screens/registry.ts`.
- Regras de negócio puras e testadas em `domain/`. A camada `data/store.ts` é o adaptador **demo**; para produção, o mesmo contrato é implementado sobre o Supabase.
- Integrações atrás de portas em `integrations/{crm,argos,nfe,correios}` (simulada ligada por padrão, real só esboçada e desligada) e autenticação/lista de usuários em `integrations/auth` (o Argos troca por Supabase Auth).

Para levar ao Argos: copie `src/modules/estoque/` e `supabase/migrations/`, monte as rotas do registro sob o prefixo do Argos, troque `integrations/auth` pela autenticação do Argos e implemente o adaptador de dados sobre o Supabase.

## NF-e

O provedor é **simulado**. Toda nota exibe “SIMULADA, sem valor fiscal” em tela e no XML/PDF de exemplo, e a chave é fictícia. Regras de tributação são dados editáveis (C12 a C14); os tipos de exemplo vêm com alíquota zero e precisam ser validados pelo Fiscal/contador.

## Documentos

`docs/decisions.md` (decisões em modo autônomo), `docs/bloqueios.md`, `docs/status-telas.md`.
