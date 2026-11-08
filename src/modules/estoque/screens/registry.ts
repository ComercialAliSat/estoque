// Mapa das 124 telas (Especificação v1.2). Contrato de navegação: códigos e rotas.
import type { Area } from "../domain/types";

export interface ScreenDef {
  code: string;
  title: string;
  /** Caminhos relativos ao prefixo do módulo (ver routes.ts). Públicos começam com "!" (ex.: "!/login"). */
  paths: string[];
  area: Area | "geral";
  adminOnly?: boolean;
  menu?: string; // grupo de menu em que aparece como atalho
}

const S = (code: string, title: string, paths: string | string[], area: ScreenDef["area"] = "estoque", extra: Partial<ScreenDef> = {}): ScreenDef => ({
  code, title, paths: Array.isArray(paths) ? paths : [paths], area, ...extra,
});

export const SCREENS: ScreenDef[] = [
  // A. Acesso
  S("A01", "Login", "!/login", "geral"),
  S("A02", "Código de verificação", "!/login/verificacao", "geral"),
  S("A03", "Esqueci minha senha", "!/login/recuperar", "geral"),
  S("A04", "Definir ou redefinir senha", "!/senha/definir", "geral"),
  S("A05", "Boas-vindas", "/boas-vindas", "geral"),
  S("A06", "Escolha de empresa", "/empresa", "geral"),
  S("A07", "Sem acesso", "/sem-acesso", "geral"),
  S("A08", "Meu perfil", "/perfil", "geral"),
  S("A09", "Configuração inicial", "/admin/configuracao-inicial", "geral", { adminOnly: true, menu: "Administração" }),
  // B. Início
  S("B01", "Painel inicial", "", "geral", { menu: "Início" }),
  S("B02", "Busca global", "/busca", "geral"),
  S("B03", "Pendências e avisos", "/pendencias", "geral", { menu: "Início" }),
  S("B04", "Pontos a confirmar", "/pendencias/decisoes", "geral", { adminOnly: true, menu: "Início" }),
  // C. Cadastros
  S("C01", "Produtos", "/cadastros/produtos", "estoque", { menu: "Cadastros" }),
  S("C02", "Criar ou editar produto", ["/cadastros/produtos/novo", "/cadastros/produtos/:id/editar"]),
  S("C03", "Detalhe do produto", "/cadastros/produtos/:id"),
  S("C04", "Importar produtos por planilha", "/cadastros/produtos/importar"),
  S("C05", "Clientes", "/cadastros/clientes", "estoque", { menu: "Cadastros" }),
  S("C06", "Criar ou editar cliente", ["/cadastros/clientes/novo", "/cadastros/clientes/:id/editar"]),
  S("C07", "Detalhe do cliente", "/cadastros/clientes/:id"),
  S("C08", "Fornecedores", "/cadastros/fornecedores", "estoque", { menu: "Cadastros" }),
  S("C09", "Ficha do fornecedor", ["/cadastros/fornecedores/novo", "/cadastros/fornecedores/:id"]),
  S("C10", "Locais de estoque", "/cadastros/locais", "estoque", { menu: "Cadastros" }),
  S("C11", "Ficha do local", ["/cadastros/locais/novo", "/cadastros/locais/:id"]),
  S("C12", "Tipos de tributação", "/cadastros/tributacao", "fiscal", { menu: "Cadastros" }),
  S("C13", "Editor do tipo de tributação", ["/cadastros/tributacao/novo", "/cadastros/tributacao/:id"], "fiscal"),
  S("C14", "CFOP e NCM por produto", "/cadastros/tributacao/produtos", "fiscal"),
  S("C15", "Serviços", "/cadastros/servicos", "estoque", { menu: "Cadastros" }),
  // D. Compras e importação
  S("D01", "Pedidos de compra", "/compras/pedidos", "financeiro", { menu: "Compras e importação" }),
  S("D02", "Nova requisição ou pedido", "/compras/pedidos/novo", "financeiro"),
  S("D03", "Aprovações de compra", "/compras/aprovacoes", "financeiro", { menu: "Compras e importação" }),
  S("D04", "Detalhe do pedido", "/compras/pedidos/:id", "financeiro"),
  S("D05", "Processos de importação", "/importacoes", "financeiro", { menu: "Compras e importação" }),
  S("D06", "Novo processo de importação", "/importacoes/novo", "financeiro"),
  S("D07", "Detalhe da importação", "/importacoes/:id", "financeiro"),
  S("D08", "Custos e rateio", "/importacoes/:id/custos", "financeiro"),
  S("D09", "Documentos da importação", "/importacoes/:id/documentos", "financeiro"),
  // E. Entradas e conferência
  S("E01", "Entradas", "/estoque/entradas", "estoque", { menu: "Estoque" }),
  S("E02", "Nova entrada", "/estoque/entradas/nova"),
  S("E03", "Itens da nota", "/estoque/entradas/:id/itens"),
  S("E04", "Conferência por leitura", "/estoque/entradas/:id/conferencia"),
  S("E05", "Divergências", "/estoque/entradas/:id/divergencias"),
  S("E06", "Fechar conferência", "/estoque/entradas/:id/fechar"),
  S("E07", "Detalhe da entrada", "/estoque/entradas/:id"),
  S("E08", "Custo por lote e série", "/estoque/entradas/:id/custos", "financeiro"),
  // F. Código-mãe
  S("F01", "Códigos-mãe", "/codigos-mae", "estoque", { menu: "Estoque" }),
  S("F02", "Gerar código-mãe", "/codigos-mae/novo"),
  S("F03", "Prévia do código-mãe", "/codigos-mae/revisao"),
  S("F04", "Detalhe do código-mãe", "/codigos-mae/:id"),
  S("F05", "Leitor universal", "/leitura", "estoque", { menu: "Estoque" }),
  S("F06", "Etiquetas", "/estoque/etiquetas"),
  // G. Saídas
  S("G01", "Saídas", "/estoque/saidas", "estoque", { menu: "Estoque" }),
  S("G02", "Nova saída", "/estoque/saidas/nova"),
  S("G03", "Separação e leitura", "/estoque/saidas/:id/separar"),
  S("G04", "Revisão da saída", "/estoque/saidas/:id/revisar"),
  S("G05", "Detalhe da saída", "/estoque/saidas/:id"),
  S("G06", "Devoluções", "/estoque/devolucoes", "estoque", { menu: "Estoque" }),
  S("G07", "Nova devolução", "/estoque/devolucoes/nova"),
  S("G08", "Revisão da devolução", "/estoque/devolucoes/:id/revisar"),
  S("G09", "Triagem da devolução", "/estoque/devolucoes/:id"),
  S("G10", "Transferências", "/estoque/transferencias", "estoque", { menu: "Estoque" }),
  S("G11", "Nova transferência", "/estoque/transferencias/nova"),
  S("G12", "Revisão da transferência", "/estoque/transferencias/:id/revisar"),
  S("G13", "Em trânsito e recebimento", ["/estoque/transferencias/transito", "/estoque/transferencias/:id"]),
  S("G14", "Perdas e baixas", "/estoque/perdas", "estoque", { menu: "Estoque" }),
  // H. Posição
  S("H01", "Posição de estoque", "/estoque/posicao", "estoque", { menu: "Estoque" }),
  S("H02", "Detalhe do produto no estoque", "/estoque/produtos/:id"),
  S("H03", "Ficha do equipamento", "/estoque/equipamentos/:id"),
  S("H04", "Inventários", "/estoque/inventarios", "estoque", { menu: "Estoque" }),
  S("H05", "Contagem", "/estoque/inventarios/:id"),
  S("H06", "Aprovação de ajuste", "/estoque/inventarios/:id/revisao"),
  S("H07", "Relatórios de estoque", "/estoque/relatorios", "estoque", { menu: "Estoque" }),
  // I. Comercial
  S("I01", "Reservas do CRM", "/comercial/reservas", "operacoes", { menu: "Comercial" }),
  S("I02", "Reservar séries", "/comercial/reservas/:id", "operacoes"),
  S("I03", "Contratos e comodatos", "/comercial/contratos", "operacoes", { menu: "Comercial" }),
  S("I04", "Novo comodato", "/comercial/contratos/novo", "operacoes"),
  S("I05", "Detalhe do contrato", "/comercial/contratos/:id", "operacoes"),
  S("I06", "Retorno de comodato", "/comercial/contratos/:id/retorno", "operacoes"),
  S("I07", "Relatório de comodato", "/comercial/relatorios/comodato", "operacoes", { menu: "Comercial" }),
  // J. Operação
  S("J01", "Ordens de serviço", "/os", "operacoes", { menu: "Operação" }),
  S("J02", "Nova OS", "/os/nova", "operacoes"),
  S("J03", "Detalhe da OS", "/os/:id", "operacoes"),
  S("J04", "Materiais da OS", "/os/:id/materiais", "operacoes"),
  S("J05", "Registro de execução", "/os/:id/execucao", "operacoes"),
  S("J06", "Finalizar OS", "/os/:id/encerrar", "operacoes"),
  S("J07", "Comprovante da OS", "/os/:id/historico", "operacoes"),
  S("J08", "Assistência e garantia", "/assistencia", "operacoes", { menu: "Operação" }),
  S("J09", "Abrir chamado", "/assistencia/novo", "operacoes"),
  S("J10", "Triagem e diagnóstico", "/assistencia/:id", "operacoes"),
  S("J11", "Reparo ou RMA", "/assistencia/:id/reparo", "operacoes"),
  S("J12", "Substituição de equipamento", "/assistencia/:id/substituir", "operacoes"),
  S("J13", "Encerrar assistência", "/assistencia/:id/encerrar", "operacoes"),
  S("J14", "Montagem de kits", "/operacao/kits", "operacoes", { menu: "Operação" }),
  S("J15", "Nova ordem de montagem", "/operacao/kits/nova", "operacoes"),
  S("J16", "Montagem e configuração por unidade", "/operacao/kits/:id", "operacoes"),
  S("J17", "Chips", "/operacao/chips", "operacoes", { menu: "Operação" }),
  S("J18", "Ficha do chip", "/operacao/chips/:id", "operacoes"),
  S("J19", "Entrada de chips", "/operacao/chips/novo", "operacoes"),
  S("J20", "Plataformas e vínculos", "/operacao/plataformas", "operacoes", { menu: "Operação" }),
  S("J21", "Novo vínculo ou troca", "/operacao/plataformas/vinculo", "operacoes"),
  S("J22", "Ficha do veículo ou instalação", "/operacao/veiculos/:id", "operacoes"),
  S("J23", "Custos e margem da OS", "/os/:id/custos", "operacoes"),
  // K. Fiscal
  S("K01", "Notas fiscais", "/fiscal/notas", "fiscal", { menu: "Fiscal" }),
  S("K02", "Emitir nota", "/fiscal/notas/emitir", "fiscal"),
  S("K03", "Detalhe da nota", "/fiscal/notas/:id", "fiscal"),
  S("K04", "Cancelar ou corrigir nota", "/fiscal/notas/:id/evento", "fiscal"),
  S("K05", "Inutilização", "/fiscal/inutilizacao", "fiscal", { menu: "Fiscal" }),
  // L. Gestão
  S("L01", "Custo, depreciação e payback", "/gestao/custos", "financeiro", { menu: "Gestão" }),
  S("L02", "Detalhe de custo", "/gestao/custos/:id", "financeiro"),
  S("L03", "Margem por venda", "/gestao/margem", "financeiro", { menu: "Gestão", adminOnly: true }),
  // M. Integrações
  S("M01", "Painel de integrações", "/integracoes", "geral", { adminOnly: true, menu: "Integrações" }),
  S("M02", "Configurar integração", "/integracoes/:id", "geral", { adminOnly: true }),
  S("M03", "Fila de eventos", "/integracoes/fila", "geral", { adminOnly: true, menu: "Integrações" }),
  // N. Administração
  S("N01", "Usuários", "/admin/usuarios", "geral", { adminOnly: true, menu: "Administração" }),
  S("N02", "Criar ou editar usuário", ["/admin/usuarios/novo", "/admin/usuarios/:id"], "geral", { adminOnly: true }),
  S("N03", "Áreas e permissões", "/admin/areas", "geral", { adminOnly: true, menu: "Administração" }),
  S("N04", "Editar área", "/admin/areas/:id", "geral", { adminOnly: true }),
  S("N05", "Empresas", "/admin/empresas", "geral", { adminOnly: true, menu: "Administração" }),
  S("N06", "Editar empresa", "/admin/empresas/:id", "geral", { adminOnly: true }),
  S("N07", "Importar dados do H-Control", "/admin/importacao", "geral", { adminOnly: true, menu: "Administração" }),
  S("N08", "Conferir importação", "/admin/importacao/:id", "geral", { adminOnly: true }),
  S("N09", "Auditoria", "/admin/auditoria", "auditoria", { adminOnly: true, menu: "Administração" }),
  S("N10", "Exportações", "/admin/exportacoes", "auditoria", { adminOnly: true, menu: "Administração" }),
  S("N11", "Parâmetros", "/admin/parametros", "geral", { adminOnly: true, menu: "Administração" }),
];

export const MENU_ORDER = [
  "Início", "Cadastros", "Compras e importação", "Estoque", "Comercial", "Operação", "Fiscal", "Gestão", "Integrações", "Administração",
];

export const byCode = (code: string) => SCREENS.find((s) => s.code === code)!;
/** Primeiro caminho (sem parâmetros) da tela, já com o prefixo. Use com `to()` se tiver :id. */
