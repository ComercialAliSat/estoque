# Status das telas (124 telas)

Atualizado em 2026-11-08. **Pronta** = abre, grava e leva à próxima tela da especificação (coberta por teste de fumaça das 124 telas e, em parte, por testes de regra e por um percurso no navegador). **Parcial** = funciona, mas com a lacuna descrita. **Não feita** = nenhuma tela ficou sem implementação.

Resumo: **88 prontas**, **36 parciais**, **0 não feitas**.

**Importante:** o sistema roda hoje no modo demonstração (dados simulados no navegador, autenticação simulada, NF-e simulada). A camada Supabase (migrations com RLS) está escrita, mas **não foi executada contra um Postgres real** nesta sessão. Veja `docs/bloqueios.md`.

| Tela | Nome | Situação | Observação |
|---|---|---|---|
| A01 | Login | parcial | Fluxo completo, mas a autenticação é simulada (senha demo123, código 000000). Supabase Auth/TOTP real ainda não ligado. |
| A02 | Código de verificação | parcial | Fluxo completo, mas a autenticação é simulada (senha demo123, código 000000). Supabase Auth/TOTP real ainda não ligado. |
| A03 | Esqueci minha senha | parcial | Mensagem neutra e fluxo ok; nenhum e-mail é enviado de verdade. |
| A04 | Definir ou redefinir senha | parcial | Valida regras da senha (10+ caracteres, comuns recusadas), mas não grava senha (sem Auth real). Validade do link (24 h) é só texto. |
| A05 | Boas-vindas | pronta | Abre, grava e leva à próxima tela. |
| A06 | Escolha de empresa | pronta | Abre, grava e leva à próxima tela. |
| A07 | Sem acesso | pronta | Abre, grava e leva à próxima tela. |
| A08 | Meu perfil | parcial | Mostra perfil; trocar senha e ativar verificação levam às telas simuladas A04/A02. |
| A09 | Configuração inicial | pronta | Abre, grava e leva à próxima tela. |
| B01 | Painel inicial | pronta |  |
| B02 | Busca global | pronta |  |
| B03 | Pendências e avisos | pronta | "Visto" fica salvo só neste navegador. |
| B04 | Pontos a confirmar | pronta |  |
| C01 | Produtos | pronta |  |
| C02 | Criar ou editar produto | pronta |  |
| C03 | Detalhe do produto | pronta |  |
| C04 | Importar produtos por planilha | pronta |  |
| C05 | Clientes | pronta |  |
| C06 | Criar ou editar cliente | parcial | Falta múltiplos endereços e contatos (só cidade/UF). |
| C07 | Detalhe do cliente | parcial | Aba Documentos vazia (depende do armazenamento do Supabase). |
| C08 | Fornecedores | pronta |  |
| C09 | Ficha do fornecedor | parcial | Falta contatos do fornecedor. |
| C10 | Locais de estoque | pronta |  |
| C11 | Ficha do local | pronta |  |
| C12 | Tipos de tributação | pronta |  |
| C13 | Editor do tipo de tributação | pronta |  |
| C14 | CFOP e NCM por produto | pronta |  |
| C15 | Serviços | pronta |  |
| D01 | Pedidos de compra | pronta |  |
| D02 | Nova requisição ou pedido | parcial | Anexos não implementados. |
| D03 | Aprovações de compra | pronta |  |
| D04 | Detalhe do pedido | pronta |  |
| D05 | Processos de importação | pronta |  |
| D06 | Novo processo de importação | pronta |  |
| D07 | Detalhe da importação | pronta |  |
| D08 | Custos e rateio | pronta |  |
| D09 | Documentos da importação | parcial | Guarda só os dados do documento; upload/download real depende do Storage do Supabase. |
| E01 | Entradas | pronta |  |
| E02 | Nova entrada | parcial | XML lido por parser simples (não testado com XMLs reais de NF-e); consulta por chave não traz itens (provedor simulado). |
| E03 | Itens da nota | pronta |  |
| E04 | Conferência por leitura | parcial | Leitura, duplicidade, manual com motivo, código-mãe e fila offline implementados; reconexão offline não tem teste automatizado e o leitor Bluetooth real não foi testado. |
| E05 | Divergências | pronta |  |
| E06 | Fechar conferência | pronta |  |
| E07 | Detalhe da entrada | parcial | XML/PDF do comprovante são simplificados. |
| E08 | Custo por lote e série | pronta |  |
| F01 | Códigos-mãe | pronta |  |
| F02 | Gerar código-mãe | pronta |  |
| F03 | Prévia do código-mãe | pronta |  |
| F04 | Detalhe do código-mãe | pronta |  |
| F05 | Leitor universal | pronta |  |
| F06 | Etiquetas | parcial | Etiquetas em Code 39 pela impressão do navegador; modelo da impressora e leitura com leitor real pendentes (B04). |
| G01 | Saídas | pronta |  |
| G02 | Nova saída | pronta |  |
| G03 | Separação e leitura | pronta |  |
| G04 | Revisão da saída | pronta |  |
| G05 | Detalhe da saída | pronta |  |
| G06 | Devoluções | pronta |  |
| G07 | Nova devolução | pronta |  |
| G08 | Revisão da devolução | parcial | "Emitir nota de devolução" abre a K02 avulsa, sem vínculo automático com a devolução. |
| G09 | Triagem da devolução | pronta |  |
| G10 | Transferências | pronta |  |
| G11 | Nova transferência | pronta |  |
| G12 | Revisão da transferência | pronta |  |
| G13 | Em trânsito e recebimento | parcial | Recebimento com divergência marca a transferência como divergente; o aviso em B03 ainda não lista esse caso. |
| G14 | Perdas e baixas | parcial | Solicitar/aprovar/rejeitar e baixa funcionam; a nota de perda não é gerada automaticamente. |
| H01 | Posição de estoque | pronta |  |
| H02 | Detalhe do produto no estoque | pronta |  |
| H03 | Ficha do equipamento | parcial | Aba Documentos vazia; depreciação em L02. |
| H04 | Inventários | pronta |  |
| H05 | Contagem | pronta |  |
| H06 | Aprovação de ajuste | pronta |  |
| H07 | Relatórios de estoque | pronta |  |
| I01 | Reservas do CRM | pronta |  |
| I02 | Reservar séries | pronta |  |
| I03 | Contratos e comodatos | pronta |  |
| I04 | Novo comodato | pronta |  |
| I05 | Detalhe do contrato | pronta |  |
| I06 | Retorno de comodato | pronta |  |
| I07 | Relatório de comodato | parcial | Payback divide a mensalidade igualmente entre os equipamentos do contrato (simplificação a validar). |
| J01 | Ordens de serviço | pronta |  |
| J02 | Nova OS | parcial | Vínculo opcional com demanda do Argos não implementado. |
| J03 | Detalhe da OS | pronta |  |
| J04 | Materiais da OS | parcial | "Enviar ao técnico" leva à G11 sem pré-preencher as séries. |
| J05 | Registro de execução | parcial | Fotos só registram o nome do arquivo (sem upload). |
| J06 | Finalizar OS | pronta |  |
| J07 | Comprovante da OS | pronta |  |
| J08 | Assistência e garantia | pronta |  |
| J09 | Abrir chamado | parcial | Evidências só como texto. |
| J10 | Triagem e diagnóstico | pronta |  |
| J11 | Reparo ou RMA | pronta |  |
| J12 | Substituição de equipamento | parcial | Substituição fecha vínculos e abre novos; cobre o caso comum, sem cenários de custo/garantia da série nova. |
| J13 | Encerrar assistência | pronta |  |
| J14 | Montagem de kits | pronta |  |
| J15 | Nova ordem de montagem | pronta |  |
| J16 | Montagem e configuração por unidade | pronta |  |
| J17 | Chips | pronta |  |
| J18 | Ficha do chip | pronta |  |
| J19 | Entrada de chips | pronta |  |
| J20 | Plataformas e vínculos | pronta |  |
| J21 | Novo vínculo ou troca | pronta |  |
| J22 | Ficha do veículo ou instalação | pronta |  |
| J23 | Custos e margem da OS | pronta |  |
| K01 | Notas fiscais | pronta | Provedor SIMULADO: toda nota exibe "SIMULADA, sem valor fiscal". |
| K02 | Emitir nota | pronta | Provedor SIMULADO: toda nota exibe "SIMULADA, sem valor fiscal". |
| K03 | Detalhe da nota | parcial | PDF = impressão do navegador (DANFE simulado); e-mail é simulado. |
| K04 | Cancelar ou corrigir nota | parcial | Prazo legal de cancelamento não é validado (conferir com o Fiscal). |
| K05 | Inutilização | parcial | Valida faixa e justificativa e registra na auditoria; a numeração do provedor simulado não é alterada. |
| L01 | Custo, depreciação e payback | parcial | Depreciação depende da vida útil informada pela pessoa (validar com o contador); nenhuma taxa é assumida. |
| L02 | Detalhe de custo | parcial | Idem L01. |
| L03 | Margem por venda | pronta | Margem de produto, serviço e comodato; só administradores. |
| M01 | Painel de integrações | pronta |  |
| M02 | Configurar integração | parcial | Testar conexão é simulado; mapeamento/credenciais não persistem (só auditoria). Ligações reais desligadas. |
| M03 | Fila de eventos | pronta |  |
| N01 | Usuários | pronta |  |
| N02 | Criar ou editar usuário | parcial | Convite/redefinição simulados; criação real de usuário exige Edge Function + Supabase Auth. |
| N03 | Áreas e permissões | pronta |  |
| N04 | Editar área | parcial | Edita as ações-modelo por área; "telas liberadas por empresa" não implementado. |
| N05 | Empresas | pronta |  |
| N06 | Editar empresa | parcial | Falta endereço; certificado não é enviado; provedor real indisponível; teste de emissão é simulado. |
| N07 | Importar dados do H-Control | parcial | Formato dos CSV é o definido aqui (colunas na tela); o layout real de exportação do H-Control é desconhecido. Notas só para conferência de totais. |
| N08 | Conferir importação | parcial | Confere contagens/erros e grava produtos, clientes, séries e saldos de abertura; sem comparação com arquivos reais do H-Control. |
| N09 | Auditoria | pronta |  |
| N10 | Exportações | pronta |  |
| N11 | Parâmetros | parcial | Falta numeração e textos de e-mail (dependem do provedor de NF-e / e-mail real). |

## Onde parou

Todas as fases (0 a 6) foram percorridas. Nada ficou travado por falta de tempo. Os pontos que ficaram para a próxima rodada estão nas telas marcadas como parciais acima e em `docs/bloqueios.md`: ligar o Supabase real (Auth, RLS, Storage, Edge Functions), conectar o provedor de NF-e, testar a leitura com o leitor Bluetooth real e validar as regras fiscais e de depreciação com o contador.
