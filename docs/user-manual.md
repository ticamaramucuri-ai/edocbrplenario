# Manual do Usuário — Legis SaaS

> **Manual de demonstração histórico.** Nome, contas e exemplos abaixo pertencem ao laboratório antigo e não são instrução para Mucuri. O [plano mestre](PLANO-MESTRE.md) exige revisão por papel antes do piloto e inclui o servidor desktop local ainda não implementado.

Guia de uso da suíte legislativa para Câmaras Municipais. Organizado por perfil de acesso;
cada seção cobre os módulos que o perfil utiliza. Todos os exemplos ususam os dados de
demonstração da **Câmara Municipal de Vila Nova/MG** (fictícios).

> **Como trocar de perfil (demonstração):** clique no nome do usuário no canto superior
> direito e escolha um perfil. As permissões são verificadas **no servidor** (RBAC) — o
> seletor apenas simula quem está autenticado (ADR-005).

---

## Índice

1. [Visão geral do produto](#1-visão-geral-do-produto)
2. [Perfil: Operador de Sessão](#2-perfil-operador-de-sessão)
3. [Perfil: Presidência (Mesa Diretora)](#3-perfil-presidência-mesa-diretora)
4. [Perfil: Administração Legislativa](#4-perfil-administração-legislativa)
5. [Perfil: Administrador da Câmara](#5-perfil-administrador-da-câmara)
6. [Perfil: Parlamentar (App do Parlamentar)](#6-perfil-parlamentar-app-do-parlamentar)
7. [Perfil: Auditor](#7-perfil-auditor)
8. [Perfil: Operação da Plataforma (SaaS)](#8-perfil-operação-da-plataforma-saas)
9. [Onda 4 (Fases 17–20): desfechos, recibos, cidadão e suporte](#9-onda-4-fases-1720-desfechos-recibos-cidadão-e-suporte)
10. [Planejamento e Roadmap (v0.12.0)](#10-planejamento-e-roadmap-v0120)
11. [Integrações & API e Crescimento (v0.13.0)](#11-integrações--api-e-crescimento-v0130)
12. [Fluxo completo de uma sessão (roteiro)](#12-fluxo-completo-de-uma-sessão-roteiro)
13. [Perguntas frequentes](#13-perguntas-frequentes)

---

## 1. Visão geral do produto

O Legis SaaS é uma plataforma multiempresa (uma instância atende várias Câmaras) com
white-label por tenant. O menu lateral organiza os **26 módulos** em grupos:

| Grupo | Módulos |
|---|---|
| **Operação** | Painel · Agenda Legislativa · Sessões · Mesa do Plenário · Telão · App do Parlamentar |
| **Processo Legislativo** | Protocolo e Tramitação |
| **Cadastros** | Parlamentares · Matérias · Estrutura Institucional |
| **Governança** | Auditoria · Relatórios · Publicações e Audiências · Analytics · Portal Público · Webhooks · Integrações & API |
| **Administração** | Usuários · Modelos de Documento · Configurações · Console da Plataforma (com Faturamento e Sistema) · Migração de Dados · Suporte da Plataforma · Planejamento e Roadmap · Crescimento |
| **Ajuda** | Central de Ajuda |

### Como entrar (autenticação)

Na primeira visita o sistema abre o **gate de entrada** com duas opções:

1. **E-mail e senha** (autenticação real — sessão de 7 dias em cookie httpOnly). Contas
de demonstração do seed: `ana.ribeiro@vilanova.mg.leg.br`,
`carla.mendes@vilanova.mg.leg.br`, `marta.lima@serraazul.sp.leg.br` (admin do tenant 2),
`suporte@legissaas.dev` (dono da plataforma) e `joao.prado@legissaas.dev`
(**Suporte da Plataforma** — perfil novo da Onda 4) — senha `DemoLegis!2026`.
2. **Perfis de demonstração** (um clique, sem senha — mesma RBAC e mesma auditoria).

O botão **Sair** (topbar) encerra a sessão autenticada e volta ao gate. Perfis sem senha
cadastrada (ex.: Marcos Vieira) só entram pela lista de demonstração ou depois de receberem
senha pelo módulo Usuários.

Elementos transversais:

- **Sino de notificações** (topbar): pendências e eventos do seu papel (sessão agendada,
  votação encerrada, prazo vencido, webhook em dead-letter). Clique no item para navegar
  ao módulo; "Marcar todas como lidas" limpa o contador.
- **Status de conexão** (rodapé da sidebar): `Conectado`, `Reconectando…` ou `Offline` —
  o tempo real (presença, votação, telão) depende dele.
- **Confirmações reforçadas**: ações irreversíveis (encerrar sessão, anular votação,
  homologar migração) exigem confirmação explícita, algumas com justificativa obrigatória.
- **Badges sempre com texto**: situações (Aprovado, Vencida, Em trial…) nunca são
  comunicadas apenas por cor — acessibilidade e leitura à distância.

### Pesquisa global (⌘K)

O botão **Pesquisar** na topbar (ou o atalho **⌘K / Ctrl+K**) abre a paleta de comandos:

1. **Navegação** — os 26 módulos agrupados como na sidebar; digite para filtrar e `Enter`
   para ir (setas navegam, `Esc` fecha).
2. **Resultados** — a partir de 2 caracteres, a pesquisa unificada busca **matérias,
   sessões, parlamentares e publicações** (top-5 por seção, com dica de identificação) e
   `Enter` navega direto ao registro no módulo correspondente. Termo numérico também casa
   número/ano ("43" acha o PL 43/2026).

Disponível para todos os perfis; os resultados respeitam o tenant do usuário
(escopo verificado no servidor).

### Central de Ajuda (`Ajuda → Central de Ajuda`)

Documentação viva dentro do produto, para todos os perfis, em 6 abas:

1. **Primeiros passos** — guia do SEU perfil (5–6 passos numerados com os módulos de que
   você precisa); o seletor permite ver o roteiro de outro papel, e os chips de módulo
   são clicáveis (levam direto ao módulo).
2. **Glossário** — 26 termos legislativos (quórum, autoria, suplência…) agrupados por
   inicial.
3. **Perguntas frequentes** — 26 respostas práticas (voto secreto, recibos, sanção/veto,
   moderação, dunning, exportação/encerramento, assinaturas do cidadão, roadmap, MFA,
   chaves de API, assinatura de atas, trial…).
4. **Atalhos** — tabela de atalhos de teclado (incl. ⌘K).
5. **Novidades** — timeline das versões 0.1.0 → 0.13.0.
6. **Sobre** — resumo da arquitetura e índice dos documentos do produto.

A busca no topo filtra guias, glossário e FAQ de uma vez — e ignora acentos
("quorum" acha "Quórum"). O conteúdo acompanha o release: é versionado junto com o
código (ADR-016).

---

## 2. Perfil: Operador de Sessão

Quem conduz a sessão no dia a dia. É o perfil-padrão da demonstração (**Marcos Vieira**).

### Mesa do Plenário (`Operação → Mesa do Plenário`)

O coração do sistema em tempo real. Selecione a sessão no topo e conduza por abas:

1. **Presença** — grade com os 13 vereadores (foto/iniciais, partido, situação). Botões:
   `Check-in`, `Saída temporária`, `Retorno`, e marcações (licenciado, afastado, ausente).
   O alerta de quórum fica visível (ex.: "7/13 — mínimo regimental atingido"). O
   check-in em lote registra todos os presentes em sequência.
2. **Pauta** — seções Expediente / Ordem do Dia / Comunicações. Mova itens para cima/baixo,
   marque `Em leitura`, `Em discussão`, `Em votação`, ou retire/adiante com justificativa.
   O botão **Nova votação** abre o diálogo com modo (nominal/simbólico/secreto), regra de
   maioria e opção de ocultar parciais.
3. **Votação** — painel da votação ativa: contadores grandes (Sim/Não/Abstenções), grade
   por parlamentar (cada voto aparece no momento do registro), controles
   `Abrir/Pausar/Retomar/Fechar/Anular`. Votação secreta mostra participação sem valor.
   Ao fechar, o resultado é calculado de forma determinística e a matéria é atualizada.
4. **Discursos** — fila de oradores com cronômetro server-side: `Iniciar`, `Pausar`,
   `+1 min`, `Encerrar`. O cronômetro aparece no telão automaticamente.
5. **Telão** — comandos de vídeo: congelar, limpar e trocar de perfil manualmente.

**Atalho de teclado:** a mesa opera bem apenas com teclado; as confirmações críticas
aceitam `Enter`/`Esc`.

### Sessões (`Operação → Sessões`)

- Crie a próxima sessão (`Nova sessão`): tipo, data/hora, presidente, secretário e as
  matérias da Ordem do Dia. O sistema salva um **rascunho** com pauta preliminar.
  Confira os itens e use **Agendar e publicar pauta** para disponibilizá-la ao público.
  O administrador da Câmara define em **Configurações → Preparação de sessões** os tipos
  habilitados, se o nome do secretário é obrigatório e o número mínimo de matérias.
  O sistema verifica essas regras antes da publicação e guarda a política aplicada.
  A Câmara também define a **antecedência mínima da convocação** em horas. Na publicação, o sistema emite um comprovante com a pauta, os dados da sessão e um SHA-256. O portal oferece o documento público para consulta e conferência.
- Se precisar corrigir tipo, data, presidente, secretário, local ou observações, abra as ações da sessão em rascunho e escolha **Editar rascunho**. Depois confira a pauta e publique. Alterações simultâneas exigem recarregar a sessão.
- Depois de publicada e antes de abrir o credenciamento, use **Emendar pauta publicada** na sessão ou na mesa: escolha incluir, reordenar ou retirar matéria, informe o motivo, confira a comparação antes/depois e confirme. Uma nova revisão será publicada no portal com data e justificativa. O mínimo de matérias definido pela Câmara continua obrigatório.
- Acompanhe o histórico com filtros e expanda a pauta de cada sessão.
- Transições de estado seguem o regimento: `Agendar → Abrir check-in → Abrir sessão →
  Suspender/Retomar → Encerrar` (cada uma com pré-condição e auditoria).

### Agenda Legislativa (`Operação → Agenda Legislativa`)

O calendário único da Casa — sessões, audiências públicas, reuniões de comissão e prazos
em uma grade mensal (visível a todos os perfis):

- **Chips por tipo** com ícone + cor + texto (Sessão, Audiência, Reunião, Prazo); os
  filtros no topo mostram a contagem do mês e podem esconder um tipo.
- Clique no dia para abrir o **painel lateral**: eventos com horário, situação e detalhe
  (local, comissão, responsável) e o botão **"Ir para…"** — navega ao módulo dono do
  evento (prazo → Protocolo e Tramitação, sessão → Sessões…).
- Navegação **anterior/próximo/Hoje** entre os meses; a seção **Próximos eventos** lista
  o que vem nos próximos 7 dias (inclusive no mês seguinte).
- Prazos aparecem APENAS enquanto pendentes; audiências e reuniões canceladas saem da
  agenda automaticamente.

### Painel (`Operação → Painel`)

Visão do dia: próximas sessões, pendências operacionais, atividade recente e os cartões de
pendências do processo legislativo (prazos vencidos, protocolos a distribuir).

---

## 3. Perfil: Presidência (Mesa Diretora)

**Roberto Nogueira** — ações exclusivas da presidência sobre a mesma Mesa do Plenário:

- Abrir/encerrar votações e sessões (permissão `voting.write`/`session.transition`);
- Votar em nome de parlamentar ausente quando o regimento permitir (`Votar como…`);
- Assinar (eletronicamente) o espelho da sessão ao final — relatório com código de
  verificação da cadeia de auditoria (`Relatórios → Espelho da Sessão`).

---

## 4. Perfil: Administração Legislativa

**Paula Andrade** — dona do processo legislativo e dos cadastros técnicos.

### Protocolo e Tramitação (`Processo Legislativo`)

- **Protocolo**: livro de entrada com numeração automática por ano (sem buracos).
  Registre matérias, documentos e ofícios; distribua, arquive ou anule (justificativa
  obrigatória, auditada).
- **Em Tramitação**: matérias em situação não-terminal com a timeline de andamentos.
  Clique na linha para abrir o dossiê (drawer) com tramitação, versões e anexos.
  `Registrar andamento` valida a transição de situação (despacho → parecer → inclusão em
  pauta → aprovação/rejeição…); situações terminais exigem anulação formal.
- **Prazos e Tarefas**: pendências com destaque para vencidas ("Vencida" em vermelho com
  ícone); crie tarefas para comissões e conclua/cancele conforme o fluxo.

### Estrutura Institucional (`Cadastros → Estrutura Institucional`)

- **Legislaturas**: cadastro e marcação da atual (afeta defaults de mandatos).
- **Partidos e Blocos**: partidos com sigla/nome/número e emblema opcional; uma troca de emblema atualiza todos os parlamentares do mesmo partido nesta Câmara. Blocos têm partidos componentes.
- **Mesa Diretora**: composição vigente e histórico com início/fim. Ao designar, escolha
  **Cargo em exercício** ou **Eleição para posse futura**. Na eleição, informe a data
  prevista, o fim do período se conhecido e a referência do ato. A pessoa eleita fica
  como **posse pendente**; a passagem da data não a coloca em exercício. Depois da
  posse, use **Confirmar posse**, confira o dia efetivo e informe a referência da ata.
  Se a eleição perder efeito, use **Cancelar eleição** com a referência do ato. O
  histórico permanece. A transferência e o encerramento se aplicam aos cargos vigentes.
- **Comissões**: comissões permanentes/temporárias com composição (presidente, relator,
  titulares) e reuniões (agendar, realizar, cancelar).
- **Mandatos e Afastamentos**: mandatos por legislatura (votos, período) e afastamentos
  (licença, afastamento, suplência) com suplente e encerramento.

### Matérias (`Cadastros → Matérias`)

Filtros com debounce, criação com autores múltiplos, exportação CSV. Abra o dossiê de
qualquer matéria para timeline de tramitação, versões do texto e anexos — e use a
**assistência de IA** ("Sugerir ementa", "Resumir tramitação"): a sugestão é um rascunho
com origem/modelo/horário; aplicar é sempre decisão manual.

### IA nos Relatórios

Na aba `Minuta de Ata`, além da minuta estruturada (100% dados persistidos), o botão
**"Gerar minuta com assistência de IA"** produz rascunho revisável — `Aprovar` (vira
rascunho aprovado, registrado quem aprovou) ou `Rejeitar` (justificativa obrigatória).
A IA nunca publica nada sozinha (ADR-006).

### Publicações e Audiências (`Governança → Publicações e Audiências`)

O diário eletrônico oficial e a participação popular em três abas:

1. **Publicações** — livro numerado por ano (`0001/2026`). `Nova publicação` cria um
   rascunho (tipo: ata de sessão, decreto, resolução, portaria, edital ou ata; vínculo
   opcional com sessão/matéria; texto em Markdown). Com **"Criar a partir de modelo"** o
   corpo vem de um modelo ativo do tipo escolhido, renderizado no servidor com o contexto
   dos vínculos (nome da Câmara, cidade/UF, data, nº da sessão, ementa da matéria…);
   placeholders que não puderam ser resolvidos são avisados antes de salvar — a origem
   fica registrada na auditoria. `Publicar` torna oficial (gera código
   de verificação exibido no portal); `Revogar` exige motivo e **não apaga** — o portal
   mantém o ato com selo "Revogada" (histórico íntegro).
2. **Audiências** — agende (título, assunto, matéria, data/hora, local), `Abrir` no dia
   (badge AO VIVO no portal), `Encerrar` (fecha perguntas) ou `Cancelar` com justificativa.
   O interruptor "perguntas abertas" controla a janela de recebimento.
3. **Moderação** — fila de perguntas do cidadão (a aba mostra o contador de pendentes).
   `Aprovar` publica no portal; `Rejeitar` mantém interna; `Responder` registra a resposta
   oficial com data. O e-mail do autor é visível aqui (uso interno) e **jamais** no portal.

> Roteiro de demonstração: Portal Público → Audiências → envie uma pergunta como cidadão
> → volte em Moderação e aprove → a pergunta aparece no portal em segundos.

### Analytics (`Governança → Analytics`)

Indicadores de produtividade do ano (seletor no topo): presença média e ranking por
parlamentar (mesma regra do plenário), sessões por mês, matérias por situação/tipo/autores,
taxa de aprovação em votações, tempo médio de tramitação e **coesão por partido**
(calculada apenas em votações nominais — votações secretas nunca entram). `Exportar CSV`
baixa o ranking de presenças. Rota 100% somente-leitura (ADR-013).

---

## 5. Perfil: Administrador da Câmara

**Ana Ribeiro** — governança, integrações e configuração.

### Usuários (`Administração → Usuários`)

Gestão de acessos com senha (Fase 9):

1. `Novo usuário` — nome, e-mail (único), senha inicial, papel e cargo; papel
   **parlamentar** exige o vínculo com o vereador (lista do próprio tenant).
2. Ações por linha: `Editar`, `Redefinir senha` (encerra TODAS as sessões do usuário — ele
   refaz o login) e `Ativar/Desativar` (desativado perde o acesso imediatamente).
3. **Não existe exclusão** — desative; o histórico de auditoria é imutável.

Dica: o operador Marcos Vieira não tem senha no seed — use `Redefinir senha` para dar
acesso real a ele e entra com e-mail/senha no gate.

### Modelos de Documento (`Administração → Modelos de Documento`)

Padronize atas, decretos, resoluções, portarias, editais e ofícios (escrita para
Administrador da Câmara e Administração Legislativa — `template.write`; leitura para
todos):

1. `Novo modelo` — nome, tipo, descrição e corpo em **Markdown** com placeholders. O
   painel lateral lista os **12 tokens** (`{{camara}}`, `{{cidade}}`, `{{uf}}`, `{{data}}`,
   `{{hora}}`, `{{ano}}`, `{{sessao.numero}}`, `{{sessao.data}}`, `{{sessao.tipo}}`,
   `{{materia.titulo}}`, `{{materia.ementa}}`, `{{materia.autores}}`) — clique para
   inserir na posição do cursor.
2. **Editor/Preview** — alterne entre o Markdown e o resultado renderizado.
3. **Histórico em timeline** — cada salvamento de corpo cria uma versão NOVA (nunca
   sobrescreve); `Restaurar` copia uma versão antiga como versão nova. Autor e nota de
   mudança ficam registrados em cada versão.
4. **Desativar** tira o modelo das novas publicações sem apagar nada (publicações já
   emitidas continuam lastreadas) — exige confirmação.

> O seed traz 5 modelos prontos de Vila Nova (Ata — com 2 versões, Decreto, Edital,
> Portaria e Ofício) para experimentar na hora.

### Webhooks (`Governança → Webhooks`)

Integração com sistemas externos (diário oficial, portal próprio, ERP):

1. `Novo webhook` → URL de destino + seleção de eventos (sessões, votações, tramitação…).
2. O **segredo** é gerado na criação — copie e guarde; a assinatura HMAC-SHA256 vai em
   `x-legis-signature` (exemplo de verificação no contrato da API).
3. **Entregas** mostra cada tentativa (status, código HTTP, erro); entregas em
   **dead-letter** após 5 tentativas disparam notificação. `Testar` envia um `test.ping`
   imediato; `Reprocessar` recria qualquer entrega (auditado).

> Demonstração local: aponte o webhook para o próprio eco
> `http://localhost:3000/api/v1/webhooks/echo` (devolve 200) — sem depender de internet.

### Notificações (broadcast)

O sino lista notificações automáticas; o administrador também pode enviar um aviso
manual a um papel específico (`Notificações → Nova`, via API).

### Configurações (`Administração → Configurações`)

- **Identidade e white-label**: nome, cidade/UF, cores (com pré-visualização) — aplica ao
  portal e telões.
- **Regras regimentais**: quórum mínimo, permissão de alterar voto, tempo padrão de
  discurso, alertas sonoros, ocultar parciais por padrão, e **auto check-in pelo app**
  (`allowSelfCheckIn`).
- **Plano do tenant**: exibe o plano contratado e os recursos habilitados (entitlements).

### Migração de Dados (`Administração → Migração de Dados`)

Pipeline auditado do sistema antigo (PainelDeskLegis 8.1) — guia completo em
`docs/migration-importer.md`. Roteiro resumido:

1. `Inspecionar` → 2. `Validar` (órfãos/avisos) → 3. `Planejar` → 4. `Simular` →
2. `Importar` (retomável, idempotente) → 6. `Reconciliar` (divergências = 0) →
3. `Relatório` → **Homologar** (digite HOMOLOGAR; irreversível) ou `Rollback` (remove só
   os dados da execução).

---

## 6. Perfil: Parlamentar (App do Parlamentar)

**Carla Mendes** — o app mobile-first do vereador (`Operação → App do Parlamentar`):

- **Sessão atual**: situação, quórum ao vivo e meu status de presença. O botão
  `Registrar minha presença` habilita quando o credenciamento próprio é permitido e a
  sessão está em check-in/aberta — caso contrário, explica o motivo.
- **Votação aberta**: pergunta e três botões grandes (Sim/Não/Abstenção) com confirmação.
  Após votar: "Voto registrado" + opção de alterar enquanto a política permitir (gera novo
  comando idempotente). Em votação secreta, apenas a participação é exibida — nunca o valor.
- **Fila de oradores**: minha posição e `Pedir a palavra` (tipo + assunto).
- **Meu histórico**: presenças e votos por sessão.
- Tudo em tempo real: quórum, abertura de votação e atualizações chegam via WebSocket
  (o mesmo motor do plenário).

---

## 7. Perfil: Auditor

**Helena Costa** — leitura completa com garantia de integridade:

- **Auditoria** (`Governança → Auditoria`): trilha append-only de TODA ação relevante
  (quem, quando, o que mudou, justificativa). O botão **Verificar cadeia** recalcula os
  hashes encadeados e confirma "Cadeia válida" — qualquer adulteração de registro histórico
  é detectada (ADR-004). Exporte JSON para o processo externo.
- **Relatórios**: espelho de sessão com valor probatório (presença consolidada, votações
  nominais, discursos, código de verificação) e minuta de ata.
- O auditor **não** executa ações de escrita — o sistema nega no servidor (403), não
  apenas esconde botões.

---

## 8. Perfil: Operação da Plataforma (SaaS)

**Suporte Legis SaaS** — o operador multiempresa:

- **Console da Plataforma**: KPIs globais (Câmaras ativas, sessões do mês, votos,
  dead-letters), tabela de tenants com uso agregado, health score (Saudável/Atenção/
  Crítico com composição), assinatura por tenant e onboarding completo de novas Câmaras
  (cria tenant + legislatura + administrador + trial de 14 dias).
- **Planos e entitlements**: starter (sem IA), profissional (com `ai_assist`) e
  enterprise; criar/ajustar planos define o que cada Câmara pode usar — rotas de IA são
  bloqueadas com 402 `PLAN_LIMIT` fora do plano.
- Migração também disponível (mesma permissão do administrador do tenant).
- Isolamento garantido: o console vê **métricas agregadas**, nunca conteúdo legislativo
  de outra Câmara.

### Aba Faturamento (ciclo comercial — Fase 10)

- **KPIs**: MRR (soma das mensalidades ativas), faturas em aberto, **vencidas** e pagas
  no ano (tudo em R$ com Intl).
- `Executar ciclo do mês` — gera a fatura corrente para cada tenant ativo com assinatura
  (mensalidade + excedentes de parlamentares/sessões) e aplica o **dunning**: fatura
  vencida → assinatura `past_due` + notificação ao administrador da Câmara + webhook
  `billing.invoice_overdue`. Idempotente: reexecutar não duplica.
- Ações por fatura (somente em aberta): `Registrar pagamento` (método Pix/boleto/cartão/
  transferência — assinatura `past_due` volta a `active`) e `Cancelar` (justificativa
  obrigatória, auditada). Clique na linha para ver as **linhas da fatura**.
- **Uso por tenant**: consumo do mês vs. limites do plano (parlamentares ativos, sessões,
  artefatos de IA, entregas de webhook) com excedentes destacados.

> Roteiro de demonstração: a fatura `0002` da Câmara de Serra Azul está **vencida** no
> seed — execute o ciclo, veja a assinatura ir a `past_due`, registre o pagamento
> (Pix) e veja a reativação.

### Aba Sistema — saúde, exportação e encerramento (Fase 16)

A 3ª aba do Console resume a operação do SaaS e conclui o ciclo de vida do tenant:

1. **Alertas** — banners no topo (ícone + texto + ação sugerida): serviço parado
   (crítico, com a ação do runbook), entregas de webhook em dead-letter ou backlog do
   outbox (atenção), tenants inadimplentes (informativo, com a ação do ciclo de
   cobrança). "Nenhum alerta" quando tudo está bem.
2. **Cards de verificação** — por mini-serviço (Tempo real e Entregas: Operacional com a
   latência, ou Parado — o check degrada em 2s, o painel nunca quebra), Banco (tamanho do
   `.db` e do WAL), Filas (outbox pendente + idade do mais antigo; webhooks pendentes e
   mortos), Atividade (câmaras ativas/total, sessões hoje, último evento auditado) e
   Runtime (uptime, memória). Atualização automática a cada 30s + botão
   **"Verificar novamente"**.
3. **Ações por tenant** (na Visão Geral, coluna Ações):
   - **Exportar dados** — baixa um JSON INTEGRAL da Câmara (24 entidades com contagens;
   sem senhas/segredos; votos de votação secreta sem o valor) para portabilidade/backup
   de saída; a exportação fica registrada na auditoria.
   - **Encerrar** — o fim formal do contrato: exige justificativa (mín. 10 caracteres) e
   digitar exatamente `ENCERRAR`. Em uma transação o tenant é desativado, TODAS as
   sessões de login dos usuários são revogadas e a assinatura vai a `cancelada` —
   **nenhum dado é apagado** (retenção LGPD + cadeia de auditoria). Reversível apenas
   pela reativação auditada no console.

---

## 9. Onda 4 (Fases 17–20): desfechos, recibos, cidadão e suporte

A v0.11.0 fecha o ciclo legislativo pós-aprovação, dá ao voto uma prova individual
verificável, abre o canal de acompanhamento do cidadão e formaliza a operação de suporte.
Os fluxos abaixo complementam os perfis das seções anteriores.

### Registrar sanção/veto e vincular emendas (Administração Legislativa)

No dossiê da matéria (`Cadastros → Matérias`, drawer) há duas seções novas:

- **Relacionamentos** — vínculos com tipo (`altera`, `revoga`, `regula`, `subsidiária`,
  `emenda`, `substitutivo`), direção (seta “vinculada a / vinculada por”), notas e
  desvincular com confirmação. **Vincular matéria** abre um diálogo com o pool de
  matérias da Casa (filtrável, a própria matéria excluída); o par é único em qualquer
  direção — duplicar devolve erro de campo. Exemplo do seed: a emenda **EM 12/2026**
  vinculada ao **PL 44/2026** aparece no dossiê de ambos.
- **Desfecho (sanção/veto)** — timeline dos fatos pós-aprovação com autor, data e prazo
  de apreciação (badge âmbar). **Registrar desfecho** exige matéria aprovada: sanção
  (integral ou promulgação da parte não vetada após veto parcial) ou veto total/parcial
  com **justificativa obrigatória** e prazo regimental default de **+15 dias às 19h**.
  O veto cria automaticamente a tarefa “Apreciar veto…” (Prazos e Tarefas + Agenda) e a
  situação da matéria passa a **Sancionada/Vetada** — nunca por edição direta.

> Roteiro de demonstração: abra o **PL 49/2026** (vetado — prazo de apreciação visível) e
> o **PL 41/2026** (sancionado); o portal público mostra o desfecho da matéria ao cidadão.

### Votação com opções regimentais e conferência de recibos (Operador de Sessão / Presidência)

No diálogo **Nova votação**, a seção “Opções de resposta” permite trocar Sim/Não/Abstenção
por até **5 opções customizadas** (ex.: “Aprovar e encaminhar”, “Arquivar”, “Adiar para a
próxima sessão”) — a chave (slug) é gerada automaticamente e editável; duplicidade e
excesso são validados. Na votação em curso, a grade de lançamento e o resultado parcial
exibem os **rótulos**; o telão mostra chips por opção e a contagem por rótulo no resultado.
Votos com chave inexistente são recusados (422). O encerramento apura a opção mais votada
pela regra regimental (maioria simples/absoluta/unanimidade, empate, sem quórum) e o item
 da pauta recebe a frase-resumo com as contagens por rótulo.

Após fechar uma votação **nominal**, o painel **“Recibos verificáveis”** (aba Votação da
Mesa) mostra o selo verde “Verificação OK — N recibos conferidos”, o código de cada
parlamentar e o botão **Reverificar**: o servidor RECOMPUTA o HMAC de cada voto e compara
com o recibo persistido — qualquer divergência fica visível (não silenciosa). Em votação
secreta o recibo comprova participação, sem valor.

### Recibos no PWA do parlamentar

No App do Parlamentar, a aba **Recibos** do histórico lista cada voto nominal encerrado
com pergunta, data e **código do recibo** (fonte mono) para conferência com a Mesa e com
a auditoria. Ao votar, o app avisa “recibo pendente” — o recibo só existe após o
encerramento (o voto pode mudar até lá).

### Assinaturas do cidadão e verificação de autenticidade (Portal)

O Portal Público ganhou a aba **Acompanhar**: o cidadão informa e-mail e a matéria,
sessão ou audiência que quer seguir → a assinatura nasce **pendente** (dupla confirmação —
LGPD/anti-spam) e passa a valer após confirmar pelo link enviado ao e-mail. O formulário
explica o fluxo e o sistema limita envios por IP (429 com aviso de espera). No detalhe de
qualquer publicação, o botão **“Verificar autenticidade”** consulta o código impresso e
exibe o selo correspondente: **Válida** (verde, com título/Câmara/data), **Revogada**
(âmbar, com data de revogação) ou **não encontrada**. Atas continuam verificáveis no
módulo Relatórios, pela cadeia de auditoria.

### Gestão de assinaturas e revogação (Administração da Câmara)

`Governança → Publicações e Audiências → aba Assinaturas` (permissão
`subscription.manage`): cartões de estatísticas (total/confirmadas/pendentes), tabela com
e-mail, alvo, situação e datas; para pendências, **“Copiar link de confirmação”** (no
sandbox não há SMTP — a Casa cola o link para o cidadão demonstrar o double opt-in) e
**Revogar** com confirmação (grava revogação e audita; nunca apaga o registro). A tabela
de publicações exibe o código de verificação com copiar e dica do fluxo público.

### Operação de suporte com impersonação (Suporte da Plataforma)

O perfil **João Prado** (`joao.prado@legissaas.dev` / `DemoLegis!2026`) abre o módulo
**Suporte da Plataforma**: saúde resumida dos serviços, alertas ativos e a ação
**“Operar como usuário”** — escolha o usuário, descreva o motivo (mín. 10 caracteres,
fica na auditoria) e o prazo (5–60 min). Requer **login por senha** (o seletor de perfis
demo não impersona). Durante a operação, um **banner âmbar fixo no topo** mostra
“(Suporte) operando como {nome} … termina em X min” com **Encerrar agora** — visível em
TODOS os módulos, e todas as ações são registradas na auditoria da Casa-alvo
(`support.impersonation_started/_ended`). A impersonação **nunca** assume papéis da
plataforma (escalada bloqueada), encerra sozinha ao vencer o prazo e o histórico fica
na tabela com badge Ativa/Encerrada.

### Exportação assíncrona e alertas persistentes (Operador da Plataforma)

- **Exportar dados** (Console → Visão Geral) agora cria um **job com progresso real**
  (0 → 100%) — “Gerando 85%” até “Concluído 100%” — e habilita **Baixar exportação**;
  um job por vez por tenant; o arquivo é regenerado no momento do download (snapshot
  consistente, sem segredos, voto secreto sem valor).
- **Alertas persistentes** (Console → Sistema): seção “Alertas persistentes” com estado
  Aberto/Reconhecido, quem reconheceu e quando; **Reconhecer** é exclusivo do dono da
  plataforma (o suporte vê, o dono reconhece) e fica auditado. Os alertas derivados de
  tempo real continuam como reforço.

---

## 10. Planejamento e Roadmap (v0.12.0)

A v0.12.0 fez o plano de continuidade do produto virar produto: o módulo
**Planejamento e Roadmap** (`Administração → Planejamento e Roadmap`, visível para
todos os papéis) expõe dentro do próprio sistema o que já foi entregue, o que está
planejado e com que progresso. É a extensão da "documentação viva" da Central de
Ajuda (ADR-016) ao planejamento — o ROADMAP do produto consultável no app.

O que aparece lá: na aba **Visão geral**, o panorama do produto (estatísticas — 26
módulos, ~92 grupos de rotas, 25 ADRs — e o estado entregue das Ondas 1–5 com as
versões reais); na aba **Onda 5 — Fases ✓**, as fases F21–F24 com objetivo, período e
**progresso real por task** (34 tasks persistidas no banco, cada uma com título e
detalhe, em accordion por fase) — **entregue na v0.13.0, 100% (34/34 concluídas)**;
na aba **Menus e páginas**, o **mapa-alvo TO-BE v5** (26 módulos marcados como
existente, estendido ou novo); na aba **Documentação**, o **pacote documental**
(16 entregues · 0 planejados — os ADRs da Onda 6, 026–029, entram quando a onda for
planejada em detalhe); e na aba **Onda 6**, as Fases 25–28 de longo prazo
(produção real, identidade federada e cripto, multi-idioma/AA e ecossistema amplo —
**planejada: v0.14.0**, detalhada no ROADMAP §14).

### Como usar por papel

1. **Qualquer papel autenticado LÊ** (`GET /api/v1/roadmap`): operador, presidência,
   administração, parlamentar, auditor, suporte e dono da plataforma — inclusive o
   `platform_owner`, que não tem escopo de tenant (mesmo padrão da Central de Ajuda).
   Abra o módulo e navegue pelas abas **Visão geral**, **Onda 5 — Fases ✓**, **Menus e
   páginas**, **Documentação** e **Onda 6**.
2. **Apenas o dono da plataforma atualiza o progresso** (RBAC `platform.manage`,
   verificada no servidor): na aba de fases, o `platform_owner` usa o **seletor de
status de cada task** (Pendente · Em andamento · Concluído · Bloqueado) — a alteração
é persistida na hora e registrada **na própria linha da task**: status, autor
(`updatedByName`) e horário (`updatedAt`), padrão dos artefatos de plataforma (fora
da cadeia de auditoria de tenant, como o `SystemStatus`).
3. **Os demais papéis veem o status como badge** (somente leitura) — tentar alterar
   por API devolve 403 `FORBIDDEN_ROLE` (comportamento esperado).

### O que o progresso significa

O painel mostra `done/total` por fase e a barra de progresso correspondente. As 34
tasks da Onda 5 espelham o ROADMAP §12: **Fase 21 — Prontidão para produção**
(agendador porta 3005, watchdog, ciclos, CI) · **Fase 22 — Confiança de acesso**
(MFA TOTP, sessões ativas, assinatura eletrônica de atas) · **Fase 23 —
Ecossistema** (chaves de API, rotas externas, playground) · **Fase 24 — Crescimento
do SaaS** (self-onboarding, trial, health, NPS). Na v0.13.0 a Onda 5 está **entregue
(34/34 concluídas)** e a versão-alvo passou a **v0.14.0 — Onda 6 — Fases 25–28
(planejada, ROADMAP §14)**: as tasks da Onda 6 passam a ser rastreadas no mesmo
módulo quando a onda começar. O re-seed da base demo devolve o roadmap ao estado
entregue da v0.13.0 (fases entregues e tasks concluídas — ver runbook §3).

> Roteiro de demonstração: entre como qualquer perfil → abra **Planejamento e
> Roadmap** → veja a Visão geral (26 módulos/~92 rotas/25 ADRs), a aba **Onda 5 —
> Fases ✓** com 100% (34/34) e o mapa TO-BE v5 → a aba **Onda 6** mostra o que vem
> pela frente (v0.14.0 planejada). O seletor de status das tasks seguiu exclusivo do
> dono da plataforma (`platform.manage`) — na base atual todas estão concluídas.

---

## 11. Integrações & API e Crescimento (v0.13.0)

A Onda 5 (Fases 21–24) fecha o ciclo com dois módulos novos e um conjunto de
capacidades transversais: chaves de API para integrações, MFA/sessões,
assinatura eletrônica de atas, agendador/watchdog e o painel de crescimento do
SaaS. Os fluxos abaixo complementam os perfis das seções anteriores.

### Emitir e revogar chaves de API (`legk_`) — Administrador da Câmara

Em `Governança → Integrações & API`, aba **Chaves de API** (permissão
`apikey.manage` — no seed apenas a Ana e a Marta, cada uma vendo SOMENTE as
chaves da própria Casa):

1. **Nova chave** — nome descritivo (um por integração, ex.: "Painel da
   Transparência") e escopos de LEITURA por checkbox (`matters.read`,
   `sessions.read`, `publications.read`, `calendar.read`).
2. A chave completa (`legk_…` + 24 caracteres) é exibida **UMA ÚNICA VEZ** com
   botão de copiar e aviso — o servidor persiste apenas o prefixo e o hash
   SHA-256. **Perdeu a chave? Não há recuperação: revogue e emita outra.**
3. **Revogar** é imediato, auditado e append-only (a linha permanece para o
   histórico); revogação repetida é inofensiva (idempotente). Cada chave mostra
   `lastUsedAt` — consultas das integrações atualizam o campo.

### Playground e documentação do desenvolvedor

Na aba **Playground**, selecione uma chave ATIVA e um endpoint — as opções sem
escopo correspondente aparecem desabilitadas ("sem escopo") — e execute: a
consulta REAL roda no servidor por **delegação assinada de 30 segundos**
(`deleg_…`, HMAC) com status HTTP, latência e JSON de resposta; a chave pura
nunca vai ao navegador. Acima de 60 requisições/minuto por chave a integração
recebe 429 com `Retry-After` (cada execução do playground conta no limite). A
aba **Documentação** traz a referência dos 4 endpoints (`/api/v1/external/
{matters,sessions,publications,calendar}`), o envelope de resposta, os erros
Problem Details e os limites — o mesmo guia está na Central de Ajuda.

### MFA e sessões ativas (`Usuários → Meu acesso`) — qualquer usuário

O card **Meu acesso** reúne a segurança da própria conta:

- **MFA TOTP**: "Configurar MFA" gera o segredo + URL `otpauth:` (escaneie em
  qualquer autenticador — Google Authenticator, 1Password…); confirme o código
  de 6 dígitos para ativar ("MFA ativo"). Desabilitar exige **senha + código**
  (o segredo é removido do banco).
- **Login em dois passos**: com MFA ativo, o formulário de entrada pede o
  código TOTP após a senha (401 `MFA_REQUIRED` internamente — nenhuma sessão é
  criada sem o segundo fator).
- **Sessões ativas**: lista com navegador, IP, data de criação, **último uso**
  e qual é a atual; "Revogar" encerra aquela sessão na hora (revogar a atual
  equivale a sair).

### Assinatura eletrônica da ata (Relatórios · PWA · Portal)

Após **publicar a ata** de uma sessão encerrada no diário eletrônico, a
assinatura eletrônica entra em cena em três frentes:

1. **Painel Assinaturas** (`Governança → Relatórios → Minuta de Ata → aba
   Assinaturas`): "N/M assinadas — Cadeia verificada ✓", os parlamentares
   presentes (elegíveis) com quem já assinou (horário e código) e os pendentes.
   A cadeia é verificada por RECOMPUTAÇÃO a cada leitura.
2. **App do Parlamentar** (card **Assinar ata**): o vereador que teve presença
   na sessão assina com um toque — "Ata assinada eletronicamente — Código
   XXXXXXXXXXXXXXXX". Repetir o toque é inofensivo (idempotente, devolve a
   MESMA assinatura).
3. **Portal Público** (detalhe da sessão): bloco "ATA PUBLICADA — CADEIA
   VERIFICADA" com as assinaturas (nome, horário, código) e o formulário de
   **verificação pública por código** — qualquer pessoa confere uma assinatura
   sem logar ("Assinatura autêntica — {nome} — {ata} · assinada em {data}").

A assinatura atesta a PRESENÇA na sessão (o voto secreto permanece sigiloso) e
a cadeia (`prevHash` encadeado + HMAC por Casa) detecta qualquer adulteração
posterior do conteúdo — ata editada depois de assinada torna a verificação
inválida.

### Agendamentos e watchdog da plataforma (Console/Suporte)

- `Console da Plataforma → Sistema → Agendamentos`: os 4 jobs do
  mini-serviço **scheduler :3005** (varredura de alertas · watchdog de
  exportações · health check · snapshot de saúde dos tenants) com próxima
  execução, último resultado (status + nota real) e interruptor
  pausar/retomar; **Rodar agora** executa na hora SEM adiantar a agenda.
- `Suporte da Plataforma → Watchdog de exportações`: jobs órfãos detectados
  (running > 10 min) com **Reprocessar** — o job volta a `pending`, roda de
  novo em background e o alerta é reconhecido automaticamente.

### Crescimento (métricas, saúde, onboarding e NPS) — dono da plataforma

O módulo `Administração → Crescimento` (exclusivo do `platform_owner`;
tenant_admin vê estado "Acesso restrito à operação da plataforma") reúne:

- **Métricas de negócio**: tenants ativos, MRR simulado (só assinaturas ativas
  — trials não contam), churn 90d, trials ativos e **NPS médio da versão**
  (0.13.0) com o número de respostas.
- **Saúde por tenant (anti-churn)**: health score canônico (fórmula exibida:
  sessões · matérias · logins · webhooks) com bucket Saudável/Atenção/Risco,
  tendência vs. última captura e botão **Capturar snapshot** (registro forçado
  para o histórico — as capturas diárias são do scheduler).
- **Fila de onboarding (self-onboarding)**: pedidos públicos de novas Câmaras
  com **Ativar** (cria o tenant em trial de 14 dias com senha temporária do
  administrador exibida UMA vez) e **Rejeitar** (nota de feedback obrigatória).
- **Widget NPS** na Central de Ajuda: cada usuário avalia a versão atual
  (0–10 + comentário) e pode editar a própria resposta — a consolidação só
  aparece agregada no Crescimento.

### Banner de trial (topbar)

Tenants em trial veem a faixa fina no topo: **"Trial termina em N dias — falar
com a plataforma"** (âmbar) enquanto o prazo corre. Vencido, a faixa fica
vermelha — **"Trial expirado — leitura liberada, gravação bloqueada"**: consultar
tudo continua funcionando; salvar/editar devolve 403 `TRIAL_EXPIRED` até a
conversão em assinatura. O banner some para papéis da plataforma e tenants sem
trial.

---

## 12. Fluxo completo de uma sessão (roteiro)

1. **(Adm. Legislativa)** Criar sessão, montar e publicar a pauta → portal exibe.
2. **(Adm. Legislativa)** Registrar tramitações e prazos; protocolar expediente do dia.
3. **(Operador)** Na hora: `Abrir check-in` → parlamentares fazem check-in pelo app; o
   operador completa marcações e confere o quórum (alerta verde/âmbar).
4. **(Operador/Presidência)** `Abrir sessão` → telão entra em "AO VIVO".
5. **Pauta em ação**: Expediente → Ordem do Dia. Para cada matéria: `Em leitura` →
   `Em discussão` (discursos com cronômetro) → `Nova votação` (com opções regimentais
   quando o regimento pedir) → abrir → votos chegam em tempo real (app + mesa) → fechar
   → **resultado determinístico** com tabela nominal e recibos verificáveis (exceto
   secreta) → matéria atualizada → portal e dados abertos refletem.
6. **Pós-aprovação**: sanção ou veto registrado no dossiê da matéria (seção Desfecho) →
   veto agenda a tarefa "Apreciar veto" com prazo regimental → portal público expõe o
   desfecho ao cidadão.
7. **Encerrar** a sessão → espelho e minuta de ata disponíveis; publicada a ata no
   diário eletrônico, os presentes assinam **eletronicamente** (card do PWA) e o
   portal exibe a cadeia verificada; auditoria completa com cadeia verificável;
   webhooks notificam integrações.

## 13. Perguntas frequentes

**O voto pode ser alterado?** Enquanto a votação estiver aberta e `allowVoteChange`
estiver ativo nas Configurações — sim (app e mesa geram novo comando idempotente). Após o
fechamento, apenas anulação formal auditada.

**E se a internet cair durante a votação?** Nenhum voto confirmado é perdido: cada voto é
persistido transacionalmente com idempotência por `commandId` (reenvio não duplica). O
telão se reconstrói por snapshot ao reconectar.

**Como exporto dados para o portal de transparência?** `Portal Público → Dados Abertos`
(JSON/CSV) ou a API pública `/api/v1/public/open-data` — sempre somente dados publicáveis.

**Quem vê voto secreto?** Ninguém vê o valor — nem operador, nem presidência, nem auditor.
A participação (quem votou) é pública após o encerramento; o valor, jamais.

**Posso desfazer uma migração?** Sim, com `Rollback` — até a homologação. Depois dela,
os dados são oficiais e o rollback é bloqueado por design.

**Como entro com e-mail e senha?** No gate de entrada, primeiro campo. As contas do seed
usam a senha `DemoLegis!2026`. Um usuário sem senha (ex.: Marcos Vieira) recebe uma pelo
módulo Usuários (`Redefinir senha`).

**A pergunta do cidadão aparece imediatamente no portal?** Não — nasce "pendente" e só
fica pública após aprovação na Moderação. Rejeitada permanece interna (uso exclusivo da
Casa). O e-mail do cidadão nunca é exibido no portal.

**A coesão partidária revela votos secretos?** Não — o cálculo usa exclusivamente
votações nominais encerradas; votações secretas não entram em nenhuma agregação (ADR-013).

**Como vejo tudo o que acontece no mês?** `Operação → Agenda Legislativa`: a grade mensal
reúne sessões, audiências, reuniões de comissão e prazos (pendentes) com filtros por tipo,
painel do dia e "Ir para…"; a seção "Próximos eventos" mostra os próximos 7 dias.

**Como padronizo as atas com modelo?** `Administração → Modelos de Documento`: crie o
modelo (ex.: Ata de sessão) com placeholders como `{{sessao.numero}}` e `{{data}}`; na
criação da publicação use **"Criar a partir de modelo"** — o corpo já vem renderizado com
os dados dos vínculos escolhidos. Cada ajuste no corpo do modelo cria uma versão nova
(o histórico nunca é sobrescrito).

**O que o botão Encerrar faz com os dados?** Nada é apagado — o tenant é desativado
(usuários passam a receber 403), todas as sessões de login são revogadas e a assinatura é
cancelada, tudo auditado com a justificativa. Os dados permanecem para retenção (LGPD) e
podem ser exportados antes (ou depois) via **Exportar dados**; a reativação é possível e
auditada.

**Como pesquiso rápido em qualquer lugar?** `⌘K` (ou Ctrl+K / botão "Pesquisar" na
topbar): digite 2+ caracteres para buscar matérias, sessões, parlamentares e publicações
e Enter vai direto ao resultado — ou navegue pelos 26 módulos sem sair da paleta.

**Como provar que um voto não foi adulterado?** Cada voto nominal encerrado gera um
**recibo verificável** (código derivado de HMAC-SHA256 por Casa). O parlamentar confere o
código na aba Recibos do app; a Mesa (ou a auditoria) roda a **reconta** no painel
"Recibos verificáveis" ou em `GET /api/v1/votings/:id/receipts`: o servidor recomputa o
código de cada voto e compara com o persistido — 0 divergências = selo verde; qualquer
adulteração gera divergência visível. Em votação secreta o recibo prova participação,
sem valor. Somado à cadeia de auditoria (ADR-004), o voto tem prova individual e agregada.

**O que acontece quando o prefeito veta um projeto?** A Administração Legislativa
registra o desfecho **veto total/parcial** no dossiê da matéria (justificativa
obrigatória): a situação passa a **Vetada**, o veto entra na tramitação como andamento e o
sistema cria automaticamente a tarefa **“Apreciar veto”** com prazo regimental (default
15 dias) visível em Prazos/Tarefas e na Agenda. Se o veto é parcial, a sanção posterior da
parte não vetada pode ser registrada como novo desfecho (situação Sancionada), preservando
o histórico. O cidadão vê o desfecho no portal público.

**Como um cidadão acompanha uma matéria?** No Portal Público, aba **Acompanhar**: informa
e-mail e a matéria/sessão/audiência → recebe um link de confirmação (dupla confirmação) →
após confirmar, passa a receber as novidades do acompanhamento. A Casa gerencia as
assinaturas em Publicações → Assinaturas (estatísticas, link de confirmação para
pendências e revogação). Envios e verificações têm limite por IP para evitar abuso.

**O suporte consegue acessar a Câmara sem que ninguém saiba?** Não. A impersonação exige
login por senha, **motivo com no mínimo 10 caracteres** e prazo máximo de 60 minutos;
enquanto ativa, um **banner âmbar fixo** "(Suporte) operando como {nome}" aparece em
todos os módulos com contagem regressiva, o início e o fim ficam registrados **na
auditoria da própria Câmara** e o suporte nunca assume papéis da plataforma. Ao vencer o
prazo a operação encerra sozinha.

**Como acompanho o que vem a seguir no produto?** Abra `Administração → Planejamento e
Roadmap`: a aba **Onda 5 — Fases ✓** mostra as Fases 21–24 **entregues na v0.13.0**
(100% · 34/34 tasks concluídas); a aba **Menus e páginas** mostra o mapa-alvo TO-BE v5
com 26 módulos (todos entregues); a aba **Documentação** lista o pacote documental
(16 entregues · 0 planejados) e a aba **Onda 6** as Fases 25–28 — **planejadas para a
v0.14.0** e detalhadas no ROADMAP §14. Qualquer perfil autenticado pode consultar.

**Quem pode marcar tasks como concluídas?** Apenas o **dono da plataforma**
(`platform_owner`) — a escrita exige a permissão `platform.manage`, verificada no
servidor; qualquer outro papel recebe 403 (todos os demais têm leitura). A mudança fica
registrada na própria linha da task (quem alterou e quando). Na v0.13.0 a Onda 5 está
**entregue (34/34 concluídas)** e a Onda 6 (Fases 25–28) é a próxima onda **planejada**
(ROADMAP §14, v0.14.0) — ainda sem tasks rastreadas no módulo.

**Perdi minha chave `legk_`, e agora?** Não há como recuperá-la — por design, o
servidor guarda apenas o prefixo (`legk_…`) e o hash SHA-256 da chave. Revogue a chave
perdida em `Governança → Integrações & API` (revogação imediata e auditada) e emita
uma nova com os mesmos escopos para a integração. Nunca houve como "reler" a chave:
isso protege a Casa caso o segredo vaze.

**Como ativo o MFA?** No módulo Usuários, card **Meu acesso** → "Configurar MFA":
copie o segredo (ou escaneie a URL `otpauth:` no seu autenticador — Google
Authenticator, 1Password, Authy…) e confirme o código de 6 dígitos. A partir daí o
login por senha pede o código (dois passos) e o card mostra "MFA ativo". Para
desligar, é preciso a senha da conta E um código válido — e o segredo sai do banco.
Usuários sem senha (perfis demo) devem primeiro receber senha (`Redefinir senha`).

**Como assino a ata pelo app?** Após a sessão ser encerrada e a ata publicada no
diário eletrônico, o card **Assinar ata** aparece no App do Parlamentar para quem
teve presença registrada — um toque gera o código da assinatura eletrônica
("Ata assinada eletronicamente — Código …"). Tocar de novo não duplica (a operação é
idempotente). A Mesa acompanha o N/M no painel **Assinaturas** (Relatórios → Minuta
de Ata) e o cidadão confere no Portal Público por código.

**O que significa o banner de trial no topo?** A Câmara está no período de avaliação
(14 dias após o onboarding): a faixa âmbar mostra "Trial termina em N dias — falar com
a plataforma". Vencido, a faixa fica vermelha ("Trial expirado — leitura liberada,
gravação bloqueada"): consultas seguem normais, mas salvar/editar devolve 403
`TRIAL_EXPIRED` até a conversão em assinatura — nada é perdido nem apagado.

**Como verifico uma assinatura da ata publicamente?** No Portal Público, detalhe da
sessão → bloco da ata publicada → informe o código de 16 caracteres da assinatura no
formulário de verificação: o sistema responde "Assinatura autêntica" com signatário,
ata e horário — ou "não encontrada/não autêntica". A verificação recomputa o hash
com o conteúdo ATUAL da ata: qualquer edição posterior à assinatura invalida o
resultado. É pública (sem login) e limitada a 30 consultas/minuto por IP.

**Onde vejo a documentação completa do sistema?** Em três camadas: a **Central de
Ajuda** (`Ajuda → Central de Ajuda`, aba Sobre com o índice dos documentos), o módulo
**Planejamento e Roadmap** (aba Documentação — pacote entregue e planejado) e os
arquivos em `docs/` do repositório (ROADMAP, contrato da API, manual, runbook,
changelog, relatório de testes e ADRs 001–025 entregues / 026–029 planejados — Onda 6).
