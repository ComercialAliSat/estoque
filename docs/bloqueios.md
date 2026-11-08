# Bloqueios e pendências

Nada travou a ponto de pular uma tela. Pendências que dependem de decisão, acesso ou validação externa:

- 2026-11-08 · Os 4 documentos .docx (Especificação v1.2, PRD v1.3, TRD v1.2, Fluxo de Telas v1.0) não estavam no computador; só o texto da Especificação colado no chat (truncado na seção 6). PRD, TRD e Fluxo não foram consultados; RN-001 a RN-019 só as citadas na Especificação. Colocar os arquivos em docs/ permite conferir as mensagens exatas do Fluxo de Telas.
- 2026-11-08 · Supabase real: as migrations (RLS, triggers, funções) foram escritas mas NÃO executadas contra Postgres (sem Docker nem projeto confirmado). O teste de acesso entre empresas está em TypeScript (rules.test.ts); falta o equivalente executado contra o RLS real. Autenticação, Storage e Edge Functions (convite de usuário, webhook do CRM, provedor de NF-e) ainda são simulados ou esboçados.
- 2026-11-08 · Adaptador de dados Supabase: o app roda com o adaptador demo (data/store.ts). O adaptador sobre o Supabase ainda não existe.
- 2026-11-08 · NF-e, Correios, CRM e Argos reais: ligações só esboçadas e desligadas por configuração (provedor ainda não escolhido).
- 2026-11-08 · Leitor Bluetooth e impressora de etiquetas reais não testados; código de barras é Code 39 pela impressão do navegador.
- 2026-11-08 · Regras fiscais e de depreciação: tipos de tributação de exemplo com alíquota zero; depreciação e prazo de cancelamento a validar com contador e Fiscal.
- 2026-11-08 · Layout real do H-Control desconhecido: N07 e N08 usam CSV com colunas definidas no sistema.
- 2026-11-08 · Dados reais de empresa (CNPJ, IE, UF de origem, endereços): placeholders; UF de origem assumida RS para sugerir tributação.
