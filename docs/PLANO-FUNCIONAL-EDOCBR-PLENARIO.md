# Plano funcional de desenvolvimento — edocBR Plenário

> **Referência funcional inicial.** O [plano mestre vigente](PLANO-MESTRE.md) incorpora a decisão posterior de preparar sessões na web e conduzi-las em servidor desktop local; estados e ordem deste arquivo são históricos.

**Versão:** 1.0 · **Data:** 11/10/2026 · **Decisão de escopo:** concluir o ciclo próprio do plenário e a transmissão antes de integrar Nextcloud, Alfresco ou outros sistemas edocBR. **Câmara piloto:** Mucuri/BA, cujo cadastro atual é apenas institucional, sem fatos legislativos oficiais.

Este é o roteiro de implementação e aceite. O [plano diretor](PLANO-DESENVOLVIMENTO-PLENARIO.md) explica arquitetura e riscos; os [registros numerados](etapas/README.md) comprovam o que foi entregue. A existência de uma rota ou tela não significa homologação para uso oficial.

## Resultado esperado

A secretaria prepara a sessão e a pauta; a Presidência e o operador abrem o credenciamento e conduzem os trabalhos; vereadores registram presença e votam; telões e portal exibem apenas informação autorizada; a equipe audiovisual grava e transmite a mesma sessão; ao final, a Câmara confere resultado, ata, assinaturas e vídeo, com auditoria e publicação. O sistema consegue ensaiar e executar esse fluxo mesmo quando um destino de vídeo falha. A continuidade deliberativa sem internet depende de uma etapa própria de autoridade local e não é prometida pelo piloto atual.

## Papéis e separação de comando

| Papel | Responsabilidade principal |
|---|---|
| Administração da Câmara | Cadastro da Casa, legislatura, mandatos, permissões, política regimental e retenção. |
| Secretaria legislativa | Criar sessão, montar e revisar pauta, registrar documentos, preparar ata e publicação. |
| Presidência | Confirmar abertura, condução, questões de ordem, votação, resultado e encerramento. |
| Operador de sessão | Executar comandos autorizados pela Presidência, presença, fala, pauta e telões. |
| Vereador | Confirmar presença, consultar pauta, solicitar fala e votar apenas por sua identidade. |
| Equipe audiovisual | Câmeras, áudio, cenas, gravação e destinos sociais; sem permissão para alterar voto. |
| Auditoria | Consultar eventos, recontar e exportar evidência, sem editar fatos. |
| Cidadão | Acompanhar agenda, transmissão, resultados publicáveis, documentos e replay. |

Operador e Presidência têm permissões distintas; comandos sensíveis registram autor, hora, versão, dispositivo e justificativa quando cabível. Nenhuma sobreposição do vídeo pode mostrar voto secreto ou parcial ainda não liberado.

## Jornada e requisitos funcionais

| Momento | Funções que precisam estar completas | Condição de aceite |
|---|---|---|
| 1. Configurar a Casa | Legislatura, mandatos e suplência, partidos, Mesa, tipos de sessão, calendários, políticas regimentais versionadas (quóruns, maioria, impedimentos, desempate, voto da Presidência, prazos e fala), perfis e dispositivos. | Cenários reais do regimento de Mucuri são aprovados pela secretaria e assessoria jurídica; versão da regra fica vinculada à sessão. |
| 2. Criar sessão | Tipo, número/ano sem colisão, data/fuso, local, Presidência, secretaria, convocação, anexos, convidados, vínculo de legislatura e status rascunho. | Criar e editar rascunho não publica pauta; duas criações concorrentes não repetem número; cancelamento preserva histórico. |
| 3. Montar pauta | Seções, matérias e documentos, ordem, inclusões/retiradas/adiamentos, leitura, emendas, votação em bloco quando autorizada, prévia, aprovação e versão publicada. | Alteração após publicação gera nova versão/diferenças e aviso; ninguém altera silenciosamente a pauta recebida pelo público. |
| 4. Preparar operação | Checklist de operadores, dispositivos, telões, regra ativa, quórum, ensaio, rede, gravação e canais; bloqueios visíveis. | Sessão sem configuração mínima não abre como oficial; ensaio é marcado e não produz ato oficial. |
| 5. Credenciar presença | Identidade própria do vereador, dispositivo, entrada/saída/retorno, licenças/impedimentos, conferência manual justificada, lista em tempo real. | Quórum de instalação e de cada deliberação é calculado a partir de membros elegíveis, com snapshot, transições auditadas e teste de concorrência. |
| 6. Abrir e conduzir | Abertura, suspensão, retomada, encerramento, pauta corrente, questões de ordem, inscrição e fila de oradores, aparte quando permitido, cronômetros, alertas e histórico. | Um comando vale uma vez; reconexão recompõe o mesmo estado; telões mostram versão e sinalização de atraso. |
| 7. Deliberar | Leitura, discussão, encaminhamento, pedido de vista, destaque, retirada, adiamento, votação em bloco, ordem de votação e seus impedimentos regimentais. | Cada decisão altera o item certo e preserva o motivo; uma votação ativa por âmbito regimental definido. |
| 8. Votar | Nominal, simbólica e secreta apenas após homologação específica; elegibilidade, quórum, opções regimentais, abertura, pausa, retomada, encerramento, alteração de voto permitida, voto da Presidência e desempate. | Idempotência e controle de versão impedem perda/duplicação; resultado é determinístico, recontável e comparado com cenário aprovado pela Câmara. |
| 9. Conferir resultado | Apuração por regra vinculada, abstenções/ausências, resultado e espelho, recibo nominal quando cabível, correção/anulação motivada, nova votação quando exigida. | Resultado encerrado é imutável; retificação referencia o fato anterior. Voto secreto não revela vínculo entre pessoa e escolha. |
| 10. Encerrar e publicar | Relatório da sessão, minuta de ata, revisão humana, assinaturas conforme exigência da Casa, publicação do ato, portal acessível, dados abertos e gravação/replay com marcadores. | Ata e vídeo têm versões, checksums e vínculo com sessão; publicação só após autorização; exportação e verificação de autenticidade funcionam. |

### Regras críticas a não presumir

O piloto tem quórum mínimo e maiorias genéricas. Antes de uso oficial, cada tipo de sessão e deliberação deve apontar para uma política regimental versionada, com casos de teste assinados pela Casa. O voto secreto atual persiste escolha associada ao parlamentar no banco; portanto, a modalidade ficará **desabilitada para uso oficial** até que desenho de sigilo, auditoria e recontagem seja aprovado e implementado. Votação simbólica com contagem digitada exige confirmação por dois papéis ou método equivalente homologado. A Presidência não pode substituir resultado encerrado por edição direta.

## Transmissão ao vivo, gravação e redes sociais

**Escolha técnica inicial:** câmeras e mesa de som chegam a um encoder local; OBS Studio compõe cenas e sobreposições aprovadas, produz um sinal único e grava localmente. MediaMTX recebe o sinal e encaminha a destinos independentes, preferencialmente por RTMPS onde suportado. O sistema edocBR Plenário orquestra intenção e mostra estado observado, sem processar voto dentro da cadeia de vídeo. Essa escolha aproveita a base já implementada, mas depende de teste com câmeras, áudio, rede e contas da Câmara. [OBS documenta cenas e fontes](https://obsproject.com/kb/OBS-Studio-Overview); [MediaMTX documenta encaminhamento](https://mediamtx.org/docs/features/forward) e [métricas](https://mediamtx.org/docs/features/metrics).

| Subfase | Funções | Evidência obrigatória |
|---|---|---|
| Preparação | Cadastro de destino por Câmara com segredo em cofre; evento social programado/manual; título, descrição, privacidade, miniatura; checagem de câmera, mesa de som, codec, upload, espaço e prévia não listada. | Checklist gravado, sinal de teste com áudio, autorização e URL pública confirmada por operador. |
| Produção | Cenas predefinidas (abertura, orador, plenário, pauta, intervalo, encerramento), troca manual por operador audiovisual, sobreposições alimentadas só por estado publicável, tela de contingência. | Nenhum dado protegido aparece no vídeo; transição de cena não altera fatos da sessão. |
| Distribuição | Liga/desliga por destino, conexão/reconexão independente, estado desejado versus observado, tentativas limitadas, motivo de falha sanitizado. | Queda de uma rede não derruba outra nem interrompe votação; ação duplicada não cria dois encaminhamentos. |
| Monitoramento | Prévia local, estado de ingestão, bitrate calculado, quadros com erro/perda, áudio mudo/baixo, saúde de disco, tempo sem sinal, retorno externo do canal quando API/permissão permitirem. | Painel diferencia “sinal local”, “enviado ao destino” e “visível ao público”; alarmes chegam ao operador em ensaio de falha. |
| Gravação e replay | Original local contínuo, segmentos/manifesto, checksum, duração, codecs, recuperação após interrupção, cópia preservada e derivado para publicação com marcadores. | Arquivo completo reproduzível, áudio sincronizado, conferência de checksum, retenção e publicação autorizadas. |

**Primeiro destino:** um canal institucional a escolher pela Câmara; YouTube é candidato técnico inicial porque documenta uso de encoder externo, chave/URL, configuração e monitoramento. A ativação do canal pode levar tempo e a saúde da ingestão não prova, por si só, que o público assiste: o piloto deve verificar também a página pública. As configurações de codec, taxa e RTMPS serão calibradas após medir a rede local, conforme [orientações oficiais do YouTube](https://support.google.com/youtube/answer/2907883?hl=en) e [parâmetros de encoder](https://support.google.com/youtube/answer/2853702?hl=en). Facebook, Instagram e outras plataformas entram uma a uma após verificar recursos, regras da conta e mecanismo atual de transmissão; não se promete suporte universal por uma mesma chave.

O botão de iniciar transmissão não abre a sessão legislativa. A transmissão pode começar antes da abertura formal e terminar depois do encerramento. Se a WAN cair, a gravação local prossegue; o painel exibe “sem público ao vivo” e a sessão só continua deliberando se a arquitetura de autoridade local estiver homologada. Definir legendas ao vivo/revisadas, Libras e retenção com a Câmara; transcrição automática é rascunho revisável.

## Pacotes de desenvolvimento em ordem de dependência

| Pacote | Escopo e entregável testável | Dependência para sair |
|---|---|---|
| P0 — Contrato regimental e jornada | Oficina com Mucuri, matriz de casos (ordinária/extraordinária, quóruns, desempate, impedimento, simbólica/nominal/secreta), inventário de hardware e canais, protótipos de Mesa/vereador/telão. | Aceite escrito dos cenários e responsáveis. Sem isso, políticas permanecem apenas de ensaio. |
| P1 — Fundação operacional | PostgreSQL e migrações revisáveis, isolamento de tenant, autenticação/MFA e dispositivos, CI, backups/restauração, observabilidade, conjunto E2E mínimo. | Testes em ambiente limpo e restauração comprovada; demo isolado. |
| P2 — Configuração da Casa | Legislatura/mandatos, políticas regimentais versionadas, permissões por ato, configuração de sessão oficial versus ensaio. | Testes de regras para todos os cenários P0 e bloqueio de configuração incompleta. |
| P3 — Preparação de sessão | Formulário completo, rascunho, numeração concorrente, pauta versionada, revisão/publicação, convocação e checklist. | Sessão criada, revisada e convocada em ensaio com trilha íntegra. |
| P4 — Presença e condução | Credenciamento, quóruns por momento, console da Mesa, fala/crônometro, telões, reconexão e acessibilidade. | Ensaio da abertura até discussão, incluindo queda/retorno de uma tela. |
| P5 — Votação nominal e simbólica | Serviço canônico de elegibilidade/apuração, voto próprio, dupla confirmação simbólica, resultado, recontagem e retificação. | Testes de concorrência/carga e 100% dos cenários P0 conferidos pela Câmara. |
| P6 — Sigilo e continuidade | Modelo de ameaça e implementação de voto secreto, quando aprovado; autoridade local exclusiva, fila e reconciliação após WAN, ensaios de energia/rede. | Revisão independente de sigilo e ensaio sem divergência; modalidades não aprovadas seguem bloqueadas. |
| P7 — Transmissão social | Checklist AV, OBS/encoder, MediaMTX, primeiro canal, monitoramento externo, alertas, gravação e replay; depois segundo canal. | Sessão simulada longa com áudio, vídeo, falhas induzidas e gravação íntegra. |
| P8 — Ata, transparência e piloto | Relatórios, revisão/assinatura/publicação, portal, acessibilidade, treinamento, runbooks e sessões assistidas. | Aceites legislativo, técnico, audiovisual, jurídico e operacional registrados. |
| P9 — Integrações edocBR | **Somente após P0–P8:** contratos e conectores Nextcloud/Alfresco, referências externas, reconciliação, outbox e execução paralela. | Fonte de verdade aprovada, testes de homologação e reversão; ver [arquitetura de integração](integracoes/arquitetura-edocbr.md). |

P4/P5 e a preparação técnica de P7 podem avançar em paralelo após P2, mas o aceite de P8 requer o fluxo inteiro. Prioridade imediata: **P0 e P1**, seguidos do conjunto P2–P5. A integração P9 não entra no caminho crítico do desenvolvimento funcional. Estimativa só deve ser fechada após P0; o plano diretor registra uma faixa preliminar de meses para equipe dedicada, sem compromisso de data para uso oficial.

## Evidências e indicadores para cada entrega

Cada pacote gera: decisão de domínio/ADR quando necessária, contrato de API e eventos, migração aditiva, teste de regra, integração, E2E da jornada, checklist de acessibilidade, ensaio de falha, manual do papel afetado e registro numerado em `docs/etapas/` com estado, evidência e próxima dependência. Nada recebe “concluído” só por existir tela.

Indicadores: zero voto perdido/duplicado nos ensaios definidos; recontagem igual ao resultado; 100% dos cenários regimentais homologados; tela recomposta após reconexão; tempo de atualização e detecção de falha medidos; áudio/vídeo e arquivo final íntegros; restauração e isolamento entre Câmaras comprovados. Metas numéricas de latência/disponibilidade e duração do ensaio serão acordadas após medir a infraestrutura de Mucuri.
