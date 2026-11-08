// Percurso de ponta a ponta no navegador (Playwright). Uso: npm run dev (outra janela) e depois npm run e2e
import { chromium } from "playwright";

const BASE = process.env.E2E_URL ?? "http://localhost:5173";
const errors = [];
const log = (m) => console.log(m);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

async function expectText(text, ms = 5000) {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: ms });
}

// Login de administrador + verificação
await page.goto(`${BASE}/login`);
await page.getByLabel("E-mail").fill("admin@demo.local");
await page.getByLabel("Senha").fill("demo123");
await page.getByRole("button", { name: "Entrar", exact: true }).click();
await page.getByLabel(/Código de 6 dígitos/).fill("000000");
await page.getByRole("button", { name: "Confirmar" }).click();
await page.getByRole("button", { name: /Entrar em Traxor/ }).click();
await expectText("Painel inicial");
log("✔ login, verificação e escolha de empresa");

// Conferência: ler série, desfazer, fechar com preço
await page.goto(`${BASE}/app/estoque/entradas`);
await expectText("ENT-0004");
await page.getByText("ENT-0004").first().click();
await expectText("Conferência ENT-0004");
const campo = page.getByLabel("Campo de leitura");
await campo.fill("CAM0102");
await campo.press("Enter");
await expectText("2 de 3 lidas");
await campo.fill("CAM0102");
await campo.press("Enter");
await expectText("já foi lida");
await campo.fill("CAM0103");
await campo.press("Enter");
await expectText("3 de 3 lidas");
log("✔ conferência por leitura (duplicada recusada)");
await page.goto(`${BASE}/app/estoque/entradas`);
await page.getByText("ENT-0004").first().click();
await page.getByRole("link", { name: /Revisar divergências e seguir/ }).click();
await page.getByRole("link", { name: /Seguir para os custos/ }).click();
await page.getByRole("link", { name: /Seguir para fechar/ }).click();
await page.getByRole("button", { name: "Confirmar fechamento" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Confirmar fechamento" }).click();
await expectText("Entrada ENT-0004");
log("✔ custo por série e fechamento da conferência (E04→E05→E08→E06→E07)");

// Venda manual até a nota simulada
await page.goto(`${BASE}/app/estoque/saidas/nova`);
await page.getByLabel("Cliente").selectOption({ label: "Transportes Exemplo Ltda" });
await page.getByRole("button", { name: "Continuar" }).click();
await page.getByLabel("Campo de leitura").fill("CAM0005");
await page.getByLabel("Valor unitário").fill("300");
await page.getByRole("button", { name: "Adicionar" }).click();
await expectText("CAM0005");
await page.getByRole("button", { name: "Revisar" }).click();
await page.getByRole("button", { name: "Seguir para a nota" }).click();
await expectText("SIMULADA, sem valor fiscal");
await page.getByRole("button", { name: "Transmitir" }).first().click();
await page.getByRole("dialog").getByRole("button", { name: "Transmitir" }).click();
await expectText("SIMULADA, SEM VALOR FISCAL");
log("✔ venda manual: separação → revisão → nota simulada autorizada");

// Percorre todas as telas que não precisam de parâmetro, coletando erros de console
const paths = [
  "", "/busca?q=CAM", "/pendencias", "/pendencias/decisoes", "/cadastros/produtos", "/cadastros/produtos/novo", "/cadastros/produtos/importar", "/cadastros/clientes", "/cadastros/clientes/novo",
  "/cadastros/fornecedores", "/cadastros/fornecedores/novo", "/cadastros/locais", "/cadastros/locais/novo", "/cadastros/tributacao", "/cadastros/tributacao/novo", "/cadastros/tributacao/produtos", "/cadastros/servicos",
  "/compras/pedidos", "/compras/pedidos/novo", "/compras/aprovacoes", "/importacoes", "/importacoes/novo", "/estoque/entradas/nova", "/codigos-mae", "/codigos-mae/novo", "/leitura", "/estoque/etiquetas",
  "/estoque/saidas", "/estoque/devolucoes", "/estoque/devolucoes/nova", "/estoque/transferencias", "/estoque/transferencias/nova", "/estoque/transferencias/transito", "/estoque/perdas",
  "/estoque/posicao", "/estoque/inventarios", "/estoque/relatorios", "/comercial/reservas", "/comercial/contratos", "/comercial/contratos/novo", "/comercial/relatorios/comodato",
  "/os", "/os/nova", "/assistencia", "/assistencia/novo", "/operacao/kits", "/operacao/kits/nova", "/operacao/chips", "/operacao/chips/novo", "/operacao/plataformas", "/operacao/plataformas/vinculo",
  "/fiscal/notas", "/fiscal/notas/emitir", "/fiscal/inutilizacao", "/gestao/custos", "/gestao/margem", "/integracoes", "/integracoes/fila", "/integracoes/crm",
  "/admin/configuracao-inicial", "/admin/usuarios", "/admin/usuarios/novo", "/admin/areas", "/admin/empresas", "/admin/importacao", "/admin/auditoria", "/admin/exportacoes", "/admin/parametros", "/perfil", "/empresa", "/boas-vindas", "/sem-acesso",
];
for (const p of paths) {
  const before = errors.length;
  await page.goto(`${BASE}/app${p}`);
  await page.locator("main, h1").first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(80);
  const text = await page.locator("body").innerText();
  if (/Não foi possível abrir esta tela/.test(text)) errors.push(`tela quebrada: ${p}`);
  if (errors.length > before) log(`✖ ${p}`);
}
log(`✔ ${paths.length} telas abertas no navegador`);

await browser.close();
if (errors.length) {
  console.error("\nErros encontrados:\n" + [...new Set(errors)].join("\n"));
  process.exit(1);
}
log("\nE2E ok, sem erros de console.");
