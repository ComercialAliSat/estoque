# Pontos a confirmar / decisões tomadas em modo autônomo

Formato: data · dúvida · escolha · motivo.

- 2026-11-08 · Os .docx (Especificação v1.2, PRD, TRD, Fluxo) não estavam no computador; só o texto da Especificação colado no chat (truncado na seção 6). · Usei o texto colado como fonte (`docs/especificacao-resumo.md`) e o mapa de telas em `src/modules/estoque/screens/registry.ts`. · É o que existe; PRD/TRD não consultados, RN-001 a RN-019 só as citadas na especificação.
- 2026-11-08 · Pasta e repositório. · Pasta `C:\Users\alisa\Downloads\estoque`, clone de github.com/ComercialAliSat/estoque, branch `main`. · Indicado pelo dono.
- 2026-11-08 · Não há Supabase/Docker confirmados para rodar localmente. · Camada de dados por interface (`data/`): adaptador **demo** (memória + localStorage, com seed) ligado por padrão e adaptador **supabase** esboçado; migrations SQL com RLS escritas em `supabase/migrations/`. Regras de negócio ficam em funções puras testadas (`domain/`). · Permite navegar de manhã sem infraestrutura; a validação de RLS contra Postgres real fica registrada em `bloqueios.md`.
- 2026-11-08 · Excel. · Exportação em CSV (UTF-8 com BOM, separador `;`) e em `.xls` HTML compatível com Excel, sem dependência externa. · Evita biblioteca com falhas conhecidas; abre no Excel.
- 2026-11-08 · Verificação em duas etapas (A02). · Simulada no modo demo (código fixo `000000`); real depende do TOTP do Supabase (MFA). · Não inventar segredo.
- 2026-11-08 · Saída sem nota na mesma empresa (G04/G12). · Padrão: exige nota; parâmetro em N11 permite desligar. · Mais seguro (RN-015).
- 2026-11-08 · Custo de kit inclui montagem. · Padrão "não" (soma só componentes), parâmetro em N11. · Mais simples.
