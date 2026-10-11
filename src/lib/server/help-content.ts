/**
 * Fase 15 — Conteúdo da Central de Ajuda e Documentação In-App (ADR-016).
 *
 * Fonte única versionada com o código (ROADMAP §10.3: nenhum modelo de dados).
 * `buildHelpContent()` é chamado por GET /api/v1/help para QUALQUER papel
 * autenticado (inclusive platform_owner, que não tem escopo de tenant).
 *
 * O conteúdo reflete o sistema REAL (módulos, permissões e fluxos entregues:
 * Ondas 1–5 entregues — Fases 0–24, v0.13.0 — · Onda 6 planejada no ROADMAP
 * §14) e NUNCA contém credenciais ou dados sensíveis — apenas orientação;
 * o RBAC real é sempre verificado no servidor.
 */
import type {
  ChangelogEntry,
  FaqItem,
  GlossaryTerm,
  HelpContent,
  HelpGuide,
  Role,
  ShortcutItem,
} from '@/lib/contracts'

// ─── Guias por papel (primeiros passos) ─────────────────────────────────────

const GUIDES: HelpGuide[] = [
  {
    role: 'tenant_admin',
    title: 'Administrador da Câmara — governança, acessos e integrações',
    description:
      'Você responde pela identidade da Casa, pelos acessos reais dos usuários e pelas integrações externas. Permissões-chave: user.manage, publication.write, hearing.write e webhook.manage.',
    steps: [
      {
        title: 'Configure a identidade e o regimento',
        body: 'Em Administração → Configurações, ajuste o white-label (nome, cidade/UF, cores com pré-visualização — aplica ao portal e aos telões) e as regras regimentais: quórum mínimo, permissão de alterar voto, tempo padrão de discurso, alertas sonoros, ocultar parciais e o auto check-in pelo app (allowSelfCheckIn). A aba Plano mostra os recursos habilitados pelo contrato.',
      },
      {
        title: 'Provisione acessos reais',
        body: 'Em Administração → Usuários, crie contas com e-mail (único), senha inicial, papel e cargo; papel parlamentar exige vínculo com um vereador da Casa. Use Redefinir senha (revoga TODAS as sessões do usuário) e Ativar/Desativar. Não existe exclusão — o histórico de auditoria é imutável.',
      },
      {
        title: 'Assine webhooks para as integrações',
        body: 'Em Governança → Webhooks, cadastre a URL de destino e os eventos (sessões, votações, tramitação…). O segredo é gerado na criação — copie e guarde. Cada entrega chega assinada (HMAC-SHA256 em x-legis-signature); após 5 tentativas a entrega vai a dead-letter e dispara notificação. Testar envia um test.ping imediato e Reprocessar recria entregas (auditado).',
      },
      {
        title: 'Integrações & API — emita chaves para o painel da transparência e teste no playground',
        body: 'Em Governança → Integrações & API, emita chaves de API (legk_…) com escopos de leitura por integração — a chave completa é exibida UMA única vez e o servidor guarda só o prefixo e o hash. No Playground, selecione a chave e o endpoint e execute a consulta real no servidor (delegação assinada — a chave nunca vai ao navegador) com status, latência e JSON de resposta; na aba Documentação fica a referência completa para os desenvolvedores (envelope, Problem Details, limite de 60 req/min por chave). Revogação é imediata e append-only.',
      },
      {
        title: 'Publique no diário eletrônico',
        body: 'Em Governança → Publicações e Audiências, crie publicações (ata, decreto, resolução, portaria, edital) com vínculo opcional a sessão/matéria — ou a partir de um modelo versionado (Fase 14). Publicar gera numeração por ano e código de verificação exibido no portal; Revogar exige motivo e nunca apaga: o portal mantém o ato com selo "Revogada".',
      },
      {
        title: 'Gerencie o acompanhamento do cidadão',
        body: 'Na aba Assinaturas de Publicações e Audiências, veja quem acompanha matérias, sessões e audiências (dupla confirmação por e-mail): copie o link de confirmação das pendências (no sandbox não há envio de e-mail) e revogue quando necessário — cada revogação é auditada e o registro nunca é apagado (LGPD). No portal, o botão Verificar autenticidade permite a qualquer pessoa conferir uma publicação pelo código impresso.',
      },
      {
        title: 'Acompanhe a saúde legislativa da Casa',
        body: 'Governança → Analytics traz presença média, ranking por parlamentar, matérias por situação/tipo, tempo médio de tramitação e coesão partidária (somente votações nominais). O Portal Público → Dados Abertos expõe os datasets em JSON/CSV para a transparência — sempre somente dados publicáveis.',
      },
      {
        title: 'Acompanhe o roadmap do produto',
        body: 'Em Administração → Planejamento e Roadmap, qualquer papel autenticado consulta o que já foi entregue (Ondas 1–5 — v0.13.0, com a Onda 5 fechada em 34/34 tasks), o mapa-alvo de 26 módulos, o pacote documental e a Onda 6 planejada (ROADMAP §14 — v0.14.0) — transparência total sobre para onde o produto vai.',
      },
      {
        title: 'Traga os dados do sistema antigo',
        body: 'Em Administração → Migração de Dados, rode o pipeline auditado de 8 estágios (Inspecionar → Validar → Planejar → Simular → Importar → Reconciliar → Relatório → Homologar). A homologação é irreversível (digitação "HOMOLOGAR"); o rollback remove apenas os dados da execução. Guia completo em docs/migration-importer.md.',
      },
      {
        title: 'Proteja sua conta: MFA, sessões e assinatura da ata',
        body: 'No módulo Usuários, card "Meu acesso" (v0.13.0): ative o MFA TOTP (segredo + URL otpauth escaneável no autenticador; login passa a exigir o código de 6 dígitos em dois passos) e revise as sessões ativas com último uso e revogação individual. Como administrador, acompanhe também a assinatura eletrônica da ata publicada no painel Assinaturas (Relatórios → Minuta de Ata) e o banner de trial do topo: enquanto resta tempo, a faixa âmbar avisa os dias; vencida, a leitura continua liberada e as escritas devolvem 403 TRIAL_EXPIRED até a conversão.',
      },
    ],
    modules: ['dashboard', 'users', 'webhooks', 'integrations', 'publications', 'analytics', 'portal', 'settings', 'migration', 'roadmap'],
  },
  {
    role: 'legislative_admin',
    title: 'Administração Legislativa — o dono do processo',
    description:
      'Você conduz o processo legislativo de ponta a ponta: protocolo, tramitação, cadastros técnicos e a montagem das sessões. Permissões-chave: protocol.write, structure.write, task.write e session.create.',
    steps: [
      {
        title: 'Protocolize o expediente',
        body: 'Em Processo Legislativo → Protocolo e Tramitação, aba Protocolo, registre matérias, documentos e ofícios com numeração automática por ano (sem buracos). Distribua, arquive ou anule com justificativa obrigatória — tudo auditado.',
      },
      {
        title: 'Conduza a tramitação',
        body: 'Na aba Em Tramitação, clique na matéria para abrir o dossiê (timeline de andamentos, versões do texto e anexos). Registrar andamento valida a transição de situação (despacho → parecer → inclusão em pauta → aprovação/rejeição); a situação SÓ muda via andamento e estados terminais exigem anulação formal. Na aba Prazos e Tarefas, crie e conclua pendências para comissões.',
      },
      {
        title: 'Feche o ciclo pós-aprovação (sanção, veto e emendas)',
        body: 'No dossiê da matéria, a seção Desfecho registra sanção e veto (justificativa obrigatória no veto): a situação vai a Sancionada/Vetada SOMENTE por desfecho, o veto agenda automaticamente a tarefa Apreciar veto com prazo regimental (+15 dias) e a seção Relacionamentos vincula emendas e substitutivos à matéria principal (o par é único em qualquer direção). O portal público passa a exibir o desfecho.',
      },
      {
        title: 'Mantenha os cadastros institucionais',
        body: 'Em Cadastros → Estrutura Institucional: legislaturas (marque a atual), partidos e blocos, Mesa Diretora com vigência (designar/transferir/encerrar — nunca sobrescreve o passado), comissões com composição e reuniões, mandatos e afastamentos com suplência.',
      },
      {
        title: 'Monte a sessão e publique a pauta',
        body: 'Em Operação → Sessões, use Nova sessão: tipo, data/hora, presidente, secretário e as matérias da Ordem do Dia — a pauta é montada e publicada (o portal atualiza na hora). Consulte a Agenda Legislativa para o calendário unificado de sessões, audiências, reuniões de comissão e prazos.',
      },
      {
        title: 'Use a IA assistiva com revisão humana',
        body: 'No dossiê da matéria (Cadastros → Matérias), Sugerir ementa e Resumir tramitação geram rascunhos com origem/modelo/horário; em Governança → Relatórios → Minuta de Ata, a minuta com assistência de IA precisa ser aprovada ou rejeitada com justificativa. A IA nunca publica nem transiciona nada sozinha (ADR-006).',
      },
      {
        title: 'Padronize os documentos da Casa',
        body: 'Em Administração → Modelos de Documento, crie modelos com variáveis ({{sessao.numero}}, {{materia.ementa}}…). Cada edição gera uma NOVA versão publicada — versões antigas continuam renderizáveis. Em Publicações, "criar a partir de modelo" renderiza no servidor e lista as variáveis não resolvidas.',
      },
      {
        title: 'Publique a ata e acompanhe a assinatura eletrônica',
        body: 'Após encerrar a sessão, publique a ata no diário eletrônico (Publicações → Nova publicação, tipo ata vinculada à sessão). Em Governança → Relatórios → Minuta de Ata, a aba Assinaturas (v0.13.0) mostra "N/M assinadas — Cadeia verificada ✓": os parlamentares presentes assinam pelo app (card Assinar ata) e o Portal Público exibe a ata com a cadeia de assinaturas e a verificação pública por código — a assinatura atesta presença, o voto secreto permanece sigiloso (ADR-023).',
      },
      {
        title: 'Saiba o que vem a seguir',
        body: 'O módulo Administração → Planejamento e Roadmap mostra o plano do produto para leitura: estado entregue (Ondas 1–5, v0.13.0 — inclusive MFA, assinatura eletrônica de atas e chaves de API da Onda 5), mapa-alvo de 26 módulos e a Onda 6 planejada (ROADMAP §14: export-worker/backup/FTS, identidade federada e cripto, multi-idioma/AA e ecossistema amplo).',
      },
    ],
    modules: ['workflow', 'structure', 'sessions', 'agenda', 'matters', 'reports', 'templates', 'publications', 'roadmap'],
  },
  {
    role: 'session_operator',
    title: 'Operador de Sessão — conduza o plenário',
    description:
      'Você opera a sessão no dia a dia: credenciamento, pauta, votação, discursos e telão. Permissões-chave: session.transition, attendance.write, voting.write e speech.write.',
    steps: [
      {
        title: 'Prepare o dia',
        body: 'Em Operação → Painel, confira próximas sessões, pendências operacionais e os cartões do processo legislativo (prazos vencidos, protocolos a distribuir). Em Sessões, as transições seguem o regimento: Agendar → Abrir check-in → Abrir sessão → Suspender/Retomar → Encerrar, cada uma com pré-condição e auditoria.',
      },
      {
        title: 'Credencie os parlamentares',
        body: 'Na Mesa do Plenário (Operação → Mesa do Plenário), aba Presença: check-in individual ou em lote, saída temporária, retorno e marcações (licenciado, afastado, ausente). O alerta de quórum mostra o total em tempo real (ex.: "7/13 — mínimo regimental atingido") e alimenta o App do Parlamentar.',
      },
      {
        title: 'Conduza a pauta',
        body: 'Na aba Pauta, organize as seções Expediente / Ordem do Dia / Comunicações: mova itens para cima/baixo, marque Em leitura → Em discussão → Em votação, retire ou adiante com justificativa. Cada mudança reflete no telão e no portal.',
      },
      {
        title: 'Abra a votação',
        body: 'Em Nova votação, escolha o modo (nominal, simbólico ou secreto), a regra de maioria e se oculta parciais — e, quando o regimento pedir, troque Sim/Não/Abstenção por até 5 opções customizadas (rótulos regimentais como Aprovar e encaminhar / Arquivar / Adiar). No painel Votação, abra/pause/retome/feche — cada voto é idempotente por commandId (reenvio não duplica) e o resultado é calculado de forma determinística, atualizando a matéria. Ao fechar uma votação nominal, o painel Recibos verificáveis reconfere os códigos HMAC de cada voto (Reverificar); votação secreta mostra participação, nunca o valor.',
      },
      {
        title: 'Cronometre os discursos',
        body: 'Na aba Discursos, gerencie a fila de oradores com cronômetro server-side: Iniciar, Pausar, +1 min e Encerrar. O tempo aparece na Mesa, no Telão e no App do Parlamentar automaticamente.',
      },
      {
        title: 'Projete no telão',
        body: 'Em Operação → Telão, abra o modo kiosk com perfis automáticos (pauta, votação, discursos). O snapshot de reconstrução recompõe a tela após quedas de conexão; pela Mesa, aba Telão, você congela, limpa ou troca o perfil manualmente.',
      },
      {
        title: 'Proteja sua conta com MFA e sessões ativas',
        body: 'No módulo Usuários, card "Meu acesso" (v0.13.0): ative o MFA TOTP — o login passa a pedir o código de 6 dígitos do autenticador após a senha (dois passos) — e revise as sessões abertas com último uso, revogando qualquer uma suspeita. O segundo fator protege a condução da sessão inteira: nenhuma entrada acontece sem ele.',
      },
      {
        title: 'Veja para onde o produto vai',
        body: 'Quando quiser conhecer as próximas ondas, abra Administração → Planejamento e Roadmap: leitura liberada para qualquer papel, com o estado entregue (Ondas 1–5 — v0.13.0), o mapa-alvo de 26 módulos e a Onda 6 planejada (ROADMAP §14).',
      },
    ],
    modules: ['dashboard', 'sessions', 'plenary', 'display', 'pwa', 'roadmap'],
  },
  {
    role: 'media_operator',
    title: 'Operador Audiovisual — acompanhe a transmissão',
    description: 'Você acompanha a fonte de vídeo e áudio e ativa os destinos configurados para a Câmara. A condução legislativa permanece com a mesa.',
    steps: [
      { title: 'Confira a fonte', body: 'Abra Operação → Mesa do Plenário → Transmissão, prepare o acompanhamento e publique o programa do encoder no caminho da sessão. Confirme o sinal recebido antes de ativar destinos.' },
      { title: 'Ative e confira cada destino', body: 'Ative os destinos RTMPS um a um. O estado encaminhando confirma o transporte do MediaMTX; confira vídeo e áudio também na página pública da plataforma.' },
      { title: 'Encerre com segurança', body: 'Desative todos os destinos antes de encerrar o acompanhamento. Em caso de perda de sinal, confira encoder, rede e a gravação local.' },
    ],
    modules: ['sessions', 'plenary', 'help'],
  },
  {
    role: 'presiding_officer',
    title: 'Presidência — dirija a sessão',
    description:
      'A Presidência conduz os trabalhos com as mesmas telas do operador, mais as ações exclusivas: abrir/encerrar sessões e votações, votar por parlamentar ausente e assinar o espelho. Permissões-chave: session.transition e voting.write.',
    steps: [
      {
        title: 'Assuma a condução',
        body: 'Na Mesa do Plenário, a Presidência abre e encerra sessões e votações com as mesmas garantias do operador (pré-condições, concorrência otimista e auditoria). O telão entra em "AO VIVO" quando a sessão é aberta.',
      },
      {
        title: 'Confirme o quórum',
        body: 'Na aba Presença, verifique o quórum regimental antes de abrir os trabalhos (alerta verde/âmbar). Parlamentares também fazem check-in pelo App do Parlamentar quando o auto check-in está habilitado nas Configurações.',
      },
      {
        title: 'Dirija a discussão e a votação',
        body: 'Na aba Pauta, conduza cada matéria: Em leitura → Em discussão (conceda a palavra pela fila de oradores com cronômetro) → Em votação. No painel Votação, acompanhe os contadores por rótulo (regimentais ou Sim/Não/Abstenções) e a grade nominal em tempo real; o resultado determinístico atualiza a matéria ao fechar. Encerrada uma votação nominal, o painel Recibos verificáveis comprova voto a voto que nada foi adulterado — use na declaração de resultado.',
      },
      {
        title: 'Vote por parlamentar ausente',
        body: 'Quando o regimento permitir, use "Votar como…" para registrar voto em nome de parlamentar ausente — a auditoria registra em nome de quem o voto foi lançado.',
      },
      {
        title: 'Encerre e assine o espelho',
        body: 'Ao Encerrar a sessão (confirmação reforçada), o espelho com presença consolidada, votações nominais e discursos fica disponível em Governança → Relatórios, com código de verificação da cadeia de auditoria para a assinatura eletrônica.',
      },
      {
        title: 'Acompanhe a repercussão',
        body: 'O Portal Público reflete pauta, presença e resultados ao vivo; as Publicações e Audiências formalizam a ata no diário eletrônico. Use ⌘K para saltar entre módulos sem perder o ritmo da sessão.',
      },
      {
        title: 'Acompanhe a assinatura eletrônica da ata',
        body: 'Encerrada a sessão e publicada a ata, o painel Assinaturas (Relatórios → Minuta de Ata, v0.13.0) mostra "N/M assinadas — Cadeia verificada ✓" com os presentes ainda pendentes — use na declaração de encerramento dos trabalhos. Os vereadores assinam pelo app (card Assinar ata) e qualquer cidadão confere a autenticidade pelo código no Portal Público: a assinatura atesta PRESENÇA na sessão, sem revelar voto secreto (ADR-023).',
      },
      {
        title: 'Consulte o que está planejado',
        body: 'Em Administração → Planejamento e Roadmap, a Presidência também consulta o plano do produto: Ondas 1–5 entregues (v0.13.0 — inclusive a assinatura eletrônica de atas e o MFA), mapa-alvo de 26 módulos e a Onda 6 planejada — leitura para qualquer papel autenticado.',
      },
    ],
    modules: ['plenary', 'pwa', 'display', 'reports', 'publications', 'portal', 'roadmap'],
  },
  {
    role: 'parliamentarian',
    title: 'Parlamentar — participe pelo app',
    description:
      'Seu lugar é o App do Parlamentar: presença, voto, palavra e histórico — tudo em tempo real, com as mesmas garantias regimentais da Mesa. Permissão-chave: pwa.self-service (auto check-in e voto próprio, habilitáveis por tenant).',
    steps: [
      {
        title: 'Acompanhe a sessão atual',
        body: 'Em Operação → App do Parlamentar, a aba Sessão atual mostra a situação, o quórum ao vivo e o seu status de presença. As atualizações chegam por WebSocket — o mesmo motor do plenário.',
      },
      {
        title: 'Registre sua presença',
        body: 'O botão Registrar minha presença habilita quando o auto check-in está permitido (Configurações da Casa) e a sessão está em check-in ou aberta; caso contrário, ele explica o motivo e o credenciamento fica com a Mesa.',
      },
      {
        title: 'Vote com segurança',
        body: 'Com votação aberta, os botões grandes (Sim/Não/Abstenção ou os rótulos regimentais da votação) pedem confirmação. Você pode alterar o voto enquanto a política permitir — o app gera um novo comando idempotente (commandId) que nunca duplica o anterior. Em votação secreta, apenas a sua participação é exibida; o valor não aparece nem para a Mesa.',
      },
      {
        title: 'Peça a palavra',
        body: 'Na Fila de oradores, veja sua posição e toque em Pedir a palavra escolhendo o tipo (Grande Expediente, Explicações Pessoais…) e o assunto. O cronômetro do seu discurso aparece na Mesa e no telão.',
      },
      {
        title: 'Consulte seu histórico e seus recibos',
        body: 'A aba Meu histórico reúne presenças e votos por sessão; a aba Recibos lista o código verificável de cada voto nominal encerrado (o recibo sai no encerramento — enquanto a votação está aberta ele fica pendente). Para aprofundar, use a pesquisa global (⌘K) e o Portal Público para acompanhar o resultado dos trabalhos.',
      },
      {
        title: 'Assine a ata da sessão encerrada pelo app',
        body: 'Depois que a Casa encerra a sessão e publica a ata no diário eletrônico, o card Assinar ata (v0.13.0) aparece para quem teve presença registrada: um toque gera o código da assinatura eletrônica ("Ata assinada eletronicamente — Código …", idempotente — tocar de novo devolve a MESMA assinatura). A assinatura atesta sua presença e se encadeia com as demais (verificação pública no Portal); o seu voto secreto, se houver, permanece sigiloso.',
      },
      {
        title: 'Acompanhe as novidades do produto',
        body: 'Em Administração → Planejamento e Roadmap (leitura liberada), veja o que já foi entregue (Ondas 1–5 — v0.13.0, incluindo a assinatura da ata pelo app que complementa os recibos do seu voto) e a Onda 6 planejada (ROADMAP §14).',
      },
    ],
    modules: ['pwa', 'matters', 'portal', 'roadmap'],
  },
  {
    role: 'auditor',
    title: 'Auditor — integridade e evidências',
    description:
      'Leitura completa com garantia de integridade: você confere a cadeia de auditoria, os espelhos de sessão e as agregações — o sistema nega qualquer escrita no servidor (403), não apenas esconde botões.',
    steps: [
      {
        title: 'Verifique a cadeia de auditoria',
        body: 'Em Governança → Auditoria, a trila append-only registra toda ação relevante (quem, quando, o que mudou, justificativa). O botão Verificar cadeia recalcula os hashes encadeados: "Cadeia válida" confirma que nenhum registro histórico foi adulterado (ADR-004). Exporte o JSON para o processo externo.',
      },
      {
        title: 'Confira o espelho e os recibos das sessões',
        body: 'Em Governança → Relatórios, o espelho de sessão tem valor probatório: presença consolidada, votações nominais voto a voto, discursos e o código de verificação vinculado à cadeia. A minuta de ata (com ou sem assistência de IA) registra quem aprovou cada rascunho. Você também pode recontar os recibos verificáveis de qualquer votação encerrada (painel Recibos na Mesa ou a rota de verificação): o servidor recomputa o HMAC de cada voto e compara com o recibo persistido — divergência é sempre visível.',
      },
      {
        title: 'Analise a produtividade',
        body: 'Em Governança → Analytics, confira presença média e ranking (mesma regra do plenário), resultados de votações, tempo médio de tramitação e coesão partidária — calculada apenas em votações NOMINAIS; secretas jamais entram em nenhuma agregação (ADR-013). A rota é 100% somente-leitura.',
      },
      {
        title: 'Acompanhe as publicações oficiais',
        body: 'Em Publicações e Audiências e no Portal Público, cada ato do diário eletrônico tem numeração por ano e código de verificação; a revogação nunca apaga (o selo "Revogada" preserva o histórico). Audiências públicas exibem apenas perguntas aprovadas na moderação.',
      },
      {
        title: 'Colete evidências',
        body: 'Exporte a auditoria em JSON, imprima espelho/ata com Ctrl+P e use Portal Público → Dados Abertos (JSON/CSV) para conferência independente. Webhooks permitem espelhar eventos assinados (HMAC) em sistema externo de custódia.',
      },
      {
        title: 'Verifique as assinaturas eletrônicas da ata',
        body: 'Com a ata publicada, o painel Assinaturas (Relatórios → Minuta de Ata, v0.13.0) recomputa a cadeia a cada leitura ("N/M assinadas — Cadeia verificada ✓") e o Portal Público permite a VERIFICAÇÃO INDEPENDENTE por código de 16 caracteres, sem login: a resposta inclui signatário, ata e horário — e o recompute usa o conteúdo ATUAL, então qualquer edição posterior à assinatura invalida o resultado. A assinatura atesta presença; o voto secreto permanece sigiloso (ADR-023).',
      },
      {
        title: 'Verifique o plano e a documentação',
        body: 'O módulo Administração → Planejamento e Roadmap documenta o estado entregue (Ondas 1–5, v0.13.0), a Onda 6 planejada (ROADMAP §14) e o pacote documental (25 ADRs entregues) — leitura para qualquer papel, útil para citar a fonte das garantias em relatórios externos.',
      },
    ],
    modules: ['audit', 'reports', 'analytics', 'publications', 'portal', 'webhooks', 'roadmap'],
  },
  {
    role: 'platform_owner',
    title: 'Operador da Plataforma — o SaaS por inteiro',
    description:
      'Você opera a instância multiempresa: tenants, onboarding, planos, faturamento, observabilidade e o ciclo de vida (exportação e encerramento). Permissão-chave: platform.manage (escopo global, sem tenant).',
    steps: [
      {
        title: 'Monitore a plataforma',
        body: 'Em Administração → Console da Plataforma, a Visão Geral traz KPIs globais (Câmaras ativas, sessões do mês, votos, dead-letters) e a tabela de tenants com uso agregado, health score e assinatura — métricas agregadas, nunca conteúdo legislativo de outra Casa. A aba Sistema (Fase 16) mostra health dos serviços, filas (outbox/webhooks), banco e alertas com ação sugerida.',
      },
      {
        title: 'Faça o onboarding de uma Câmara',
        body: 'No Console, a nova Câmara é criada em um fluxo só: tenant + legislatura + administrador + trial de 14 dias. O white-label e os limites do plano já valem desde o primeiro acesso.',
      },
      {
        title: 'Rode o ciclo de cobrança',
        body: 'Na aba Faturamento, Executar ciclo do mês gera a fatura de cada tenant ativo (mensalidade + excedentes de parlamentares/sessões) de forma idempotente e aplica o dunning: fatura vencida → assinatura past_due + notificação ao administrador da Câmara + webhook. Registrar pagamento reativa a assinatura; cancelar exige justificativa auditada.',
      },
      {
        title: 'Gerencie planos e entitlements',
        body: 'O CRUD de planos define o que cada Câmara pode usar: starter (sem IA), profissional (com ai_assist) e enterprise. Rotas de IA fora do plano são bloqueadas no servidor com 402 PLAN_LIMIT.',
      },
      {
        title: 'Opere o encerramento, a exportação e os alertas',
        body: 'Ainda no Console: Exportar dados cria um job assíncrono com progresso real (0–100%) e o download traz o JSON integral do tenant (sem hashes de senha, tokens, segredos de webhook e sem valores de voto secreto), regenerado no momento do pedido. Encerrar formaliza o fim da operação (justificativa + digitação "ENCERRAR"; desativa o tenant, revoga todas as sessões e cancela a assinatura — os dados NUNCA são apagados). Na aba Sistema, reconheça os alertas persistentes (aberto → reconhecido, com quem/quando); o Suporte da Plataforma (João Prado) acompanha a operação e pode operar como um usuário com banner, prazo e auditoria dedicadas.',
      },
      {
        title: 'Acompanhe as migrações',
        body: 'Em Administração → Migração de Dados, rode o pipeline auditado de 8 estágios do PainelDeskLegis 8.1 (inspecionar → homologar) com rollback até a homologação. Consulte o runbook para operar restarts dos serviços e o seed da base de demonstração.',
      },
      {
        title: 'Acompanhe a saúde dos tenants e a fila de onboarding no Crescimento',
        body: 'No módulo Administração → Crescimento (v0.13.0, exclusivo do dono da plataforma): métricas de negócio (tenants ativos, MRR simulado, churn 90d, trials e NPS da versão), a tabela de saúde por tenant com o health score canônico (fórmula exibida — sessões, matérias, logins, webhooks — e tendência vs. última captura; "Capturar snapshot" registra uma leitura forçada) e a fila do self-onboarding: Ativar cria a Câmara em trial de 14 dias com senha temporária exibida UMA vez; Rejeitar exige nota de feedback. O agendador :3005 (Console → Sistema → Agendamentos) mantém varreduras, watchdog e capturas diárias no ar.',
      },
      {
        title: 'Gerencie o progresso do roadmap',
        body: 'No módulo Administração → Planejamento e Roadmap, o dono da plataforma é o único que atualiza o status das tasks (permissão platform.manage, verificada no servidor): a alteração persiste com autor e horário na própria linha. Na v0.13.0 a Onda 5 está entregue (34/34 concluídas) e a Onda 6 (Fases 25–28) é a próxima onda planejada (ROADMAP §14) — suas tasks passam a ser rastreadas quando a onda começar.',
      },
    ],
    modules: ['console', 'migration', 'help', 'roadmap', 'growth'],
  },
]

// ─── Glossário legislativo (~26 termos) ─────────────────────────────────────

const GLOSSARY: GlossaryTerm[] = [
  { term: 'Ata', definition: 'Registro oficial e fidedigno de tudo o que ocorreu em uma sessão: presença, expediente, votações e discursos. No sistema, nasce da minuta estruturada (dados persistidos) e é publicada no diário eletrônico com código de verificação.' },
  { term: 'Autoria / Coautoria', definition: 'Indicação do(s) parlamentar(es) responsável(eis) por uma matéria. O sistema aceita autores múltiplos (coautoria) e a pesquisa alcança o nome de qualquer um deles.' },
  { term: 'Bloco parlamentar', definition: 'Agrupamento de partidos com afinidade política, cadastrado na Estrutura Institucional. Os blocos aparecem nos filtros e nas análises de composição da Casa.' },
  { term: 'Despacho', definition: 'Decisão inicial da Presidência que encaminha a matéria às comissões ou à pauta. É o primeiro andamento possível no fluxo de tramitação e determina o regime de discussão.' },
  { term: 'Ementa', definition: 'Síntese do objeto de uma matéria legislativa, exibida em pautas, telão, portal e publicações. A IA assistiva pode sugerir rascunhos de ementa, sempre com revisão humana.' },
  { term: 'Emenda', definition: 'Proposta de alteração parcial de uma matéria em tramitação, apresentada durante a discussão. Pode ser agregada ao texto antes da votação em turno.' },
  { term: 'Expediente', definition: 'Seção inicial da sessão destinada à leitura de atos, correspondências e comunicações. Na Mesa do Plenário, a pauta organiza Expediente, Ordem do Dia e Comunicações.' },
  { term: 'Licença', definition: 'Afastamento formal e temporário do parlamentar (saúde, missão, etc.), registrado nos afastamentos da Estrutura Institucional. Parlamentar licenciado sai da base de quórum e pode ser substituído pelo suplente.' },
  { term: 'Maioria absoluta', definition: 'Regra de deliberação que exige mais da metade dos membros DA CASA (não apenas dos presentes). Está entre as regras configuráveis ao abrir uma votação.' },
  { term: 'Maioria simples', definition: 'Regra de deliberação que prevalece a vontade da maioria dos presentes na sessão. É a regra mais comum em votações de rotina.' },
  { term: 'Mesa diretora', definition: 'Órgão de direção dos trabalhos (Presidente, Vice, 1º e 2º Secretários). O sistema guarda a composição com vigência — designações, transferências e encerramentos nunca sobrescrevem o histórico.' },
  { term: 'Ordem do dia', definition: 'Relação das matérias que serão efetivamente discutidas e votadas na sessão, montada a partir do protocolo. Publicada na pauta e visível no portal e no telão.' },
  { term: 'Parecer', definition: 'Posição técnica de uma comissão sobre uma matéria (favorável, contrário ou pela rejeição), emitida na tramitação antes da inclusão em pauta.' },
  { term: 'Protocolo', definition: 'Ato de registro formal de entrada de matérias e documentos na Casa, com numeração automática sequencial por ano (sem buracos). É a porta de entrada do processo legislativo no sistema.' },
  { term: 'Quórum', definition: 'Número mínimo de parlamentares presentes para deliberar. A Mesa calcula o quórum em tempo real com base na presença ativa (presentes, sem saída temporária, licenciados e afastados) e compara com o mínimo regimental configurado.' },
  { term: 'Redação final', definition: 'Versão consolidada da matéria aprovada, incorporando emendas e substitutivos, pronta para a sanção/promulgação. Fase final do processo antes do arquivamento definitivo.' },
  { term: 'Regime de tramitação', definition: 'Prazo e prioridade com que a matéria tramita (ordinário, urgência, etc.), definidos no despacho inicial e controlados pelos prazos e tarefas do sistema.' },
  { term: 'Sessão solene', definition: 'Sessão especial destinada a homenagens e comemorações, sem deliberação de matérias. Está entre os tipos de sessão cadastráveis (ordinária, extraordinária, solene, especial).' },
  { term: 'Substitutivo', definition: 'Texto alternativo integral apresentado para substituir o projeto original durante a tramitação, votado em seu lugar se acolhido.' },
  { term: 'Suplente', definition: 'Parlamentar substituto que assume a vaga durante licença ou afastamento do titular. O vínculo é registrado nos afastamentos com período e encerramento.' },
  { term: 'Turno', definition: 'Cada rodada de discussão e votação por que passa a matéria (1º turno, 2º turno…). Matérias relevantes podem exigir dois turnos conforme o regimento.' },
  { term: 'Urgência', definition: 'Regime especial que acelera a tramitação, encurtando prazos para levar a matéria rapidamente à pauta. Concedido por deliberação ou previsto em regimento.' },
  { term: 'Veto', definition: 'Recusa do Executivo a sancionar total ou parcialmente uma matéria aprovada pelo Legislativo. O texto vetado retorna à Casa para análise das razões do veto.' },
  { term: 'Votação nominal', definition: 'Modalidade em que o voto de cada parlamentar é registrado nominalmente (Sim/Não/Abstenção), exibido na hora na Mesa e consolidado no espelho. É a única modalidade usada no cálculo de coesão partidária do Analytics.' },
  { term: 'Votação secreta', definition: 'Modalidade em que o VALOR do voto não é revelado a ninguém — nem à Mesa, nem à Presidência, nem ao auditor, e também não entra no export do tenant. Apenas a participação é registrada e publicada após o encerramento.' },
  { term: 'Votação simbólica', definition: 'Modalidade em que a contagem é feita por indicação (mãos levantadas), registrando apenas o resultado agregado, sem voto individual.' },
]

// ─── Perguntas frequentes ───────────────────────────────────────────────────

const FAQ: FaqItem[] = [
  {
    question: 'Como entro no sistema? E se eu esquecer a senha?',
    answer:
      'Na primeira visita, o gate de entrada oferece duas opções: e-mail e senha (sessão de 7 dias em cookie httpOnly) ou um perfil de demonstração com um clique. Sem senha cadastrada, peça ao Administrador da Câmara para usar Redefinir senha no módulo Usuários — isso revoga todas as suas sessões e define uma nova. O botão Sair no topo encerra a sessão e volta ao gate.',
  },
  {
    question: 'Qual a diferença entre perfis de demonstração e login real?',
    answer:
      'Os perfis de demonstração entram com um clique, sem senha — as permissões (RBAC) e a auditoria são exatamente as mesmas do login real, pois o servidor resolve o ator em cascata (cookie de sessão → header demo). Use a demonstração para conhecer o produto e o login real no dia a dia da Casa.',
  },
  {
    question: 'Como crio e abro uma sessão?',
    answer:
      'Em Operação → Sessões, clique em Nova sessão: informe tipo, data/hora, presidente, secretário e as matérias da Ordem do Dia — ao incluir matérias, a pauta é montada e publicada (o portal atualiza). No dia, na Mesa do Plenário, siga as transições: Abrir check-in (credenciamento e quórum) → Abrir sessão (telão entra em AO VIVO) → conduzir a pauta → Encerrar. Cada transição tem pré-condição e auditoria.',
  },
  {
    question: 'Como se abre uma votação?',
    answer:
      'Na Mesa do Plenário, aba Pauta, selecione a matéria em discussão e clique em Nova votação: escolha o modo (nominal, simbólico ou secreto), a regra de maioria (simples, absoluta ou unanimidade) e se quer ocultar parciais. No painel Votação, use Abrir → os votos chegam em tempo real (Mesa e App do Parlamentar) → Fechar gera o resultado determinístico e atualiza a situação da matéria. Votos são idempotentes por commandId: reenvio nunca duplica.',
  },
  {
    question: 'O voto secreto é visível para alguém?',
    answer:
      'Não. Nem o operador, nem a Presidência, nem o auditor veem o valor de um voto secreto — e ele também não entra na exportação integral do tenant nem em nenhuma agregação do Analytics. Apenas a PARTICIPAÇÃO (quem votou) é registrada e publicada após o encerramento da votação.',
  },
  {
    question: 'Como publico uma ata no diário eletrônico?',
    answer:
      'Em Governança → Publicações e Audiências, crie a publicação do tipo ata vinculada à sessão (ou use "criar a partir de modelo" para renderizar um Modelo de Documento versionado). A ata nasce em rascunho — invisível no portal — e Publicar gera a numeração por ano (ex.: 0001/2026) com código de verificação. Revogação posterior exige motivo e mantém o ato visível com selo "Revogada".',
  },
  {
    question: 'Minha pergunta na audiência pública não apareceu — por quê?',
    answer:
      'As perguntas enviadas pelo formulário do cidadão (sem autenticação) nascem pendentes e só ficam visíveis no portal após a aprovação na aba Moderação do módulo Publicações e Audiências. Rejeitadas permanecem internas (uso exclusivo da Casa) e o e-mail do autor nunca é exibido no portal (LGPD). Verifique também se a janela de perguntas da audiência está aberta.',
  },
  {
    question: 'O que são dados abertos?',
    answer:
      'Datasets públicos em JSON/CSV com somente dados publicáveis (matérias, sessões históricas, pautas e resultados), disponíveis em Portal Público → Dados Abertos e pela API pública /api/v1/public/open-data — o formato segue o padrão brasileiro de dados abertos e alimenta portais de transparência.',
  },
  {
    question: 'Como assino as entregas de webhook (HMAC)?',
    answer:
      'Ao criar um webhook em Governança → Webhooks, o sistema gera um segredo — copie no ato (ele não é exibido de novo). Cada entrega chega com os cabeçalhos x-legis-signature (HMAC-SHA256 do corpo), x-legis-timestamp e x-legis-event: recalcule a assinatura com o segredo e compare antes de confiar no payload. Há exemplo de verificação no docs/api-contract.md. Falhas de entrega são retentadas com backoff exponencial e vão a dead-letter após 5 tentativas.',
  },
  {
    question: 'Como emito uma chave de API?',
    answer:
      'Em Governança → Integrações & API, aba Chaves de API, clique em Nova chave (exige o papel de administrador da Câmara): informe um nome descritivo (um por integração — ex.: Painel da Transparência) e marque os escopos de leitura. A chave completa (legk_…) é exibida UMA única vez, com botão de copiar — o servidor persiste apenas o prefixo legk_xxxxxxxx e um hash SHA-256, então não há como recuperá-la depois: se perder, revogue e emita outra. A revogação é imediata, auditada e append-only.',
  },
  {
    question: 'Quais escopos uma chave pode ter?',
    answer:
      'Quatro, todos de LEITURA: matters.read (matérias do tenant — mesmas fields do portal público), sessions.read (sessões agendadas/realizadas com pauta publicada), publications.read (publicações do diário eletrônico com status published) e calendar.read (eventos do calendário legislativo do mês). Cada endpoint externo exige o seu escopo — uma chave sem o escopo recebe 403 FORBIDDEN_SCOPE. Os dados retornados são SEMPRE do tenant da chave (mesmo isolamento do x-actor-id) e o limite é de 60 requisições/minuto por chave (429 + Retry-After acima disso).',
  },
  {
    question: 'O que significa o erro 429 no playground?',
    answer:
      'Significa que a chave atingiu o limite de 60 requisições por minuto (janela deslizante) — cada execução do playground conta como uso da chave, junto com as consultas das integrações. O corpo do erro vem no formato Problem Details (code RATE_LIMITED) com o campo retryAfterSeconds e o header Retry-After indica quantos segundos faltam para a liberação: aguarde esse tempo antes de executar de novo. Em produção o cliente deve tratar 429 com backoff exponencial.',
  },
  {
    question: 'Como ativo o MFA (segundo fator)?',
    answer:
      'No módulo Usuários, card "Meu acesso": "Configurar MFA" gera o segredo TOTP e a URL otpauth (escaneie no Google Authenticator, 1Password, Authy…) — confirme com o código de 6 dígitos para ativar. A partir daí o login por senha ganha o segundo passo (o sistema responde 401 MFA_REQUIRED e nenhuma sessão nasce sem o código). Para desligar, informe a SENHA e um código válido — o segredo é removido do banco. No mesmo card, "Sessões ativas" lista navegador, IP, último uso e permite revogar qualquer sessão (revogar a atual equivale a sair).',
  },
  {
    question: 'Como assino a ata da sessão pelo app?',
    answer:
      'Depois que a sessão é encerrada e a ata publicada no diário eletrônico, o card "Assinar ata" aparece no App do Parlamentar para quem teve presença registrada: um toque gera o código da assinatura eletrônica ("Ata assinada eletronicamente — Código …"). A operação é idempotente — tocar de novo devolve a MESMA assinatura, sem duplicar. A Mesa acompanha o N/M no painel Assinaturas (Relatórios → Minuta de Ata) e o cidadão confere por código no Portal Público. A assinatura atesta PRESENÇA; o voto secreto permanece sigiloso (ADR-023).',
  },
  {
    question: 'O que significa o banner de trial no topo?',
    answer:
      'A Câmara está no período de avaliação (14 dias após o onboarding): a faixa âmbar mostra "Trial termina em N dias — falar com a plataforma". Quando vence, a faixa fica vermelha — "Trial expirado — leitura liberada, gravação bloqueada": consultar tudo continua funcionando, mas salvar/editar devolve 403 TRIAL_EXPIRED até a conversão em assinatura. Nada é perdido ou apagado; o banner some para papéis da plataforma e tenants sem trial.',
  },
  {
    question: 'Como verifico publicamente uma assinatura da ata?',
    answer:
      'No Portal Público, no detalhe da sessão com ata publicada: informe o código de 16 caracteres da assinatura no formulário de verificação — a resposta "Assinatura autêntica" traz signatário, ata e horário; código inexistente responde valid=false (sem erro). A verificação RECOMPUTA o hash com o conteúdo ATUAL da ata: qualquer edição depois da assinatura invalida o resultado. É pública (sem login) e limitada a 30 consultas por minuto por IP.',
  },
  {
    question: 'Como ativo o MFA (segundo fator)?',
    answer:
      'No módulo Usuários, card "Meu acesso": "Configurar MFA" gera o segredo TOTP e a URL otpauth (escaneie no Google Authenticator, 1Password, Authy…) — confirme com o código de 6 dígitos para ativar. A partir daí o login por senha ganha o segundo passo (o sistema responde 401 MFA_REQUIRED e nenhuma sessão nasce sem o código). Para desligar, informe a SENHA e um código válido — o segredo é removido do banco. No mesmo card, "Sessões ativas" lista navegador, IP, último uso e permite revogar qualquer sessão (revogar a atual equivale a sair).',
  },
  {
    question: 'Como assino a ata da sessão pelo app?',
    answer:
      'Depois que a sessão é encerrada e a ata publicada no diário eletrônico, o card "Assinar ata" aparece no App do Parlamentar para quem teve presença registrada: um toque gera o código da assinatura eletrônica ("Ata assinada eletronicamente — Código …"). A operação é idempotente — tocar de novo devolve a MESMA assinatura, sem duplicar. A Mesa acompanha o N/M no painel Assinaturas (Relatórios → Minuta de Ata) e o cidadão confere por código no Portal Público. A assinatura atesta PRESENÇA; o voto secreto permanece sigiloso (ADR-023).',
  },
  {
    question: 'O que significa o banner de trial no topo?',
    answer:
      'A Câmara está no período de avaliação (14 dias após o onboarding): a faixa âmbar mostra "Trial termina em N dias — falar com a plataforma". Quando vence, a faixa fica vermelha — "Trial expirado — leitura liberada, gravação bloqueada": consultar tudo continua funcionando, mas salvar/editar devolve 403 TRIAL_EXPIRED até a conversão em assinatura. Nada é perdido ou apagado; o banner some para papéis da plataforma e tenants sem trial.',
  },
  {
    question: 'Como verifico publicamente uma assinatura da ata?',
    answer:
      'No Portal Público, no detalhe da sessão com ata publicada: informe o código de 16 caracteres da assinatura no formulário de verificação — a resposta "Assinatura autêntica" traz signatário, ata e horário; código inexistente responde valid=false (sem erro). A verificação RECOMPUTA o hash com o conteúdo ATUAL da ata: qualquer edição depois da assinatura invalida o resultado. É pública (sem login) e limitada a 30 consultas por minuto por IP.',
  },
  {
    question: 'O que acontece com uma fatura vencida (dunning)?',
    answer:
      'Quando o Operador da Plataforma executa o ciclo do mês, tenants com fatura vencida têm a assinatura marcada como past_due, o administrador da Câmara recebe notificação e um webhook billing.invoice_overdue é disparado. Registrar o pagamento devolve a assinatura para ativa; cancelar uma fatura exige justificativa auditada. O ciclo é idempotente — reexecutar não duplica faturas.',
  },
  {
    question: 'Posso exportar ou encerrar uma Câmara?',
    answer:
      'Sim, no Console da Plataforma (permissão platform.manage). Exportar dados baixa um JSON integral do tenant — sem hashes de senha, tokens, segredos de webhook e sem valores de voto secreto. Encerrar exige justificativa e a digitação de "ENCERRAR": o tenant é desativado (usuários passam a receber 403), todas as sessões são revogadas e a assinatura cancelada — mas os dados NUNCA são apagados (retenção LGPD + cadeia de auditoria).',
  },
  {
    question: 'Como pesquiso rapidamente matérias, sessões e publicações?',
    answer:
      'Pressione ⌘K (Ctrl+K no Windows/Linux) em qualquer tela: a paleta de comandos abre com a navegação dos 26 módulos e, ao digitar 2+ caracteres, a pesquisa unificada busca matérias, sessões, parlamentares e publicações (top 5 por seção) com atraso de 300 ms. Use as setas ↑↓ para escolher e Enter para navegar; ESC fecha.',
  },
  {
    question: 'Como provar que um voto não foi adulterado?',
    answer:
      'Cada voto nominal encerrado gera um recibo verificável: um código derivado de HMAC-SHA256 com segredo da Casa. O parlamentar confere o código na aba Recibos do App do Parlamentar; a Mesa e a auditoria recontam no painel Recibos verificáveis (ou pela rota /api/v1/votings/:id/receipts): o servidor RECOMPUTA o código de cada voto e compara com o recibo persistido — zero divergências emite o selo verde; qualquer adulteração gera divergência visível. Votação secreta emite recibo de participação, sem valor. A prova individual soma-se à cadeia de auditoria (ADR-004/ADR-019).',
  },
  {
    question: 'O que acontece quando o prefeito veta um projeto?',
    answer:
      'A Administração Legislativa registra o desfecho veto total/parcial no dossiê da matéria, com justificativa obrigatória: a situação passa a Vetada, o veto entra na tramitação como andamento e o sistema cria automaticamente a tarefa Apreciar veto com prazo regimental (padrão de 15 dias) em Prazos/Tarefas e na Agenda. Após veto parcial, a sanção da parte não vetada pode ser registrada como novo desfecho (situação Sancionada), preservando o histórico. O cidadão vê o desfecho no portal público.',
  },
  {
    question: 'Como um cidadão acompanha uma matéria?',
    answer:
      'No Portal Público, aba Acompanhar: informa o e-mail e a matéria, sessão ou audiência de interesse — a assinatura nasce pendente e só passa a valer após a confirmação pelo link enviado ao e-mail (dupla confirmação, anti-spam/LGPD). A Casa gerencia tudo em Publicações e Audiências → Assinaturas: estatísticas, link de confirmação das pendências e revogação auditada. Envios e verificações públicas têm limite por IP (429 com tempo de espera).',
  },
  {
    question: 'O suporte consegue acessar a Câmara sem que ninguém saiba?',
    answer:
      'Não. Operar como um usuário exige login por senha, motivo com no mínimo 10 caracteres e prazo de 5 a 60 minutos; enquanto ativa, um banner âmbar fixo mostra o suporte, o alvo e a contagem regressiva em TODOS os módulos, com botão Encerrar agora. O início e o fim ficam registrados na auditoria da própria Câmara (support.impersonation_started/_ended), o suporte nunca assume papéis da plataforma e a operação encerra sozinha ao vencer o prazo (logout também encerra).',
  },
  {
    question: 'Como acompanho o que vem a seguir no produto?',
    answer:
      'Abra Administração → Planejamento e Roadmap: a aba Onda 5 — Fases ✓ mostra as Fases 21–24 ENTREGUES na v0.13.0 (100% · 34/34 tasks concluídas); a aba Menus e páginas, o mapa-alvo TO-BE v5 com os 26 módulos; a aba Documentação, o pacote documental (16 entregues · 0 planejados); e a aba Onda 6, as Fases 25–28 PLANEJADAS para a v0.14.0 (detalhadas no ROADMAP §14). Qualquer perfil autenticado pode consultar — leitura liberada.',
  },
  {
    question: 'Quem pode marcar tasks do roadmap como concluídas?',
    answer:
      'Apenas o dono da plataforma (platform_owner): a escrita exige a permissão platform.manage, verificada no servidor — qualquer outro papel recebe 403 (comportamento esperado). A alteração fica registrada na própria linha da task (quem alterou e quando, via PATCH /api/v1/roadmap/tasks/:id). Na base atual a Onda 5 já está toda concluída (34/34) — o re-seed devolve exatamente esse estado entregue.',
  },
  {
    question: 'Onde vejo a documentação completa do sistema?',
    answer:
      'Em três camadas: esta Central de Ajuda (aba Sobre com o índice dos documentos do produto), o módulo Administração → Planejamento e Roadmap (aba Documentação — entregues e planejados) e os arquivos em docs/ do repositório: ROADMAP, contrato da API, manual do usuário, runbook, changelog, relatório de testes, guia do importador e ADRs 001–025 entregues (026–029 planejados para a Onda 6 — ROADMAP §14).',
  },
]

// ─── Atalhos de teclado ─────────────────────────────────────────────────────

const SHORTCUTS: ShortcutItem[] = [
  { keys: '⌘K / Ctrl+K', description: 'Abrir a paleta de comandos: navegação entre módulos + pesquisa unificada', scope: 'Em todo o sistema' },
  { keys: 'ESC', description: 'Fechar diálogos, drawers e a paleta de comandos', scope: 'Diálogos e paleta ⌘K' },
  { keys: 'Tab / Shift+Tab', description: 'Avançar e voltar entre elementos focáveis (botões, campos, abas)', scope: 'Em todo o sistema' },
  { keys: 'Ctrl+P', description: 'Imprimir o espelho da sessão, a minuta de ata ou uma publicação', scope: 'Relatórios e Publicações' },
  { keys: '↑ ↓ + Enter', description: 'Navegar nos resultados e abrir o item selecionado', scope: 'Paleta de comandos ⌘K' },
]

// ─── Novidades (changelog resumido; mais recente primeiro) ──────────────────

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.13.0',
    date: '2026-10-08',
    title: 'Fase 23 — Ecossistema: chaves de API e documentação para desenvolvedores',
    highlights: [
      'Módulo Integrações & API (Governança): emissão de chaves legk_ com escopos de leitura por integração — a chave completa é exibida UMA única vez e só o prefixo (legk_+8) e o hash SHA-256 são persistidos; revogação imediata, auditada e append-only',
      'Rotas externas /api/v1/external/{matters,sessions,publications,calendar}: autenticação Bearer por chave, escopo exigido por endpoint (403 FORBIDDEN_SCOPE), dados sempre do tenant da chave e limite de 60 req/min por chave (429 + Retry-After)',
      'Playground in-app: a consulta REAL executa no servidor via delegação assinada HMAC de 30s — a chave nunca vai ao navegador e não é reconstruída (ADR-024)',
      'Documentação para desenvolvedores dentro do módulo (referência dos 4 endpoints, envelope de resposta, erros Problem Details e exemplos curl) e guia do desenvolvedor nesta Central de Ajuda',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-08-31',
    title: 'Planejamento da Onda 5 e módulo "Planejamento e Roadmap"',
    highlights: [
      'Módulo Planejamento e Roadmap (24º; Administração): o plano de continuidade do produto consultável DENTRO do produto por qualquer papel autenticado — estado entregue (Ondas 1–4), mapa-alvo TO-BE v5 (26 módulos), pacote documental e prévia da Onda 6',
      'Onda 5 — Fases 21–24 com progresso real rastreável: 4 fases e 34 tasks persistidas (RoadmapPhase/RoadmapTask, nível plataforma); apenas o platform_owner atualiza o status (RBAC platform.manage), com autor e horário registrados na própria linha',
      'Rotas novas: GET /api/v1/roadmap (qualquer autenticado, inclusive platform_owner sem tenant) e PATCH /api/v1/roadmap/tasks/:id (403 para demais papéis — esperado)',
      'Fases 21–24 PLANEJADAS no ROADMAP §12: prontidão para produção (scheduler :3005, watchdog, ciclos, CI), MFA TOTP + assinatura eletrônica de atas, chaves de API + playground e self-onboarding/trial/health/NPS — ADRs 022–025 planejados e Onda 6 prévia (§13)',
    ],
  },
  {
    version: '0.11.0',
    date: '2026-08-31',
    title: 'Onda 4 — Fases 17–20: desfechos de matéria, recibos verificáveis, participação do cidadão e suporte',
    highlights: [
      'Matérias: seções Relacionamentos (emenda/substitutivo/altera/revoga/regula/subsidiária) e Desfecho (sanção, veto total/parcial com prazo de apreciação regimental) — situação Sancionada/Vetada só muda por desfecho auditado',
      'Votação: até 5 opções regimentais que substituem Sim/Não/Abstenção (apuração por rótulo) e recibos verificáveis HMAC por voto nominal — painel de reconta com divergências visíveis e aba Recibos no app do parlamentar',
      'Cidadão: assinaturas com dupla confirmação no Portal Público (aba Acompanhar), verificação de autenticidade de publicações por código e rate limit real nos endpoints públicos (429 + Retry-After)',
      'Suporte da Plataforma (novo módulo): operar como usuário com banner âmbar, prazo e auditoria dedicada na Casa-alvo; alertas persistentes com reconhecimento; exportação do tenant como job assíncrono com progresso real',
      '23 módulos, ~75 grupos de rotas /api/v1 e 4 ADRs novos (018–021)',
    ],
  },
  {
    version: '0.10.0',
    date: '2026-08-30',
    title: 'Fases 13–16 — produtividade, padronização documental, adoção e operação SaaS',
    highlights: [
      'Agenda Legislativa: calendário unificado de sessões, audiências, reuniões de comissão e prazos com filtros e painel do dia',
      'Pesquisa unificada ⌘K: paleta de comandos global com navegação nos 22 módulos e busca de matérias, sessões, parlamentares e publicações',
      'Modelos de Documento versionados por tenant, com variáveis, renderização no servidor e integração com Publicações',
      'Central de Ajuda in-app: guias por papel, glossário legislativo, FAQ, atalhos e novidades (esta tela)',
      'Observabilidade no Console (health, filas, alertas) + exportação integral e encerramento seguro de tenant',
    ],
  },
  {
    version: '0.9.0',
    date: '2026-08-21',
    title: 'Fases 9–12 — autenticação real, faturamento, publicações/participação e Analytics',
    highlights: [
      'Login por e-mail/senha (scrypt, cookie httpOnly de 7 dias) convivendo com os perfis de demonstração; módulo Usuários com redefinição de senha e desativação',
      'Faturamento SaaS: faturas mensais com excedentes, ciclo idempotente com dunning (past_due + notificação + webhook) e aba Faturamento no Console',
      'Diário eletrônico (publicações numeradas com código de verificação e revogação auditada) + audiências públicas com perguntas do cidadão moderadas',
      'Analytics/BI somente-leitura: presença, ranking, tramitação, resultados e coesão partidária (apenas votações nominais)',
      'Portal público ampliado para 6 abas, com participação popular sem autenticação (LGPD por construção)',
    ],
  },
  {
    version: '0.5.0',
    date: '2026-08-07',
    title: 'Fase 8 — Console da Plataforma & Migração de Dados',
    highlights: [
      'Console da Plataforma (platform_owner): KPIs globais, tenants com uso/health score/assinatura e onboarding completo de novas Câmaras (tenant + legislatura + admin + trial)',
      'Planos com entitlements: rotas de IA bloqueadas com 402 PLAN_LIMIT fora do plano',
      'Importador do PainelDeskLegis 8.1: pipeline auditado de 8 estágios, importação idempotente e retomável, reconciliação e homologação irreversível',
      'Segundo tenant de demonstração (Câmara de Serra Azul) com isolamento visível no console e no portal',
    ],
  },
  {
    version: '0.4.0',
    date: '2026-07-24',
    title: 'Fase 7 — IA assistiva & App do Parlamentar',
    highlights: [
      'IA assistiva backend (z-ai-web-dev-sdk): minuta de ata, sugestão de ementa, resumo de tramitação, transcrição (ASR) e OCR — com rastreabilidade total e revisão humana obrigatória',
      'App do Parlamentar mobile-first: contexto vivo, auto check-in opcional, voto próprio idempotente e fila de oradores',
      'Toda ação de IA é rascunho: aprovar/rejeitar é sempre decisão humana auditada',
    ],
  },
  {
    version: '0.3.0',
    date: '2026-07-10',
    title: 'Fase 6 — Portal, dados abertos, notificações, webhooks e ata',
    highlights: [
      'Portal público completo: pesquisa de matérias, detalhe com tramitação, sessões históricas e dados abertos JSON/CSV',
      'Webhooks assinados com HMAC-SHA256, retentativa exponencial, dead-letter e replay auditados (mini-serviço dedicado)',
      'Notificações internas com sino no topo e gatilhos transacionais',
      'Minuta de ata estruturada (100% dados persistidos) com código de verificação',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-06-26',
    title: 'Fase 5 — Estrutura institucional & processo legislativo',
    highlights: [
      '15 modelos novos: partidos, blocos, Mesa Diretora com vigência, comissões, mandatos, afastamentos/suplências, tramitação append-only, protocolo e prazos',
      'Máquina de estados da matéria: a situação só muda via andamento; terminais exigem anulação formal',
      'Módulos Estrutura Institucional (5 abas) e Protocolo e Tramitação (3 abas) com dossiê da matéria',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-06-12',
    title: 'Fases 0–4 — fundação, sessão/votação, plenário, telão e portal',
    highlights: [
      'Multi-tenant com white-label e RBAC server-side',
      'Motor de sessão/votação: estados com pré-condições, concorrência otimista, idempotência por commandId e resultado determinístico',
      'Mesa do Plenário e Telão kiosk em tempo real (outbox transacional → socket.io), com discursos cronometrados no servidor',
      'Auditoria append-only com cadeia de hash verificável; espelho de sessão com código de verificação',
      'Painel, Parlamentares, Matérias, Configurações regimentais e seed com 2 legislaturas de história realista',
    ],
  },
]

// ─── Sobre o produto ────────────────────────────────────────────────────────

const ABOUT = {
  productName: 'edocBR Plenário',
  version: '0.12.0',
  summary:
    'Plataforma legislativa multiempresa (SaaS) para Câmaras Municipais: sessões e votações em tempo real, processo legislativo completo, diário eletrônico, participação popular e portal de transparência — com white-label por Casa. Uma única instância atende várias Câmaras com isolamento total de dados, RBAC verificado no servidor, auditoria com cadeia de hash verificável e tempo real via WebSocket. Piloto em 0.x (pré-1.0): cada fase entrega código funcional, seed, documentação e verificação reproduzível.',
  stack: [
    'Next.js 16 (App Router)',
    'TypeScript',
    'Prisma + SQLite',
    'Tailwind CSS 4 + shadcn/ui',
    'socket.io (tempo real)',
    'z-ai-web-dev-sdk (IA assistiva, backend-only)',
  ],
  documents: [
    { name: 'README', path: 'README.md', description: 'Visão geral do produto, módulos, credenciais de demonstração e mapa da documentação.' },
    { name: 'Roadmap', path: 'docs/ROADMAP.md', description: 'Plano de continuidade: histórico das ondas de entrega, Onda 5 — Fases 21–24 completa (§12) e prévia da Onda 6 (§13); desde a v0.12.0 também consultável no módulo Planejamento e Roadmap.' },
    { name: 'Contrato da API', path: 'docs/api-contract.md', description: 'Rotas REST /api/v1, envelope Problem Details, eventos outbox e exemplo de verificação HMAC de webhooks.' },
    { name: 'Manual do Usuário', path: 'docs/user-manual.md', description: 'Guia de uso por perfil (operador, presidência, administração, parlamentar, auditor e plataforma) + FAQ.' },
    { name: 'Runbook Operacional', path: 'docs/runbook.md', description: 'Procedimentos de operação: restart dos serviços, seed da base de demonstração e manutenção do sandbox.' },
    { name: 'Changelog', path: 'docs/CHANGELOG.md', description: 'Histórico de versões no formato Keep a Changelog (0.1.0 → 0.12.0).' },
    { name: 'Relatório de Testes', path: 'docs/test-report.md', description: 'Evidências das verificações backend e frontend de cada fase.' },
    { name: 'Guia do Importador', path: 'docs/migration-importer.md', description: 'Pipeline de migração do PainelDeskLegis 8.1 estágio a estágio, com rollback e homologação.' },
    { name: 'ADR-001 — Arquitetura no sandbox', path: 'docs/adr/ADR-001-adaptacao-arquitetura-sandbox.md', description: 'Adaptação da arquitetura alvo ao ambiente do sandbox (SQLite, gateway, portas).' },
    { name: 'ADR-002 — Motor de sessão/votação', path: 'docs/adr/ADR-002-motor-sessao-votacao.md', description: 'Estados, pré-condições, concorrência otimista e idempotência por commandId.' },
    { name: 'ADR-003 — Tempo real outbox', path: 'docs/adr/ADR-003-tempo-real-outbox.md', description: 'Outbox transacional → serviço socket.io com salas interna e pública.' },
    { name: 'ADR-004 — Auditoria hash chain', path: 'docs/adr/ADR-004-auditoria-hash-chain.md', description: 'Trilha append-only com encadeamento de hash verificável.' },
    { name: 'ADR-005 — RBAC demo', path: 'docs/adr/ADR-005-rbac-demo.md', description: 'Identidade e RBAC no ambiente de demonstração (x-actor-id + login real).' },
    { name: 'ADR-006 — IA assistiva', path: 'docs/adr/ADR-006-ia-assistiva.md', description: 'IA com rastreabilidade total e revisão humana obrigatória.' },
    { name: 'ADR-007 — Webhooks HMAC', path: 'docs/adr/ADR-007-webhooks-hmac.md', description: 'Entregas assinadas, retentativa exponencial e dead-letter.' },
    { name: 'ADR-008 — Importador de migração', path: 'docs/adr/ADR-008-importador-migracao.md', description: 'Pipeline auditável de 8 estágios com homologação irreversível.' },
    { name: 'ADR-009 — App do Parlamentar', path: 'docs/adr/ADR-009-pwa-parlamentar.md', description: 'PWA mobile-first e endpoints /me com voto idempotente.' },
    { name: 'ADR-010 — Autenticação real', path: 'docs/adr/ADR-010-autenticacao-real.md', description: 'Login por e-mail/senha (scrypt + cookie httpOnly) coexistindo com o modo demo.' },
    { name: 'ADR-011 — Faturamento SaaS', path: 'docs/adr/ADR-011-faturamento-saas.md', description: 'Faturas, ciclo de cobrança idempotente e dunning simulados.' },
    { name: 'ADR-012 — Publicações e participação', path: 'docs/adr/ADR-012-publicacoes-participacao.md', description: 'Diário eletrônico e audiências com LGPD por construção.' },
    { name: 'ADR-013 — Analytics/BI', path: 'docs/adr/ADR-013-analytics-bi.md', description: 'Camada analítica somente-leitura (coesão só em votações nominais).' },
    { name: 'ADR-014 — Agenda e pesquisa unificada', path: 'docs/adr/ADR-014-agenda-pesquisa-unificada.md', description: 'Calendário operacional agregado e busca ⌘K somente-leitura (Fase 13).' },
    { name: 'ADR-015 — Modelos de Documento', path: 'docs/adr/ADR-015-modelos-documento-versionados.md', description: 'Templates versionados por tenant com renderização no servidor (Fase 14).' },
    { name: 'ADR-016 — Central de Ajuda', path: 'docs/adr/ADR-016-central-ajuda-in-app.md', description: 'Documentação viva in-app versionada com o código (Fase 15 — esta central).' },
    { name: 'ADR-017 — Observabilidade e encerramento', path: 'docs/adr/ADR-017-observabilidade-lifecycle-tenant.md', description: 'Health/queues/alertas, exportação integral e encerramento seguro (Fase 16).' },
    { name: 'ADR-018 — Desfechos da matéria', path: 'docs/adr/ADR-018-ciclo-materia-desfechos.md', description: 'Sanção/veto como fatos append-only e relacionamentos entre matérias (Fase 17).' },
    { name: 'ADR-019 — Recibos de voto verificáveis', path: 'docs/adr/ADR-019-recibos-voto-verificaveis.md', description: 'HMAC determinístico por tenant, reconta pública e opções regimentais (Fase 18).' },
    { name: 'ADR-020 — Participação e confiança pública', path: 'docs/adr/ADR-020-participacao-confianca-publica.md', description: 'Assinaturas com dupla confirmação, verificação por código e rate limit (Fase 19).' },
    { name: 'ADR-021 — Suporte e impersonação', path: 'docs/adr/ADR-021-suporte-impersonacao-operacao.md', description: 'Impersonação auditada com banner/prazo, alertas persistentes e export assíncrona (Fase 20).' },
  ],
}

// ─── Montagem ───────────────────────────────────────────────────────────────

/** Papéis que possuem guia de primeiros passos (ordem exibida no seletor). */
export const HELP_GUIDE_ROLES: Role[] = [
  'tenant_admin',
  'legislative_admin',
  'session_operator',
  'media_operator',
  'presiding_officer',
  'parliamentarian',
  'auditor',
  'platform_owner',
]

/** Conteúdo completo da Central de Ajuda (imutável por requisição). */
export function buildHelpContent(): HelpContent {
  return {
    guides: GUIDES,
    glossary: [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, 'pt-BR')),
    faq: FAQ,
    shortcuts: SHORTCUTS,
    changelog: CHANGELOG,
    about: ABOUT,
  }
}
