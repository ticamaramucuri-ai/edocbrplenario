# Plano mestre de desenvolvimento — edocBR Plenário

**Versão:** 2.0 · **Base de verificação:** 10/11/2026 · **Estado:** plano vigente do produto. Esta revisão incorpora o [parecer comparativo do PainelDesk](../reports/parecer-comparativo-paineldesk-edocbr-2026-11-10.docx) e substitui a prioridade e o estado da versão de 07/11. O [índice documental](README.md) explica a hierarquia das fontes.

## 1. Resultado que o produto deve entregar

O edocBR Plenário será um SaaS multi-Câmara para preparar sessões e documentos na web, conduzir os trabalhos com identidade e regras da própria Câmara, registrar presença, fala, votação e ata, operar telões e dispositivos parlamentares, transmitir e gravar a sessão e publicar somente os fatos aprovados. A operação de cada Câmara deve ser configurável, auditável e isolada.

O modelo alvo inclui **um servidor desktop local designado por Câmara**, em Windows ou Linux. Ele importa automaticamente da web a sessão completa e seus documentos, atende Mesa, parlamentares e telões na rede local, conduz os atos sob autoridade única e sincroniza eventos e arquivos com o SaaS. Se a internet da Câmara cair, uma sessão já preparada poderá continuar na LAN **somente depois** de o modo local passar por segurança, ensaio e aceite institucional. A transmissão para redes sociais precisa de internet; a gravação local continua durante a queda. [ADR-027](adr/ADR-027-saas-nucleo-local-operacao-offline.md) detalha a decisão.

**Ordem de produto acordada:** concluir o núcleo Plenário e o piloto antes de escrever nos serviços institucionais. Nextcloud, Alfresco, diretório e assinatura entram por contratos e conectores nas fases finais. O Plenário preserva a autoria e o resultado dos atos deliberativos; uma integração externa não pode comandar voto ou substituir um resultado encerrado.

**Conclusão do comparativo:** o PainelDesk empacotado evidencia uma jornada de sessão local com servidor no prédio, tablet, telão, presença, votação e fala. O edocBR tem alcance maior em preparação, governança e transparência, mas ainda não conduz uma sessão oficial por servidor local. Usar o PainelDesk como referência de fluxo de operação, migração e suporte; suas classes, rotas e instruções não comprovam correção regimental ou segurança, e seu código não deve ser copiado. A prioridade desta revisão é fechar a jornada **web → desktop → Mesa/parlamentares/telões → reconciliação → ata/portal**, com pré-voo e recuperação observáveis.

### Critérios de verdade

| Estado | O que comprova | O que ainda não comprova |
|---|---|---|
| Implementado | Código, contrato e teste automatizado no repositório | Uso em equipamento, rede e regimento reais |
| Ensaiado | Jornada reproduzida com dados fictícios e evidência | Aceite de uma Câmara para ato oficial |
| Homologado | Ensaio no ambiente alvo, comparação humana, responsáveis e aceite registrados | Disponibilidade futura sem monitoramento e rotina operacional |
| Em operação | Release identificada, suporte, alertas, backup, recuperação e revisão periódica ativos | Novas modalidades ou Câmaras sem seus próprios gates |

Uma tela, rota, CI verde ou resposta HTTP 200 não muda sozinha o estado para “homologado”. Cada gate abaixo precisa de versão, ambiente, participantes, resultado, falhas, correção e referência de evidência.

## 2. Estado verificável em 10/11/2026

O repositório está no commit `1422b5f` nesta revisão documental. O último SHA de staging explicitamente registrado em 09/11 na [meta de produção](META-PRODUCAO.md) era `7f15f65`; esta atualização não é nova promoção nem ensaio de sessão. Os [registros 058–075](etapas/README.md) documentam os incrementos locais posteriores ao estado de 07/11.

| Frente | Estado atual | Lacuna para uso real |
|---|---|---|
| SaaS web e multi-Câmara | Tenants, papéis, marca/configuração, cadastros, sessões, pauta, presença, voto nominal/simbólico, ata, portal, APIs, outbox e auditoria implementados e ensaiados em partes | Validar isolamento e operação prolongada com Câmaras, papéis e carga representativos; fechar regras institucionais |
| Infraestrutura | VPS dedicada de **homologação sintética** em `edocbrplenario.com.br`, PostgreSQL 16, Redis, app e workers, TLS, promoção local → GitHub → VPS com CI; transferência cifrada verificada em receptor independente | Backup agendado em destino durável, custódia de chave, alerta a responsável, comutação e metas de recuperação pactuadas |
| Monitoramento | Observador externo agendado verifica HTTPS, banco, app, realtime, webhooks e scheduler; parada controlada de webhooks foi detectada | Canal de notificação e escalonamento, histórico/SLO, correio quando configurado, host e disco |
| Recuperação | Pacote banco+arquivos conferido; app autenticado, PostgreSQL e mídia restaurados em computador independente com dados fictícios | Rotina recorrente e recuperação operacional após perda do host, com DNS, identidade, armazenamento e volume representativo |
| Mucuri | Cadastro público preparatório, fotos e identidade visual; pré-voo registra `automaticReady: false` | Conferência oficial de composição, regimento, responsáveis, usuários, comunicação, audiovisual e aceite |
| Audiovisual | RTMP/RTMPS, múltiplos destinos sintéticos, observação, gravação e replay ensaiados | Câmeras, mesa de áudio, banda, canal e chave institucionais; observação pública em outra rede |
| Desktop e offline | Manifesto/contexto congelado, importação e ACK, identidade do equipamento, CLI de sincronização e binário Linux exercitado; `.exe` Windows compilado sem execução nesse SO; diário local assinado e reserva transacional exclusiva em testes | Instalação/supervisão nos dois SO, API LAN/TLS, comandos locais, cercamento web, ACK de eventos e reconciliação; votação offline oficial permanece bloqueada |
| Integrações edocBR | Contrato proposto; API, webhooks e outbox genéricos existentes | Fonte de verdade e adaptadores Nextcloud/Alfresco/identidade/assinatura ainda não aprovados nem ativados |

As provas recentes estão em [recuperação independente](etapas/045-recuperacao-stack-postgres.md), [observador externo](etapas/045-observador-publico-externo.md), [deliberação em duas instâncias](etapas/049-deliberacao-postgres-duas-instancias.md) e [transmissão de laboratório](etapas/052-repeticao-laboratorio-transmissao-2026-11-05.md). O domínio público atual é **staging com tenant fictício**, não portal institucional de Mucuri.

## 3. Arquitetura alvo e limites de autoridade

```mermaid
flowchart LR
    S["SaaS multi-Câmara<br/>cadastro, pauta e documentos"] -->|pacote versionado e bytes com hash| L["Servidor desktop designado<br/>uma Câmara; Windows/Linux"]
    L -->|snapshot, eventos e documentos na LAN| D["Mesa, parlamentares e telões"]
    D -->|comandos idempotentes com ACK persistido| L
    L -->|eventos ordenados, arquivos e ACK| S
    L -->|sinal quando há internet| R["OBS/encoder, MediaMTX e redes sociais"]
    L -->|sempre que há energia e armazenamento| G["gravação local e replay"]
    S -.->|após piloto, por contrato| I["Nextcloud, Alfresco e identidade"]
```

1. **SaaS central:** Next.js/React/TypeScript, domínio transacional e Prisma/PostgreSQL. Redis e workers separados sustentam tempo real, filas, webhooks, agenda e correio. Cada tabela, arquivo, evento, chave e job deve ter escopo de Câmara comprovado. A VPS atual é ponto de partida; capacidade para várias Câmaras exige medição antes de expansão.
2. **Preparação web:** secretaria cadastra toda sessão, matéria, pauta, convocação e documento na web. Revisões são imutáveis e associadas à configuração regimental aprovada. O desktop não cria pauta oficial autônoma durante ausência de internet.
3. **Servidor local:** serviço independente da janela do operador, uma Câmara por instalação, banco e acervo locais, API e tempo real na LAN. Um único desktop detém a autoridade de cada sessão; o centro rejeita mutações concorrentes enquanto a autoridade local vigora. Promoção de reserva exige bloquear o anterior e conferir o último evento confirmado.
4. **Dispositivos:** interface responsiva/PWA servida pelo desktop. PDFs podem ser cacheados para leitura; presença, fala e voto só valem após ACK persistido pela API local. Reconexão usa cursor e snapshot quando houver lacuna. Dispositivo isolado do servidor não produz ato oficial.
5. **Sincronização:** web → desktop envia manifesto, revisão e todos os bytes necessários com SHA-256; desktop → web envia sequência por sessão, ator/dispositivo, `commandId`, auditoria e arquivos com hash. ACK durável, deduplicação e quarentena de conflito; nunca “última gravação vence” para voto. O portal sinaliza horário e atraso da última sincronização.
6. **Audiovisual:** operador audiovisual controla encoder/OBS e MediaMTX; o Plenário distingue sinal local, ingestão remota e página pública observada. Link social só é publicado após checagem de vídeo **e áudio** fora da rede da Câmara. Voto e apuração não dependem do pipeline de vídeo.

**Stack desktop a decidir por protótipo:** o ADR-027 propõe avaliar Tauri 2 para a janela/instalador; o serviço deve sobreviver ao fechamento da janela. Comparar PostgreSQL e SQLite locais com concorrência, falha de energia, backup, assinatura de instalador e operação Windows/Linux antes de fixar a escolha. Nenhum banco será replicado por cópia de tabelas entre centro e Câmara. TLS e endereço LAN sem DNS externo, identidade de dispositivo, credencial offline com prazo, revogação, criptografia em repouso e backup conjunto são requisitos de entrada, não melhorias opcionais.

### Jornada operacional obrigatória

1. **Preparar na web:** secretaria publica revisão de pauta, documentos, composição e regra versionada; o desktop baixa todos os bytes, confere hashes e expõe divergências.
2. **Fazer pré-voo:** Mesa vê revisão pronta, quórum/regra, identidade e conectividade dos dispositivos, telões, gravação, autoridade, backup e pendências. Bloqueio de ato oficial informa o motivo e a ação necessária.
3. **Conduzir na LAN:** um servidor designado confirma presença, fala, voto e transições do telão. O parlamentar recebe recibo inequívoco; a Mesa vê o que foi confirmado e o estado de cada dispositivo.
4. **Recuperar falhas:** queda de WAN não troca a autoridade; dispositivo sem LAN não vota; perda do servidor exige suspensão ou promoção controlada da reserva. Revisão web nova durante a sessão fica pendente de incorporação formal.
5. **Reconciliar e publicar:** eventos e arquivos seguem em sequência com ACK e quarentena de divergência. Resultado, ata, assinatura aplicável, retificação e conteúdo público passam por conferência e autorização próprias.

O ensaio principal deve percorrer essa jornada inteira com dados fictícios antes do piloto oficial. A interface deve servir à secretaria, à Mesa, ao parlamentar e ao telão com composições específicas, inclusive leitura à distância e recuperação de conexão.

## 4. Plano de execução em ordem de dependência

Os identificadores **P0–P13** são mantidos para preservar a rastreabilidade. A prioridade prática é fechar **P4–P7 com P1/P10**, enquanto P2/P3 recebem validação da Câmara; P8/P9 completam a sessão e P11 libera o piloto. A [meta de produção](META-PRODUCAO.md) agrupa os gates em marcos verificáveis. Tarefas independentes podem avançar em paralelo; o gate de uso oficial exige todos os predecessores aplicáveis.

| Fase | Estado e correspondência | Entrega de desenvolvimento | Gate de saída verificável |
|---|---|---|---|
| **P0 — linha de base** | Organização documental concluída; esta revisão atualiza prioridade e estado | Manter plano, índice, matriz e CI coerentes com cada SHA promovido | Referências, CI e evidência concordam com a release identificada |
| **P1 — operação SaaS** | Em homologação técnica; 045; transferência cifrada e verificada off-host aprovada em staging | Destino durável e custódia de chave; agenda, retenção, verificação e teste periódico; alerta externo com responsável; carga/falhas, logs, segurança e runbook de comutação | Recuperação completa a partir de cópia durável em host novo, RTO/RPO e capacidade medidos contra metas pactuadas, nenhum dado de Câmara real em staging sintética |
| **P2 — configuração por Câmara** | Código parcial; 046 | Onboarding configurável de marca, legislatura, mandatos, Mesa, partidos/emblemas, quóruns, maiorias, impedimentos, prazos, papéis, retenção, publicação, mídia e recursos por plano; revisão imutável | Dois tenants com regras e aparência distintas, negativos de acesso, matriz regimental e composição aprovadas por cada Câmara |
| **P3 — preparação web** | Código/ensaios parciais; 047/066; PDF privado por matéria em ensaio | Criar sessão, numeração concorrente, matérias, documentos, versões da pauta, convocação, entrega/ciência e prontidão; quota por Câmara e sanar anexos externos não baixados | Sessão fictícia completa com bytes e hashes verificáveis, revisão publicada e comprovante do canal de comunicação; nenhuma alteração silenciosa |
| **P4 — contrato do núcleo local** | Manifesto/contexto congelado, importador, assinatura, identidade, download, ACK, retomada, retenção e diário sequenciado/assinado ensaiados; etapas 050/058–070/072 | Extrair comandos determinísticos reutilizáveis; concluir quota agregada, custódia de chaves, contrato de eventos/retorno e conflitos | Mesmos casos de presença/voto/ata têm o mesmo resultado em executores web/local; pacote adulterado e Câmara alheia são recusados |
| **P5 — desktop e distribuição LAN** | CLI contínua, credencial Linux protegida, inventário verificado, binário Linux exercitado e `.exe` Windows compilado sem execução; etapa 071 | Instalar/supervisionar nos dois SO; serviço independente da janela, banco/acervo, API LAN/TLS, login, snapshots, documentos e pré-voo para Mesa, tablets e telões | Instalação limpa nos dois SO; fechar a janela não interrompe o serviço; pacote incompleto bloqueia abertura; três classes de dispositivo e duas TVs recompõem o estado |
| **P6 — autoridade e sincronização** | Contrato assinado, diário local e reserva transacional exclusiva em ensaio, inclusive três processos PostgreSQL; etapas 072/073/075. Nenhum ato local ainda | Cercar escritores web, expor concessão, persistir maior época no desktop, executar comandos, outbox/ACK, dedupe, arquivos, reconciliação e promoção controlada de reserva | Perda/retorno de WAN, LAN, SaaS e energia não duplicam nem perdem atos confirmados; não há segundo escritor; conflito entra em quarentena e portal informa atraso real |
| **P7 — plenário e votação** | Web ensaiada; local pendente; 048–050 | Presença, suplência, impedimento, quórum por ato, fala, telão, nominal/simbólica, recibo, apuração e anulação no executor autorizado; acessibilidade e recomposição | 100% dos casos regimentais aprovados conferidos por cálculo humano independente; duas telas e dispositivos reais; isolamento entre Câmaras; offline só após gate P6 |
| **P8 — ata e transparência** | Fluxo web parcial; 051 | Fechamento, minuta, revisão, assinatura aplicável, retificação, publicação segregada, portal, dados abertos e vínculo ao replay; centro só publica após reconciliação local | Texto/versão/hash/autoria conferidos; publicação autorizada por segundo papel; conteúdo público e retenção aprovados |
| **P9 — transmissão e gravação** | Laboratório sintético; 052 | Câmera/áudio→encoder/OBS→MediaMTX→RTMPS, dois destinos, perda/retorno, monitoramento, gravação local, replay e observação pública | Áudio e vídeo vistos em outra rede, queda de um destino não afeta voto nem outro destino, replay íntegro e operador assina a prova |
| **P10 — segurança e operação local** | Planejado; 045/050 | Instalação assinada, atualização/rollback fora de sessão, proteção de chave/banco, backup local, certificado LAN, revogação de dispositivo, teste de invasão e recuperação de desktop | Windows/Linux e reserva ensaiados; nenhuma dupla autoridade; incidentes e suspensão documentados; revisão de segurança aprovada |
| **P11 — piloto assistido** | Preparado, não iniciado; 053 | Mucuri: dados e regras aprovados, contas nominais, equipamentos, treinamento, sessão fictícia longa e sessão assistida com suporte e plano de suspensão | Pré-voo coerente, aceites técnico, legislativo, jurídico, acessibilidade e audiovisual; qualquer falha bloqueante reabre o gate |
| **P12 — integrações edocBR** | Planejado para após P11; 054–056 | Fonte de verdade por campo/ato; leitura Nextcloud e Alfresco com ACL e ID estável; entrega aprovada por outbox, ACK, hash, retry/dedupe, reconciliação e reversão; identidade/assinatura por contrato | Fluxo em homologação com negativos entre tenants, divergências visíveis e aceite TI + secretaria; indisponibilidade externa não altera votação |
| **P13 — expansão SaaS** | Planejado; 057 | Onboarding repetível, migrações por tenant, observabilidade/SLO, suporte auditável, treinamento, capacidade multi-Câmara, faturamento e contratos operacionais | Segunda Câmara entra sem código específico e sem vazamento; restauração e releases periódicos comprovados |

### Gates transversais de cada entrega

- **Produto:** história do papel afetado, erro e estado de recuperação, acessibilidade, desktop/móvel/telão e instrução de uso atualizada.
- **Operação da Mesa:** ação principal por estado, razões para bloqueio, prévia do telão, quórum, revisão, recibos, dispositivos atrasados e último backup/sincronização visíveis sem consultar logs.
- **Domínio:** migração aditiva e reversível quando houver, configuração por Câmara, auditoria, idempotência, versionamento e casos de regra negativos.
- **Segurança:** autenticação e autorização no servidor, dois tenants nos testes, tratamento de segredos, logs sem dados sensíveis, cadeia de confiança dos arquivos e dispositivos.
- **Operação:** ambiente limpo, falha/retorno, backup/restore quando mexer em estado durável, observador externo, release por SHA e plano de reversão.
- **Evidência:** teste automatizado relevante, ensaio reproduzível, limite do teste, responsável pela conferência humana e decisão de aceite quando o ato for oficial.

## 5. Sequência de releases e definição de pronto

| Marco | Pode fazer | Não deve ser anunciado como |
|---|---|---|
| **R0 — laboratório** | Dados fictícios, demos e testes locais | Sessão oficial ou continuidade offline |
| **R1 — staging SaaS** | Homologar infraestrutura e funções conectadas em VPS sintética | Produção multi-Câmara, backup contratual ou aceite de Mucuri |
| **R2 — piloto local** | Sessão fictícia completa importada e conduzida por desktop em ambiente de teste, inclusive quedas controladas | Operação offline oficial antes dos gates P5/P6/P7/P10/P11 |
| **R3 — piloto institucional assistido** | Uso delimitado por Câmara, regras, infraestrutura e responsáveis aprovados; suspensão quando ocorrer falha fora do escopo homologado | Expansão automática para outras Câmaras |
| **R4 — produto integrado** | Conectores e fluxo documental após P12; segunda Câmara após P13 | Escrita bilateral sem fonte de verdade ou assinatura presumida |

O voto secreto permanece **bloqueado** até projeto de sigilo próprio, modelo de ameaça e revisão independente; não é requisito implícito para liberar voto nominal/simbólico. A decisão sobre incluir votação offline no primeiro piloto deve ser tomada **antes** do escopo R3. Como o usuário definiu o servidor local como parte do produto, P4–P6/P10 são obrigatórios para declarar o **produto alvo completo**, mesmo que um piloto estritamente conectado seja autorizado antes com contingência de suspensão explícita.

## 6. Qualidade, capacidade e indicadores

O pipeline local → PR → CI → `main` → VPS permanece obrigatório para releases do SaaS. A promoção fixa SHA, migração e imagem, compara versão dos serviços e consulta prontidão; rollback de banco não é automático. Mudanças de desktop exigirão pipelines próprios de build Windows/Linux, assinatura, verificação de artefato e atualização controlada.

**Ensaio obrigatório de ponta a ponta:** criar sessão e documentos na web → publicar revisão → importar e verificar no desktop → pré-voo → presença/fala/voto nominal e simbólico em dispositivos → telão em duas TVs → cortar WAN → recuperar Wi-Fi e servidor conforme procedimento → reconciliar → conferir apuração, ata, portal e replay. Incluir ACK perdido, voto repetido, revisão nova durante sessão, pacote adulterado, época vencida, tentativa entre Câmaras e tela atrasada.

**Matriz mínima:** contrato e unidade para regras; integração PostgreSQL e arquivos; API por papel e por dois tenants; navegador Mesa/parlamentar/telão; duas instâncias para concorrência; LAN/WAN/energia/worker/encoder sob falha; pacote e sync com bytes adulterados; restauração em host novo; acessibilidade por teclado e leitor de tela humano; operação longa com carga representativa. O caso nominal e simbólico deve bater com livro independente, não apenas com cálculo feito pela mesma função do sistema.

**Migração e retorno:** quando uma Câmara substituir sistema legado, importar uma cópia, conservar IDs de origem e produzir relatório de contagens, vínculos e divergências. Ensaiar o retorno operacional antes da sessão oficial; dois servidores não podem disputar a mesma sessão. A documentação de migração do PainelDesk é referência de processo, não prova de paridade com o acervo do edocBR.

**Medir e pactuar antes de R3:** sessões simultâneas por Câmara, dispositivos por sessão, tempo de comando e recomposição, atraso de sincronização/portal, disponibilidade por serviço, idade do último backup íntegro, RPO, RTO, retenção, espaço e banda de vídeo, latência de alerta, tempo de recuperação de mídia e incidentes de acessibilidade. Nenhum número de laboratório deste repositório deve virar SLA sem carga, equipe e ambiente definidos.

## 7. Decisões e dependências externas

| Decisão/entrada | Responsável | Necessária antes de |
|---|---|---|
| Regimento, composição, Mesa, casos de apuração, política de voto, textos e responsáveis de Mucuri | Secretaria, Presidência e jurídico | P2/P7/P11 oficiais |
| Canal de convocação, contas nominais, MFA e política de dispositivo | Câmara/TI | P3/P5/P11 |
| Computador local, energia/rede LAN, certificado/dispositivos e reserva; tempo máximo sem WAN | Câmara + operação edocBR | P5/P6/P10/P11 |
| Destino durável de backup, chave com custódia, retenção, canal de alerta e metas RTO/RPO | Operação SaaS/TI | Fechar P1 e R3 |
| Câmeras, áudio, banda, conta/chave social e observador em outra rede | Audiovisual/TI | P9/P11 |
| Fonte de verdade ATA/PAUTA, IDs, ACL, assinatura e ambiente de teste Nextcloud/Alfresco | TI + secretaria + jurídico | P12 |

Dados públicos preparatórios de Mucuri não substituem validação de mandato, foto/emblema, regra ou autorização de publicação. A configuração deve ser versionada e aceita; não codificar o regimento de Mucuri como regra global do SaaS.

## 8. Equipe, cadência e controle de mudanças

Uma equipe real precisa cobrir **produto legislativo**, **engenharia web/domínio**, **desktop e sincronização**, **QA/acessibilidade**, **operação e segurança**, **audiovisual** e **suporte**. Uma pessoa pode acumular funções durante desenvolvimento, mas ninguém deve aprovar sozinho regra regimental, resultado, publicação e recuperação que também implementou. Secretaria, Mesa, TI e audiovisual da Câmara são validadores do piloto, não substitutos dos testes de engenharia.

Trabalhar em incrementos pequenos com demonstração e evidência no fim de cada ciclo. Antes de cada ciclo, selecionar uma fase/gate, fixar casos de aceitação e dados de teste; ao fechar, registrar SHA, CI, ensaio, defeitos, decisão e próximo bloqueio. A ordem de dependência P0→P13 prevalece sobre contagem de tarefas. Estimativa de prazo e orçamento exige equipe disponível, escopo do primeiro piloto, hardware local, conta social, destino de backup e responsáveis institucionais definidos; o plano não inventa data de entrada em produção.

Mudanças de regra aprovada, autoridade de sessão, formato de pacote ou publicação exigem ADR ou revisão de contrato, migração compatível, testes de versão anterior/nova e plano de reversão. Incidente de produção reabre o gate afetado até correção e nova prova. O histórico de decisão permanece em Git; segredos e aceites pessoais ficam em repositório institucional privado com referências, não em commits.

## 9. Próximas execuções concretas

A cobertura dos testes locais tem uma meta operacional própria: [META-TESTES-LOCAIS.md](META-TESTES-LOCAIS.md). As fases L0–L6 organizam inventário, testes das funções web e serviços, cliente local, jornada completa, recuperação e regressão final. A meta só termina com matriz integral e registros por incremento; teste local não equivale a homologação institucional.

1. **L0 — inventariar funções e ambiente local:** executar `bun run test:local:inventory -- --json` para registrar os arquivos atuais; revisar itens não classificados e relacionar cada função a tela/API, regra, teste existente e fixture. Registrar lacunas antes de ampliar suítes.
2. **L1/L2 — cobrir módulos web e auxiliares:** percorrer funções por papel com testes existentes e simuladores locais; registrar caminho feliz, autorização/tenant negado, falha e recuperação.
3. **P4/P6/L3 — autoridade antes do ato:** ligar reserva exclusiva, cercamento dos escritores web e diário local; definir comandos e eventos de retorno. Provar dois processos, ACK perdido, troca de época e reconciliação sem dupla autoridade.
4. **P5/P10/L3 — servidor utilizável:** instalar/supervisionar em Windows e Linux, proteger API LAN e entregar snapshot, documentos, telão e pré-voo. Provar instalação limpa, reinício, janela fechada, pacote incompleto e clientes.
5. **L4/L5 — jornada integrada e recuperação:** testar preparação, presença, fala, voto, telão, reconciliação, ata e publicação com dados fictícios; exercitar falhas e restauração com etapas documentadas.
6. **L6 — regressão total local:** executar suítes numa instalação limpa; fechar todas as linhas da matriz local como passou ou não aplicável justificado. Publicar relatório com SHA, comandos, ambiente e limites.
7. **P1/P2/P3/P7–P11 — gates institucionais:** preparar backup, regras e aceites em paralelo. Mucuri permanece preparatória até a Câmara aprovar seus dados; evidência local não libera ato oficial.

O [registro de etapas](etapas/README.md) guarda mudança, comando, resultado e limite de cada incremento. A [matriz viva](MATRIZ-ENTREGA.md) liga requisito, implementação, teste e aceite. O [pacote de homologação](HOMOLOGACAO-PACOTE-EXECUCAO.md) é roteiro de ensaio, não atestado de aceite. A organização e as lacunas documentais estão no [índice](README.md).
