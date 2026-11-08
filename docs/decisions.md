# Pontos a confirmar / decisões tomadas em modo autônomo

Formato: data · dúvida · escolha · motivo.

- 2026-11-08 · Os .docx (Especificação v1.2, PRD, TRD, Fluxo) não estavam no computador; só o texto da Especificação colado no chat (truncado na seção 6). · Usei o texto colado como fonte (`docs/especificacao-resumo.md`) e o mapa de telas em `src/modules/estoque/screens/registry.ts`. · É o que existe; PRD/TRD não consultados, RN-001 a RN-019 só as citadas na especificação.
- 2026-11-08 · Pasta e repositório. · Pasta `C:\Users\alisa\Downloads\estoque`, clone de github.com/ComercialAliSat/estoque, branch `main`. · Indicado pelo dono.
- 2026-11-08 · Não há Supabase/Docker confirmados para rodar localmente. · Camada de dados por interface (`data/`): adaptador **demo** (memória + localStorage, com seed) ligado por padrão e adaptador **supabase** esboçado; migrations SQL com RLS escritas em `supabase/migrations/`. Regras de negócio ficam em funções puras testadas (`domain/`). · Permite navegar de manhã sem infraestrutura; a validação de RLS contra Postgres real fica registrada em `bloqueios.md`.
- 2026-11-08 · Excel. · Exportação em CSV (UTF-8 com BOM, separador `;`) e em `.xls` HTML compatível com Excel, sem dependência externa. · Evita biblioteca com falhas conhecidas; abre no Excel.
- 2026-11-08 · Verificação em duas etapas (A02). · Simulada no modo demo (código fixo `000000`); real depende do TOTP do Supabase (MFA). · Não inventar segredo.
- 2026-11-08 · Saída sem nota na mesma empresa (G04/G12). · Padrão: exige nota; parâmetro em N11 permite desligar. · Mais seguro (RN-015).
- 2026-11-08 · Custo de kit inclui montagem. · Padrão "não" (soma só componentes), parâmetro em N11. · Mais simples.
- 2026-11-08 · UF de origem da empresa (para sugerir tributação em G02/K02). · Assumida "RS" (constante `DEFAULT_ORIGIN_UF`); cadastro de UF por empresa fica para N06. · Não inventar dado fiscal; a regra em si é dado editável (C13).
- 2026-11-08 · Códigos de barras das etiquetas. · Code 39 gerado em SVG sem dependência; QR/Datamatrix ficam para quando o modelo da impressora for definido (B04). · Mais simples e imprimível no navegador.
- 2026-11-08 · Fluxo G12 → K02 e G04 → K02. · K02 é a única tela que transmite a nota (saída, transferência entre empresas ou manual); a baixa de estoque acontece junto da autorização (RN-015). · Evita duas rotas para a mesma regra.
