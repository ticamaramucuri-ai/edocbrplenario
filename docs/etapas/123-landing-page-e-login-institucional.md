# 123 — Landing Page Institucional e Login Split Vault

**Estado:** Implementado e Verificado · **Data:** 11/11/2026 · **Meta:** [Plano Mestre](../PLANO-MESTRE.md)

## Objetivo

Implementar a Landing Page de alta fidelidade institucional e a página de Login dedicada (Split Vault) para o **edocBR Plenário**, integrando:
1. Apresentação visual moderna e arquitetônica voltada a Presidentes de Câmara, Vereadores e Diretores Legislativos.
2. Demonstração interativa dos 6 módulos e cockpit operacional em tempo real (PL 018/2026, 9 assentos em apuração instantânea e rastro ADR-027).
3. Diagrama e comparativo da arquitetura de resiliência LAN híbrida (ADR-027 / ADR-030: operação sem interrupção mesmo com queda de internet).
4. Verificador criptográfico em tempo real (`GET /api/v1/public/verify`) integrado no portal de transparência e fé pública.
5. Trust Center e conformidade explícita com a LGPD (Lei 13.709/2018) e a LAI (Lei 12.527/2011), sem cookies invasivos de rastreamento.
6. Formulário de Auto-Onboarding (`POST /api/v1/public/onboarding`) com geração automática de slug e consentimento LGPD.
7. Página dedicada de Login institucional (`/login`) com arquitetura Split Vault (cofre escuro com hemiciclo geométrico à esquerda e console de autenticação à direita com suporte a TOTP MFA e seletor de perfis demo).
8. Rota pública `/apresentacao` e integração com a rota raiz `/` sem regressão de acessibilidade (WCAG 2.1 AA / Axe) ou quebra de testes de homologação/E2E.

## Componentes Desenvolvidos

- `src/modules/landing/landing-view.tsx`: Visão completa da landing page com barra de telemetria, hero multi-camada com cockpit regimental ao vivo, bento grid dos 6 módulos, blueprint de rede LAN, verificador criptográfico, compliance LGPD, onboarding e FAQ executivo.
- `src/modules/landing/onboarding-form.tsx`: Formulário interativo de experimentação institucional com validação Zod, auto-slug, consentimento expresso LGPD e tratamento de rate limit (3 criações/hora por IP).
- `src/modules/landing/public-verifier.tsx`: Consulta em tempo real de integridade documental e autenticidade de atas.
- `src/modules/landing/index.tsx`: Exportador do módulo de landing page.
- `src/components/app/institutional-login-dialog.tsx`: Modal institucional moderno de login com identidade Obsidian/Gold, e-docBR Plenário, MFA TOTP, perfis de demonstração e link para tela cheia (`/login`).
- `src/components/app/institutional-login.tsx`: Interface Split Vault com suporte a MFA de duas etapas, seletor de Câmara e perfis rápidos de demonstração.
- `src/app/apresentacao/page.tsx`: Rota dedicada da Landing Page sob Next.js App Router.
- `src/app/login/page.tsx`: Rota dedicada de login institucional com redirecionamento pós-autenticação.
- `src/app/page.tsx`: Landing Page exibida limpa e diretamente em `/` sem pop-up bloqueante; acionamento do login institucional sob demanda pelo botão *"Área Restrita"*.

## Pré-visualizações e Imagens Renderizadas

Protótipos HTML e capturas em alta resolução renderizados via Playwright salvos em `docs/previews/landing-edocbr/v2/`:
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
  - Modal de login inicial no `/` validado com asserção `getByRole('dialog')` e dispensado interativamente para exploração da Landing Page.
  - Reabertura do modal via botão *"Área Restrita"* da Landing Page validada.
  - Rota dedicada `/apresentacao` com acordeão de FAQ, consulta no verificador criptográfico e submissão real de auto-onboarding com validação Zod e consentimento LGPD.
  - Rota dedicada de Login `/login` validada com arquitetura Split Vault.
  - Auditoria de acessibilidade Axe-core (`WCAG 2.1 AA` / `WCAG 2.2 AA`) executada em todas as páginas: zero violações críticas ou sérias.
- Compatibilidade retroativa 100% mantida com suítes de teste de homologação Playwright e Axe.

