# edocBR Plenário — diagnóstico e plano de desenvolvimento atualizado

**Revisão:** 05/11/2026. **Situação:** produto funcional em desenvolvimento local; piloto institucional ainda não homologado. Este é o plano corrente. O [plano de 04/11](PLANO-INTEGRAL-2026-11-04.md) e os documentos anteriores preservam decisões e histórico; as [etapas numeradas](etapas/README.md) preservam as evidências de cada entrega.

A [meta de execução](META-EXECUCAO-PLENARIO-2026-11-05.md) acompanha os marcos, critérios de saída e dependências deste plano.

## 1. Como o estado foi conferido

Foram lidos o plano funcional, a matriz de rastreabilidade, as etapas 045–053c, o esquema Prisma, os módulos e rotas principais, os scripts de operação, a CI e o [contrato de integração](integracoes/arquitetura-edocbr.md). Para o ecossistema institucional, foram consultados `/home/suporte/Work/integracao-edocbr/documentacao/ESTADO-ATUAL.md` (atualização parcial de 05/11) e `README.md`. A operação desses serviços não foi testada nesta revisão.

Em 05/11 passaram `bun run lint`, `bun run typecheck`, `test:pilot:preflight`, `test:images:parliamentarian`, `test:official-configuration`, `test:session:journey`, `test:voting:flow-guards`, `test:official:closure`, `test:media:public-link` e `test:media:archive`. São testes selecionados de diagnóstico, não execução integral da CI. O pré-voo de Mucuri terminou com código 2, como esperado, e `automaticReady: false`. A [prova recente da réplica PostgreSQL e restauração conjunta](etapas/045-auditoria-imagens-replica.md) conciliou 78 tabelas e 526 linhas em laboratório, executou escrita e recuperação HTTP e restaurou 14 imagens referenciadas. Essas provas não são aceite da Câmara nem substituem operação em host separado.

Usar três estados distintos em toda comunicação: **implementado** (código e teste), **ensaiado** (jornada em laboratório) e **homologado** (prova no ambiente alvo e aceite da Câmara). Nenhuma fase 045–053 está homologada para ato oficial.

## 2. Capacidades já desenvolvidas

| Domínio | O que existe | Limite atual |
|---|---|---|
| Plataforma SaaS | Tenants, identidade visual e configurações por Câmara, papéis, autenticação, auditoria, outbox, console de plataforma, onboarding e testes de isolamento | Implantação distribuída, suporte e metas contratuais não homologados |
| Estrutura legislativa | Legislatura, mandatos, licenças/suplência, partidos, Mesa, eleições futuras/posse/cancelamento e configuração versionada | Regimento e composição de Mucuri ainda sem conferência e aprovação institucional |
| Sessão e pauta | Rascunho, numeração, pauta/revisões, documentos, convocação, ciência e registro manual de entrega por revisão | Entrega externa com comprovante do provedor e regras reais pendentes |
| Plenário | Presença, quórum, fala, telão com estado durável, reconexão e comandos idempotentes | Dispositivos, duas TVs físicas, leitor de tela humano e operação presencial pendentes |
| Deliberação | Votação nominal e simbólica, conferência da contagem simbólica por duas contas, recibos, impedimentos, anulação e relatório recontável | Matriz regimental aprovada e conferência humana independente pendentes; voto secreto oficial bloqueado; votação offline inexistente |
| Encerramento e portal | Ata revisada e versionada, hash, assinatura eletrônica interna, publicação separada, retificação e consulta pública com vínculo ao replay | Texto, signatários, retenção e assinatura institucional sem aceite; HMAC interno não equivale a assinatura qualificada |
| Audiovisual | Controle de destinos, encaminhamento RTMP/RTMPS, gravação/replay, observação humana por destino e publicação controlada de link | Sem conta/chave institucional, câmera/áudio e observação externa em rede separada |
| Recuperação | PostgreSQL/migrações, workers, monitoramento e falhas sintéticas, backup de banco+arquivos e restauração local verificada | Falta host separado, volumes duráveis, observador externo, RTO/RPO acordados e medidos em operação representativa |
| Mucuri | 13 vereadores e mandatos, 7 partidos, contatos, 13 fotos públicas, Mesa 2025–26 e eleição 2027–28 com posse pendente | Conferir fotos e dados; faltam emblemas verificados, responsáveis nominais, regra e política aprovadas, SMTP, destino social e infraestrutura |

**Achado de produto recente:** a faixa da Câmara na sidebar e o recuo do cabeçalho foram corrigidos no commit `8e9a469`; a conferência visual em navegador do usuário ainda é necessária porque o navegador integrado estava indisponível nesta execução.

## 3. Arquitetura e regras que devem permanecer

- **Aplicação:** Next.js/React/TypeScript; APIs e motor transacional com Prisma; PostgreSQL como banco operacional alvo. SQLite continua apenas como ambiente local e origem de migração.
- **Serviços:** Redis, tempo real, agenda/webhooks, fila de correio e mídia em processos separados. Eventos e comandos críticos mantêm `tenantId`, idempotência, versão e auditoria. Fotos, documentos e gravações precisam de volume durável e backup coerente com o banco.
- **Mídia:** encoder/OBS compõe cenas e áudio; MediaMTX encaminha o sinal para destinos independentes; o Plenário registra intenção, estado observado, link público e prova de conferência. Estado de ingestão não prova visibilidade na rede social.
- **Segurança deliberativa:** nenhuma integração externa pode abrir votação, mudar voto, alterar resultado encerrado ou publicar ato por inferência. Voto secreto e operação offline continuam indisponíveis para uso oficial até projeto e revisão próprios.
- **Configuração SaaS:** tipos, regras, aparência, destinos, retenção, usuários e permissões pertencem a cada Câmara. Não transformar dados de Mucuri em constantes do produto; scripts de importação são específicos e protegidos contra substituição de dados divergentes.

## 4. Sequência de desenvolvimento e gates

| Ordem | Fase e estado em 05/11 | Trabalho restante | Saída verificável |
|---:|---|---|---|
| 0 | **Linha de base e experiência — em execução** | Consolidar documentação/CI, testar regressões da marca/menus em viewport desktop e móvel, eliminar referências antigas de status e manter jornada fictícia reproduzível | Testes passam; plano e matriz apontam para a mesma versão; captura revisada por pessoa |
| 1 | **045: operação SaaS — ensaiada localmente** | Preparar deploy parametrizado; provar em host separado TLS, PostgreSQL, Redis, workers, volumes, SMTP de teste, duas telas e observador externo; repetir carga, falhas e restauração | Prontidão, isolamento, alertas, backup conjunto e RTO/RPO medidos no host alvo; runbook de suspensão aprovado |
| 2 | **046: configuração da Câmara — incremento técnico** | Conferir regimento, mandatos, Mesa, quórum, maiorias, desempate, impedimentos, prazos e papéis; carregar responsável e política de votação sem pressupor valores | Revisão versionada e matriz de casos aprovadas por secretaria/Presidência; pré-voo reconhece configuração vigente |
| 3 | **047: sessão, pauta e convocação — incremento técnico** | Exercitar revisão, documentos, prazos e cancelamento; conectar canal institucional de entrega com recibo técnico e reenvio idempotente quando houver conta autorizada | Jornada fictícia completa com destinatários, versão/hash, entrega e ciência conferidas |
| 4 | **048: condução — incremento técnico** | Ensaiar login nominal, presença, substituição, impedimento, falas, interrupção e retorno de dispositivo/telão | Estado recomposto sem duplicações; quórum por ato conferido; TV e acessibilidade verificadas presencialmente |
| 5 | **049: votação — incremento técnico** | Ampliar ensaio HTTP multi-instância e conferência independente de nominal/simbólica, empate, anulação e recibos conforme matriz da Câmara | Apuração e ata batem com cálculo manual em 100% dos casos aprovados; nenhum vazamento entre tenants |
| 6 | **051: ata e transparência — incremento técnico** | Aprovar modelo, signatários, revisão/publicação segregadas, retificação, prazo, retenção, portal e vínculo ao vídeo | Artefatos, hashes, assinatura aplicável e conteúdo público conferidos pela Câmara |
| 7 | **052: transmissão social — incremento técnico local** | Testar câmera e áudio reais, OBS/encoder, MediaMTX e pelo menos um canal institucional; observar vídeo e áudio em outra rede; testar segundo destino, perda/retorno e replay | Operador audiovisual registra horário, qualidade, falhas, link e autorização de publicação por destino |
| 8 | **053: piloto Mucuri — preparado, não iniciado** | Usuários nominais por função, treinamento, sessão fictícia longa, leitores de tela, TVs, recuperação e sessão assistida com plano de suspensão | Aceites legislativo, técnico, jurídico, acessibilidade e audiovisual explícitos; pré-voo e evidências íntegros |
| 9 | **054: contratos de integração — planejado para após o piloto** | Decidir fonte de verdade de ATA/PAUTA, IDs, versões, ACL, papéis e estados; modelo de vínculo externo e outbox em teste simulado | Matriz de autoridade e eventos aprovada; nenhum documento real escrito |
| 10 | **055: leitura Nextcloud/Alfresco — planejada** | Conectores somente leitura, cursor, prévia, verificação de ACL, identificação por `fileid`/nó e reconciliação | Referências corretas em homologação, negativos de permissão/tenant e divergências visíveis |
| 11 | **056: publicação integrada — planejada** | Entregar ato aprovado por outbox, ACK, hash/versão, retry/dedupe, fila de falha, reconciliação e reversão assistida | Fluxo ponta a ponta aprovado pela TI e área legislativa; falha externa não modifica votação |
| 12 | **057: operação e expansão SaaS — planejada** | Suporte, atualização/migração por tenant, restores periódicos, monitoramento, SLA, documentação e entrada de novas Câmaras | Processo repetível de onboarding e operação auditável com contrato aceito |

**Fase 050:** continua como restrição deliberada: não prometer voto secreto nem votação offline no piloto. Se a Câmara exigir essas modalidades, abrir projeto independente, modelo de ameaça, desenho criptográfico/autoridade local e revisão externa antes de habilitar.

## 5. Próxima fila executável sem host ou conta institucional

Executar nesta ordem, em **Câmaras e dados fictícios**, registrando cada incremento em `docs/etapas/`:

1. **Jornada de regressão do produto — ensaio local concluído:** a [prova de layout](etapas/045-regressao-layout-navegador.md) passou em desktop e móvel; a [jornada de ata pública](etapas/045-jornada-ata-publicacao-navegador.md) passou com criação do rascunho e publicação da pauta pela interface, papéis separados na revisão/publicação e verificação no portal. Alguns comandos intermediários usam API do ensaio. A configuração é fictícia e pré-carregada; documentos, canal externo e aceite institucional permanecem em fases posteriores.
2. **Portabilidade do acervo e prontidão — incremento local concluído:** a [prova de imagem restaurada por HTTP](etapas/045-restauracao-imagem-http.md) cobre banco+foto, isolamento de tenant, adulteração e ausência em instância descartável. O [pré-voo de arquivos](etapas/045-prevoo-referencias-arquivos.md) aponta foto/anexo local ausente, caminho inválido e tamanho divergente por Câmara. Faltam prova HTTP de documento anexo, gravação/replay e operação em volume/host externos; URLs remotas seguem sem verificação local.
3. **Conferência deliberativa independente — ensaio local concluído:** o [livro de papel](etapas/049-conferencia-deliberativa-independente.md) confronta cenários fictícios de presença, suplência, impedimento, empate simbólico e anulação com banco, ata e portal; comandos e leitura entre Câmaras são recusados. Faltam matriz regimental aprovada, empate nominal, presença variável, PostgreSQL multi-instância e conferência humana para o gate institucional.
4. **Transmissão em laboratório — ensaio sintético repetido:** a [prova de 05/11](etapas/052-repeticao-laboratorio-transmissao-2026-11-05.md) repetiu dois destinos, áudio/vídeo, queda e retorno isolados, gravação e replay com carga legislativa. O painel alerta sobre perda e oferece retirada do link; a publicação oficial exige observação da página pública. Canal social e observador externos permanecem pendentes.
5. **Pacote de homologação — roteiro preparado:** o [pacote de execução](HOMOLOGACAO-PACOTE-EXECUCAO.md) reúne checklist, diagnóstico, ensaio longo, matriz de evidências e decisão por área. A execução exige host, observador, responsáveis, contas e regras confirmadas; o documento não é aceite.

Essa fila entrega engenharia local; não altera o `automaticReady: false` de Mucuri artificialmente. O próximo incremento é o pacote de homologação. A fase 045 em host separado e as decisões da Câmara podem avançar em paralelo quando os recursos forem disponibilizados.

## 6. Decisões e dependências que exigem participantes externos

| Dependência | Quem fornece/confere | Por que bloqueia |
|---|---|---|
| Host de homologação, domínio/TLS, armazenamento e backup externo | Operação SaaS/TI | Falhas, recuperação, carga, segurança e disponibilidade não podem ser medidos só neste computador |
| Regimento, política de votação, composição e responsáveis | Secretaria, Presidência e jurídico | Define resultados oficiais, quórum, empate, assinatura e autorização de atos |
| Contas nominais, SMTP e dispositivo de cada papel | Administração da Câmara/TI | Prova de autoria, convocação e ciência reais |
| Câmeras, áudio, banda, canal e chave social institucionais | Audiovisual/TI da Câmara | Prova pública de transmissão e replay em redes reais |
| Emblemas verificados e conferência das fotos/dados de Mucuri | Câmara e partidos conforme acervo oficial | Evita exibição de identidade incorreta no cadastro, telão e portal |
| Fonte de verdade de ATA/PAUTA, ACL e estados de assinatura/arquivo | TI, secretaria, Nextcloud/Alfresco/LibreSign | Evita duplicar numeração ou declarar concluído documento apenas aprovado |

O pré-voo atual de Mucuri relata: Câmara ativa; responsável e política de votação pendentes; nenhuma revisão aprovada; **0** usuários de administração, Mesa e mídia; processo em SQLite; SMTP ausente; **0** destinos sociais públicos; **0** sessões oficiais. Esses são fatos locais, não um pedido para criar contas ou regras presumidas.

## 7. Integração futura no ecossistema edocBR

Manter a decisão do usuário: integrar **ao final do desenvolvimento e piloto**. Até lá, preservar IDs estáveis, eventos versionados, hash e `tenantId` nas interfaces internas. Na fase 054, confirmar o estado efetivo dos serviços; o documento externo de 05/11 é uma atualização parcial, não prova de fluxo completo.

- **AD:** fonte de identidade e grupos; vínculo parlamentar e permissão de votar exigem confirmação específica no Plenário. Grupo de colaboração de gabinete não concede presidência, aprovação ou voto.
- **Nextcloud/ONLYOFFICE:** minuta e versões de trabalho; identificar por `fileid`/etag e permissão. O Plenário não deve sobrescrever arquivo por caminho ou nome.
- **Alfresco/GED:** nó, processo, classificação e arquivamento. Um HTTP 200 ou tarefa criada não prova arquivo final nem ACL correta.
- **LibreSign:** assinatura é fluxo próprio; aprovação de conteúdo, assinatura de todos os exigidos, PDF final íntegro e arquivo validado são estados distintos.
- **Plenário:** presença, quórum, voto, resultado e eventos de sessão continuam fatos locais. Falha de repositório deixa pendência de integração visível; não reabre nem altera votação.

Antes do primeiro adaptador, aprovar um mapa de autoridade para cada campo e espécie documental; validar acesso permitido e negado por Câmara; usar conta de serviço de menor privilégio, segredos externos ao banco, outbox com ACK e reconciliação. A [arquitetura de integração](integracoes/arquitetura-edocbr.md) detalha o contrato inicial.

## 8. Governança de entrega

Cada fase entrega: código e migração aditiva quando cabível, teste positivo/negativo de tenant, prova de falha/retry, documentação de API/operador, registro numerado com data/ambiente/limites e atualização desta matriz. Atos oficiais exigem conferência humana e aceite identificado. Priorizar uma correção concreta quando teste ou operação encontrar defeito; não ampliar testes só para aumentar contagem. As metas de disponibilidade, latência, RTO/RPO, retenção e capacidade serão pactuadas com a Câmara e operação após medir o ambiente alvo.
