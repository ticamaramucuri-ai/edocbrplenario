# Plano diretor do plenário eletrônico

> **Plano diretor inicial.** Para escopo, status e sequência vigentes, use o [plano mestre](PLANO-MESTRE.md) e o [índice documental](README.md).

**Versão:** 1.1 · **Data:** 11/10/2026 · **Base analisada:** código e documentação deste repositório.  
**Objetivo:** transformar o piloto atual em uma plataforma confiável para condução e transmitir ao vivo sessões de Câmaras Municipais e, em seguida, integrá-la ao fluxo legislativo já usado pela organização.

**Prioridade atual:** o [plano funcional detalhado](PLANO-FUNCIONAL-EDOCBR-PLENARIO.md) organiza a implementação da sessão, votação, transmissão, ata e piloto. Por decisão do projeto, os conectores Nextcloud/Alfresco ficam para a última fase, depois da validação funcional do Plenário.

**Execução:** entregas e próximas etapas verificáveis em [docs/etapas/](etapas/README.md). As etapas [001](etapas/001-seguranca-acesso-midia.md) e [002](etapas/002-qualidade-e-prova-transmissao.md) iniciaram segurança, qualidade e prova local RTMP→RTMPS; [003](etapas/003-painel-transmissao-local.md), [004](etapas/004-destinos-rtmps.md) e [005](etapas/005-gravacao-e-resiliencia.md) acrescentaram painel, destinos por Câmara e catálogo de gravação; [006](etapas/006-intencao-reconciliacao-midia.md) criou intenção durável e worker de reconciliação; [007](etapas/007-saude-operacional-midia.md) acrescentou sinal de vida e verificação local; [008](etapas/008-concorrencia-destinos-midia.md) protegeu alterações concorrentes de destinos na mesma sessão. O diagnóstico abaixo registra o estado encontrado no início; o estado atual de cada correção está nos registros numerados.

## 1. Diagnóstico executivo

O piloto já contém um conjunto valioso: cadastro de sessões e pauta, máquina de estados, presença e quórum, votação nominal/simbólica/secreta, discursos, telão, portal público, outbox, auditoria, relatórios, PWA parlamentar e importador legado. A base usa Next.js/React/TypeScript, Prisma/SQLite e serviços Bun para tempo real, webhooks e agendamento. Há decisões de domínio registradas em ADRs e contratos `/api/v1`.

O estado atual é de **piloto de demonstração**, ainda sem liberação para votação oficial. Evidências prioritárias:

1. `src/lib/server/actor.ts` aceita `x-actor-id` na falta de cookie: qualquer cliente que conheça um ID de usuário ativo pode assumir esse ator no modo de demonstração. Esse caminho deve ser removido do ambiente de produção, com separação comprovável por configuração e testes.
2. `mini-services/realtime/index.ts` permite entrar em `tenant:{tenantId}` quando o cliente informa `tenantId` e `scope: internal`, sem autenticação/autorização de sala. Os eventos internos exigem identidade e autorização verificadas no servidor.
3. `prisma/schema.prisma` usa SQLite; `src/lib/server/tx.ts` serializa escritas só dentro de um processo. Isso não sustenta várias réplicas, alta disponibilidade ou continuidade local coordenada.
4. `Vote.value` armazena valor associado ao parlamentar, inclusive no modo secreto. O sigilo atual é de apresentação e operação; o desenho de votação secreta precisa de revisão independente antes de uso oficial.
5. `package.json` contém `db:push --accept-data-loss`; há scripts de teste pontuais em `tests/`, mas nenhuma suíte automatizada de domínio/integração e nenhum diretório `.github/workflows` nesta cópia. O ADR-022 descreve CI, porém a implementação não está presente aqui.
6. `docs/runbook.md` descreve procedimentos e caminhos do sandbox e reconhece que votação não fecha sem API durante a perda de conexão. A promessa de operação offline ainda depende de arquitetura e exercícios reais.
7. Documentação e implementação divergem em pontos da Onda 5; antes da execução, consolidar uma única linha de base de requisitos, status e evidências.

## 2. Norte do produto

**Fluxo prioritário:** preparar sessão e pauta → credenciar parlamentares → iniciar transmissão e gravação → verificar quórum → conduzir discussão e fala → abrir/pausar/encerrar votações → apurar e publicar resultado → encerrar transmissão → gerar espelho/ata → assinar/publicar → disponibilizar vídeo, dados e evidências para consulta e auditoria.

**Perfis:** secretaria legislativa, operador de sessão, presidência, vereadores, equipe de áudio/vídeo, auditoria, administração da Câmara e cidadão. Cada perfil terá um cenário de uso validado presencialmente.

**Princípios funcionais:**

- Regras de quórum, maioria, impedimento, licença, desempate, voto da presidência, alteração de voto e tempos de fala são **políticas versionadas por Câmara e por sessão**, homologadas contra o regimento aplicável. Nenhum padrão genérico produz resultado oficial sem aprovação da Casa.
- A sessão tem uma única autoridade de comando; telas, telões e portal são projeções do estado confirmado. Cada comando traz ID idempotente, ator, dispositivo, versão esperada e carimbo de tempo.
- Toda correção posterior é uma retificação/anulação motivada e auditada. Resultado encerrado não é editado silenciosamente.
- O operador recebe feedback inequívoco: comando recebido, confirmado, rejeitado ou pendente; estado da rede; quórum; votação em curso; confirmação dupla para encerramento/anulação.
- Inteligência artificial só prepara rascunhos de ata, transcrição e indexação; revisão humana permanece obrigatória.

## 3. Escopo de produto por capacidade

| Capacidade | Entrega alvo |
|---|---|
| Preparação | Tipos de sessão, pauta versionada/publicada, anexos, presidência/secretaria, convocação e ensaio da sessão. |
| Presença e quórum | Credenciamento por identidade e dispositivo, entradas/saídas, licenças e impedimentos, cálculo em tempo real e snapshots por deliberação. |
| Discussão | Fila de oradores, inscrições, apartes quando regimentalmente previstos, cronômetros, avisos sonoros e eventos para transmissão. |
| Votação | Nominal, simbólica e secreta conforme norma local; políticas de maioria e elegibilidade; alteração/retificação; comprovantes; recontagem verificável. |
| Mesa e telões | Console dedicado à operação, visões para presidência e operador, perfis de telão, modo seguro em reconexão e integração com OBS/streaming por interfaces. |
| Transmissão ao vivo | Captura de câmeras e áudio do plenário, composição visual, envio simultâneo a canais sociais autorizados, monitoramento da qualidade, gravação local e publicação posterior do vídeo. |
| Documentos e transparência | Espelho, ata, publicação, verificação de autenticidade, portal acessível e dados abertos com limites claros de privacidade. |
| Administração | Perfis e permissões, configuração regimental versionada, auditoria, suporte, exportação, backup e restauração. |
| Integração posterior | Adaptadores para protocolo/tramitação, cadastro institucional, diário/publicação e fluxo existente; APIs e eventos versionados. |

**Fora do caminho crítico inicial:** expansão de faturamento, marketplace, NPS e novas funções de IA. Elas podem continuar no produto, mas não devem atrasar a confiabilidade do plenário.

## 4. Arquitetura e stack recomendadas

| Camada | Escolha e justificativa |
|---|---|
| Interfaces | Manter Next.js 16, React 19 e TypeScript estrito; reaproveitar componentes e contratos. Separar rotas e experiência de mesa, vereador, telão, portal e administração. |
| Domínio/API | Evoluir o backend existente para módulos claros de sessão, presença, votação, fala, documentos e auditoria. Extração para serviço dedicado apenas se testes de carga/operação mostrarem necessidade; preservar `/api/v1` durante a transição. |
| Dados | PostgreSQL com migrações versionadas, constraints, transações e política de isolamento por tenant testada. Manter Prisma inicialmente se viável; avaliar SQL explícito nas consultas e políticas complexas. |
| Eventos | Outbox transacional e consumidor persistente, com sequência/versão por sessão, replay, reconciliação por snapshot e autorização real em WebSocket. Redis pode servir a filas, locks e limites de taxa; não será fonte canônica do voto. |
| Arquivos | Armazenamento compatível com S3 para atas, anexos e evidências; checksum, versionamento, retenção e antivírus na entrada. |
| Identidade | Login institucional/OIDC onde disponível, MFA para funções críticas, sessão curta e revogável, RBAC com contexto da sessão e dispositivo credenciado. Ambiente demo isolado. |
| Continuidade local | Agente local em Rust/Tauri ou serviço local equivalente, com banco local transacional, identidade de dispositivo e autoridade exclusiva da sessão durante queda da WAN. A escolha final depende de prova de conceito com o hardware real. |
| Mídia ao vivo | Camada de produção separada do motor de votação: entrada de câmeras/mesa de som por SDI, HDMI, NDI ou IP conforme infraestrutura da Casa; encoder local (OBS ou hardware) com perfil validado; distribuição por um serviço de restream ou saídas independentes. Adaptadores por destino social, começando pelo canal homologado da Câmara. RTMPS quando suportado; contribuição SRT pode ser avaliada entre plenário e restream. |
| Operação | Contêineres, proxy reverso, observabilidade com OpenTelemetry, métricas e alertas, backup criptografado e restauração ensaiada. Kubernetes só quando a escala e a equipe justificarem. |
| Qualidade | Testes de regras puras, integração com PostgreSQL real, contratos de API/eventos, E2E dos caminhos críticos, carga e caos controlado. CI bloqueia lint, tipos, testes e migrações antes do deploy. |

**Voto secreto:** definir modelo de ameaça com especialistas, separar identidade/eligibilidade do conteúdo do voto, verificar independência entre trilhas e testar sigilo, coerção e recontagem. O mecanismo atual não deve ser tratado como garantia criptográfica de anonimato.

**Offline:** definir previamente quem pode ser autoridade da sessão. Na perda de internet, a operação local só prossegue quando a autoridade local é exclusiva e comprovada; ao reconectar, comandos são sincronizados com IDs e sequência monotônica, conflitos bloqueiam publicação automática e exigem reconciliação auditada. Telões e PWA exibem a origem e a atualidade do estado.

### Transmissão da sessão para redes sociais

O sistema deve oferecer um **Painel de Transmissão** à equipe de comunicação, ligado à sessão: preparar canais, checar sinal, iniciar/parar, acompanhar a saúde de cada destino e registrar incidentes. Os botões de transmissão não alteram o estado deliberativo; uma queda de vídeo não pode bloquear presença ou votação. A mesa controla quais dados legislativos aparecem como sobreposição, e o operador de mídia controla câmera, áudio e envio.

- **Antes:** programar evento e metadados (título, descrição, data, imagem, link público), escolher canais autorizados, validar credenciais, áudio, vídeo, enquadramento, nível de som, upload e gravação; fazer ensaio privado/não listado quando o destino oferecer essa opção. Chaves de transmissão ficam em cofre de segredos, com acesso restrito e rotação.
- **Durante:** captar câmeras e microfones, alternar cenas, inserir identificação da Câmara/sessão/orador e sobrepor pauta, quórum e resultado já publicável. Nunca expor voto secreto individual ou resultado parcial oculto. Exibir prévia local e retorno real de cada rede, com bitrate, perda de quadros, reconexões, duração e alerta de áudio mudo. Permitir ação manual de contingência sem interromper a sessão.
- **Depois:** encerrar cada destino com confirmação, guardar gravação local íntegra com checksum e metadados, vincular vídeo à sessão, publicar replay no portal e permitir marcadores de pauta/discursos/votações. Definir retenção e edição de trechos conforme política documental da Câmara; registrar correções sem substituir silenciosamente o arquivo de origem.
- **Múltiplas redes:** manter um adaptador por plataforma e uma tabela de destinos/status; começar pelo canal prioritário da Câmara (por exemplo, YouTube) e expandir para outras redes após validar requisitos de conta, API, ingestão e permissões atuais de cada uma. Uma falha isolada em uma rede não derruba os demais destinos; retry tem limite e é visível ao operador.
- **Acessibilidade:** prever legendas ao vivo e revisadas no replay, janela de Libras quando exigida/contratada, identificação textual de cenas e player acessível. As legendas automáticas exigem supervisão e correção humana antes de compor registro oficial.
- **Contingência:** gravação local segue durante queda de internet; o painel informa claramente que o público perdeu o sinal, tenta restabelecer destinos e permite divulgar replay depois. Testar perda de WAN, falha de encoder, troca de câmera/microfone, interrupção de uma rede e exaustão de espaço local.

No YouTube, a documentação oficial descreve o uso de encoder externo para câmeras e áudio, URL/chave de transmissão, parâmetros de ingestão e monitoramento da saúde do stream. Esses parâmetros devem ser verificados na implantação, pois requisitos de plataformas podem mudar: [criar transmissão com encoder](https://support.google.com/youtube/answer/2907883?hl=pt-BR) e [configurações de encoder](https://support.google.com/youtube/answer/2853702?hl=en).

## 5. Segurança, conformidade e acessibilidade

- Fazer revisão de ameaça dos fluxos de voto, presença, administrador, suporte, arquivos, webhooks e tempo real; corrigir os dois vetores de acesso acima antes de qualquer piloto com dados reais.
- Garantir isolamento entre Câmaras em API, banco, eventos, arquivos, busca, relatórios e exportações. Em PostgreSQL, testar RLS com conta de aplicação sem privilégio de contorno.
- Registrar auditoria imutável em armazenamento separado ou com custódia externa, assinaturas/chaves versionadas e retenção definida. Hash em banco isoladamente não prova autenticidade perante um administrador do banco.
- Fazer inventário de dados pessoais, base legal, finalidade, prazo de retenção, perfis de acesso e tratamento de incidentes com a assessoria jurídica/encarregado da Câmara. Orientação de referência: [ANPD — tratamento de dados pelo Poder Público](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_tratamento_de_dados_pessoais_pelo_poder_publico).
- Definir com cada Câmara o nível jurídico exigido para atas/documentos. O HMAC do piloto não equivale automaticamente à assinatura eletrônica avançada ou qualificada; consultar as modalidades do [ITI](https://www.gov.br/iti/pt-br/acesso-a-informacao/perguntas-frequentes/certificacao-digital).
- Adotar WCAG 2.2 AA como meta técnica e conferir adequação ao [eMAG 3.1](https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/acessibilidade-digital/modelo-de-acessibilidade), com teste por teclado e leitor de tela no console e portal.

## 6. Fases, duração indicativa e critérios de saída

As durações pressupõem uma equipe dedicada de produto/UX, 2–3 engenheiros de aplicação, engenharia de dados/infra, QA e apoio de audiovisual, além de representante da secretaria legislativa e da presidência. Há sobreposição entre fases; a antiga faixa de **7 a 10 meses** era uma estimativa inicial e será recalibrada após a descoberta regimental e audiovisual de Mucuri. Integrações externas não são pré-requisito do piloto funcional.

| Fase | Janela | Entregas | Saída verificável |
|---|---:|---|---|
| 0. Descoberta e baseline | 2–4 semanas | Inventário de fluxos e projetos existentes, entrevistas, matriz regimental por Câmara, mapa de dados, câmeras, áudio, internet e canais sociais, métricas de referência, backlog priorizado. | Jornada completa validada por operador, presidência, secretaria e comunicação; decisões regimentais assinadas pela Casa. |
| 1. Segurança e fundação | 4–6 semanas | Desligar demo em produção, autenticar WebSocket, corrigir tipos/CI, migrações, PostgreSQL e isolamento, observabilidade e backups. | Pentest direcionado sem falhas críticas/altas abertas; CI obrigatório; restauração testada; testes de isolamento entre tenants. |
| 2. Núcleo deliberativo | 6–8 semanas | Políticas regimentais versionadas, presença/elegibilidade, máquinas de estado, votação e auditoria refatoradas; ensaios de concorrência. | Cenários e resultados aprovados por Câmara; zero votos duplicados/perdidos em carga definida; recontagem bate com registro canônico. |
| 3. Experiência de plenário e mídia | 6–8 semanas | Mesa operativa, visão da presidência, PWA, telões, fala, reconexão, painel de transmissão, encoder e primeira rede social; acessibilidade. | Sessão simulada com vídeo/áudio e gravação íntegra; operadores concluem tarefas críticas e identificam falhas de sinal. |
| 4. Continuidade e transmissão ampliada | 6–10 semanas indicativas | Prova de autoridade local, recuperação após WAN, mais destinos sociais homologados, gravação/replay. | Ensaio de queda de WAN/energia com retomada sem divergência e gravação local preservada. |
| 5. Piloto e liberação | 4–6 semanas | Paralelo em 1 Câmara, sessões assistidas, treinamento, runbook, suporte, ajustes e homologação formal. | Critérios de serviço cumpridos por sessões consecutivas; aceites funcional, técnico, jurídico e operacional registrados. |
| 6. Integração ao ecossistema edocBR | Estimar após o piloto | Adaptadores para Nextcloud, Alfresco/GED e outros fluxos existentes, importação com prévia e reconciliação. | Execução paralela, conciliação de origem/destino, reversão ensaiada e aceite dos donos de cada sistema. |

## 7. Indicadores e portas de liberação

Metas iniciais a calibrar na Fase 0: nenhuma divergência de apuração em ensaios; 100% dos comandos críticos com resultado confirmado ou rejeição explícita; reconexão com estado correto após falha; p95 de atualização do telão abaixo de 2 segundos na rede local; restauração comprovada dentro do RTO/RPO contratado; 100% de cenários regimentais homologados automatizados; zero falha crítica/alta de segurança aberta; WCAG 2.2 AA nos caminhos essenciais. Para mídia, medir disponibilidade por destino, tempo de detecção/recuperação, áudio presente, quadros perdidos e integridade da gravação; alvos numéricos serão definidos após medir a internet e o equipamento da Câmara. A sessão oficial só é liberada com evidências do ensaio de offline, transmissão e gravação em falhas controladas, backup/restauração, carga do número real de vereadores/dispositivos e aceite dos responsáveis da Casa.

## 8. Integração ao fluxo existente

Na Fase 0, registrar somente as necessidades e limites de dados para não criar um modelo incompatível. Após o piloto funcional, na Fase 6, catalogar as fontes de verdade para parlamentar/mandato, proposição, protocolo, pauta, documentos e publicação; definir identificadores estáveis, dono de cada dado, frequência de sincronização e regras de conflito. Só então implementar adaptadores versionados, importação com prévia, reconciliação, execução paralela e reversão ensaiada. O plenário produz fatos deliberativos confirmados; o fluxo legislativo recebe esses fatos por eventos idempotentes, sem editar diretamente a votação encerrada.

## 9. Primeiros pacotes de trabalho

1. Criar matriz dos fluxos reais e das regras regimentais de uma Câmara piloto; escolher uma sessão ordinária e uma extraordinária como casos de referência.
2. Corrigir a autenticação do tempo real e isolar definitivamente o modo demo da produção.
3. Montar CI com `tsc` como gate, testes do motor de votação e integração com PostgreSQL; trocar `db:push --accept-data-loss` por migrações revisáveis para ambientes reais.
4. Desenhar o protocolo de continuidade local e fazer prova de conceito em uma rede/hardware de plenário.
5. Revisar o modelo de voto secreto e de assinatura de ata com especialistas técnicos e jurídicos antes de ampliar essas funcionalidades.
6. Inventariar câmeras, mesa de som, rede, banda de upload e contas sociais da Câmara piloto; ensaiar transmissão e gravação com uma sessão simulada.

**Decisões pendentes para a descoberta:** quais Câmaras e regimentos entram primeiro; quais sistemas já são fonte de cadastro/protocolo/publicação; quais redes sociais e contas institucionais serão usadas; exigências de câmeras, áudio, internet e legendagem; modalidade de assinatura exigida; orçamento/equipe e nível de serviço contratado. São decisões de homologação, não lacunas a preencher com padrões universais.
