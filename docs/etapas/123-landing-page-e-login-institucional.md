# 123 — Landing Page Institucional e Login Split Vault

**Estado:** Implementado e Verificado · **Data:** 11/11/2026 · **Meta:** [Plano Mestre](../PLANO-MESTRE.md)

## Objetivo

Implementar a Landing Page de alta fidelidade institucional e a página de Login dedicada (Split Vault) para o **edocBR Plenário**, integrando:
1. Apresentação visual moderna e arquitetônica voltada a Presidentes de Câmara, Vereadores e Diretores Legislativos.
2. Apresentação dos 6 módulos e cockpit estático com dados fictícios, identificado como cenário ilustrativo.
3. Exposição da arquitetura LAN pretendida nos ADR-027 / ADR-030, com indicação de que votação offline oficial permanece bloqueada.
4. Consulta pública de publicações do Diário Eletrônico (`GET /api/v1/public/verify`), sem resultado pré-carregado. A verificação de atas usa outro fluxo.
5. Informação sobre privacidade, transparência e controles da plataforma, sem presumir conformidade institucional ou certificações não comprovadas.
6. Formulário de pedido de demonstração (`POST /api/v1/public/onboarding`) com geração de slug e escolha ativa do aviso de privacidade. O pedido fica pendente de análise humana; não provisiona tenant.
7. Página dedicada de Login institucional (`/login`) com arquitetura Split Vault (cofre escuro com hemiciclo geométrico à esquerda e console de autenticação à direita com suporte a TOTP MFA e seletor de perfis demo).
8. Rota pública `/apresentacao` e integração com a rota raiz `/` sem regressão de acessibilidade (WCAG 2.1 AA / Axe) ou quebra de testes de homologação/E2E.

## Componentes Desenvolvidos

- `src/modules/landing/landing-view.tsx`: Landing com cockpit fictício, 6 módulos, estado da arquitetura LAN, consulta pública, privacidade, pedido de demonstração e FAQ.
- `src/modules/landing/onboarding-form.tsx`: Formulário vazio por padrão, validação Zod, auto-slug, escolha ativa do aviso de privacidade e tratamento de rate limit (3 pedidos/hora por IP).
- `src/modules/landing/public-verifier.tsx`: Consulta de publicação do Diário Eletrônico, com estados de válida, revogada, não localizada e integridade não confirmada.
- `src/modules/landing/index.tsx`: Exportador do módulo de landing page.
- `src/components/app/institutional-login-dialog.tsx`: Modal institucional moderno de login com identidade Obsidian/Gold, e-docBR Plenário, MFA TOTP, perfis de demonstração e link para tela cheia (`/login`).
- `src/components/app/institutional-login.tsx`: Interface Split Vault com suporte a MFA de duas etapas, seletor de Câmara e perfis rápidos de demonstração.
- `src/app/apresentacao/page.tsx`: Rota dedicada da Landing Page sob Next.js App Router.
- `src/app/login/page.tsx`: Rota dedicada de login institucional com redirecionamento pós-autenticação.
- `src/app/page.tsx`: Landing Page exibida limpa e diretamente em `/` sem pop-up bloqueante; acionamento do login institucional sob demanda pelo botão *"Área Restrita"*.

## Pré-visualizações e Imagens Renderizadas

Protótipos HTML e capturas em alta resolução renderizados via Playwright salvos em `docs/previews/landing-edocbr/v2/`:
Estas imagens são históricas e podem conter textos anteriores à revisão de 11/11; o código e o teste de navegador são a referência atual.
- `01-pagina-hero-ecossistema.png`: Dark Architectural Hero & Cockpit Multi-Camada.
- `02-pagina-funcionalidades-modulos.png`: Bento Grid dos 6 Módulos do Plenário Digital.
- `03-pagina-arquitetura-lan-prontidao.png`: Diagrama de Resiliência LAN (ADR-027 / ADR-030).
- `04-pagina-portal-verificador.png`: Portal do Cidadão e Verificador Criptográfico.
- `05-pagina-governanca-lgpd.png`: Trust Center, LGPD & LAI.
- `06-pagina-onboarding-login.png`: Auto-Onboarding da Câmara e FAQ Executivo.
- `07-pagina-login-institucional.png`: Página de Login Split Vault (Cofre Institucional + Console).
- `08-pagina-mobile-studio.png`: Mobile Studio (Landing responsiva, Login mobile e PWA do Parlamentar).
- `09-visao-completa-desktop.png`: Visão de página contínua em 1440x7200px.

## Verificações

- `bun run typecheck` (`tsc --noEmit`): 0 erros.
- `bun run lint` (`eslint .`): 0 erros e 0 avisos.
- `bun run build`: Compilação de produção com Turbopack concluída com sucesso (rotas `○ /`, `○ /login`, `○ /apresentacao`).
- `bun run test:landing:browser` (`bash scripts/test-landing-browser.sh`):
  - Banco SQLite descartável isolado provisionado com seed.
  - Servidor standalone Next.js iniciado na porta 3228.
  - Landing em `/` sem modal inicial; abertura do modal sob demanda pelo botão *"Área Restrita"*.
  - Rota `/apresentacao` com FAQ, ausência de resultado fictício pré-carregado, resposta real `found=false` para código inexistente e pedido de demonstração confirmado por HTTP 201/status `pendente`.
  - Rota dedicada de Login `/login` validada com arquitetura Split Vault.
  - Auditoria de acessibilidade Axe-core (`WCAG 2.1 AA`) executada nas páginas: zero violações críticas ou sérias.
- A suíte da landing está incluída no job `application` da CI após o build e a instalação do Chromium.

## Limites

O cockpit é estático e demonstrativo. A operação local, a continuidade de votação sem internet, certificações, metas de disponibilidade e conformidade institucional exigem provas próprias descritas no plano mestre. O formulário registra pedido para revisão humana; não cria conta, tenant nem credenciais. A consulta pública desta página cobre publicações do Diário Eletrônico, não códigos de atas.

