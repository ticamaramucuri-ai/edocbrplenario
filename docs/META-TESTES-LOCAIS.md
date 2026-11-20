# Meta de testes locais de todas as funções — edocBR Plenário

**Revisão:** 17/11/2026 · **Responsável pelo estado:** equipe edocBR Plenário · **Plano diretor:** [PLANO-MESTRE.md](PLANO-MESTRE.md) · **Meta de produção:** [META-PRODUCAO.md](META-PRODUCAO.md)

**Estado atual:** meta em andamento. O inventário L0 agora classifica 90 arquivos em treze grupos, incluindo a suíte específica do grafo de matérias (etapa 100); este total descreve arquivos, não cobertura integral. Além dos grupos locais de API/domínio, as etapas [091](etapas/091-jornada-navegador-plenario-acessibilidade.md), [092](etapas/092-jornada-navegador-materias-protocolo.md), [093](etapas/093-jornada-navegador-fila-fala-cronometro.md), [094](etapas/094-jornada-pwa-pedido-de-palavra.md), [095](etapas/095-jornada-pwa-checkin-voto-recibo.md) e [096](etapas/096-retentativa-pwa-voto-ack-perdido.md) percorrem telas selecionadas; a etapa [097](etapas/097-testes-locais-busca-analytics.md) cobre API de busca e Analytics, a [098](etapas/098-jornada-navegador-busca-analytics.md) acrescenta paleta e CSV, a [099](etapas/099-jornada-navegador-versoes-relacionamentos.md) acrescenta versão e vínculo visual, e as [100](etapas/100-testes-locais-grafo-vinculos-materias.md)/[101](etapas/101-testes-locais-matriz-vinculos-materias.md) cobrem regras do grafo e todos os tipos pela API; a [102](etapas/102-jornada-navegador-anexo-privado-materia.md) testa upload/download visual de PDF privado, a [103](etapas/103-jornada-modelos-documento-versionamento.md) percorre versionamento append-only e renderização de modelos, a [104](etapas/104-jornada-navegador-relatorios.md) valida espelho/minuta, exportação JSON e acionamento de impressão pela UI, a [105](etapas/105-jornada-telao-multiplas-telas.md) verifica fan-out de perfil, presença/quórum e congelar/descongelar em duas telas locais, a [106](etapas/106-jornada-votacao-opcoes-customizadas.md) percorre criação, voto PWA, recibo e contagem com opções customizadas, e a [107](etapas/107-validacao-api-opcoes-votacao.md) valida fronteiras e não persistência de opções inválidas; a [108](etapas/108-apuracao-empate-opcoes-customizadas.md) percorre o ciclo nominal de API até empate customizado, a [109](etapas/109-vitoria-publica-opcoes-customizadas.md) verifica vitória por margem e igualdade entre contagens expostas, a [110](etapas/110-contagem-simbolica-oficial-customizada.md) cobre confirmação por outra identidade pela API, a [111](etapas/111-jornada-visual-contagem-simbolica-oficial.md) percorre proposta, confirmação em outro navegador e encerramento pela Mesa, e a [112](etapas/112-empate-simbolico-oficial.md) verifica empate 2/2/1 com três opções e resumo correto na pauta; a [113](etapas/113-empate-simbolico-oficial-pela-mesa.md) percorre empate pela interface, as [114–117](etapas/README.md) cobrem corridas SQLite/PostgreSQL em handlers e duas instâncias HTTP, e a [118](etapas/118-retentativa-pwa-erros-http-voto.md) valida retentativa PWA após 429, 503 e ACK perdido; a [119](etapas/119-renderizacao-pdf-relatorios.md) gera PDFs reais no Chromium para espelho/minuta e verifica texto e ocultação de controles; a [120](etapas/120-pauta-e-votacao-em-pdf-relatorios.md) inclui expediente, pauta e votação nas exportações JSON/PDF; a [121](etapas/121-estados-vazios-e-erros-relatorios.md) verifica vazios e retry 503 no espelho/minuta; a [122](etapas/122-paginacao-e-vazios-dos-relatorios.md) mede paginação, preservação do conteúdo final, estados sem pauta/voto e recuperação da lista de sessões. Ainda faltam outras classes e operações visuais de vínculos, matriz completa de permissões, cobertura mais ampla dos relatórios (revisão visual das páginas, falha de download JSON, retificação e visibilidade portal), cenários adicionais de opções regimentais e contagem, outros erros 4xx/429/5xx, instalação Windows e núcleo LAN. O comando `bun run test:local:inventory -- --check` permanece como inventário somente leitura, não como prova de cobertura.

A [etapa 125](etapas/125-pdf-a4-secoes-e-cadeia-auditoria.md) acrescenta impressão A4 numerada, separação correta das fases da pauta, detecção de cabeçalhos isolados e verificação independente da cadeia de auditoria. O teste local passou com PDFs de 8 e 5 páginas e 44 eventos sintéticos; exportação com falha, retificação e portal continuam abertos.

Registro inicial: [etapa 078](etapas/078-inventario-testes-locais.md). Os incrementos seguintes devem continuar cruzando cada função com tela/rota, regra e evidência, registrando dependências e efeitos colaterais.

O cruzamento inicial entre módulos, rotas e testes está em [MAPA-COBERTURA-TESTES-LOCAIS.md](MAPA-COBERTURA-TESTES-LOCAIS.md). As associações são candidatas pelo inventário de nomes; cada teste ainda deve ser lido e executado antes de marcar cobertura verificada.

## Objetivo

Chegar a uma versão em que **todas as funções previstas no produto possam ser percorridas e verificadas localmente**, em ambiente reproduzível, com dados fictícios, sem depender de conta, equipamento ou serviço institucional. Para esta meta, “testada localmente” significa: fluxo acessível pela interface ou API apropriada, regra de domínio exercitada, resultado persistido e visível, falhas relevantes cobertas, e evidência registrada. Não significa homologação oficial ou prova em rede/equipamentos reais.

A meta termina quando cada linha da [matriz de cobertura local](#matriz-de-cobertura-local) está marcada **PASSOU** ou **NÃO APLICÁVEL COM JUSTIFICATIVA**, e todas as jornadas integradas passam numa instalação local limpa. Funções que dependam de serviços externos serão exercitadas contra simuladores locais, com cenários de indisponibilidade, repetição, timeout e resposta inválida. Nenhuma dependência externa será declarada homologada por esse teste.

## Princípios de execução

- Usar banco, arquivos, contas e Câmaras descartáveis. Nunca apontar comandos de teste a produção, staging institucional ou banco com dados reais.
- Registrar SHA do código, sistema operacional, pré-requisitos, comando, dados/fixture, resultado, saída relevante, duração, falhas, correção e limitações.
- Reaproveitar testes existentes. Antes de criar um novo, ligar requisito ao teste atual e cobrir lacunas concretas; evitar duplicar teste unitário e ensaio de interface sem benefício.
- Separar **unidade/domínio**, **integração local**, **jornada de navegador** e **falha/recuperação**. Uma camada não substitui as outras.
- Cada incremento começa com um registro em `docs/etapas/`, atualiza esta meta e a [matriz viva](MATRIZ-ENTREGA.md), e termina com estado explícito: passou, falhou ou bloqueado por dependência externa.
- Nunca registrar segredos, tokens, chaves privadas, dados pessoais ou votos vinculáveis reais nos artefatos de teste.

## Escopo funcional local

1. **Configuração e acesso:** criar Câmara de teste, identidade, papéis, permissões, sessão, configuração, autenticação, revogação e isolamento entre tenants.
2. **Estrutura legislativa:** legislaturas, mandatos, licenças/suplência, partidos/blocos, Mesa, parlamentares e versões de regras.
3. **Preparação:** criar/editar sessão, numeração, matérias, pauta/revisões, anexos/documentos, convocação, ciência, prontidão, manifesto, importação local e divergências.
4. **Condução:** abrir/suspender/retomar/encerrar sessão, credenciar presença, entradas/saídas, quórum, fila de fala, cronômetro e questão de ordem quando prevista no produto.
5. **Deliberação:** votação nominal e simbólica, impedimentos, opções regimentais, recibos, deduplicação, pausa/retomada, encerramento, apuração, empate conforme configuração, anulação e recontagem. Voto secreto é verificado como bloqueado nas funções oficiais até projeto próprio.
6. **Telão e clientes:** Mesa, parlamentar, telão e portal público com snapshots, cursores, atualização em tempo real, reconexão, estados atrasados, responsividade e permissões por papel.
7. **Fechamento e transparência:** relatório, ata, revisão, assinatura técnica disponível, retificação, autorização e publicação; replay e vínculo de documentos conforme configuração de visibilidade.
8. **Audiovisual:** configuração de destinos, estados desejado/observado, gravação, segmentos, replay, falha/retorno e simulador RTMP/RTMPS. Verificação pública de canal real fica fora da meta local.
9. **Operação e suporte:** logs, saúde, backup, restauração, atualização/migração, limpeza de dados de teste, e-mail e agendador contra capturador local, webhooks contra receptor simulado, limites e rate limiting.
10. **Servidor local e sincronização:** identidade/custódia de teste, descoberta, transferência e integridade do pacote, diário sequenciado/assinado, autoridade única, comandos locais, ACK, outbox, repetição, conflito, reconciliação, modo WAN indisponível e recuperação. A API LAN e a aplicação de voto local ainda precisam ser implementadas antes do teste ponta a ponta.
11. **Integrações documentais:** Nextcloud/Alfresco/identidade/assinatura contra adaptadores ou simuladores locais, cobrindo ACL, identidade estável, ACK, idempotência, conflito e rollback. Homologação com os serviços institucionais fica para P12.
12. **Acessibilidade e operação visual:** navegação por teclado, foco, mensagens de erro/estado, contraste automatizado, leitura de tela assistida onde disponível, tamanhos de tela e legibilidade simulada de telão.

## Sequência de trabalho

| Fase | Resultado local | Critério de saída e documentação |
|---|---|---|
| **L0 — inventário e ambiente** | Ambiente descartável inicia em máquina limpa; catálogo de função → rota/tela → regra → teste → fixture. | Dependências e comandos reproduzíveis; lacunas e funções fora do produto justificadas; registro de etapa e matriz preenchidos. |
| **L1 — módulos web existentes** | Testes de configuração, estrutura, sessão, pauta, matéria, documentos, presença, voto, relatórios, ata e portal executados localmente. | Cobertura de caminho feliz, negação de papel/tenant, duplicidade e erro por função; jornadas de navegador para papéis principais. |
| **L2 — serviços auxiliares** | E-mail, scheduler, webhooks, mídia, armazenamento e observabilidade em simuladores locais. | Falha, timeout, retry, idempotência, fila pendente e recuperação visíveis; nenhum envio externo real. |
| **L3 — núcleo local** | Processo local, instalação de desenvolvimento, pacote assinado de teste, armazenamento e diário reproduzíveis em Linux; build e execução de smoke em Windows. | Integridade e autoria verificadas; segredo local protegido; encerramento/reinício e falha de transferência cobertos. Windows exige execução real em host Windows para marcar passou. |
| **L4 — plenário local integrado** | Mesa, cliente parlamentar, telão e servidor local percorrem preparação importada, presença, fala, voto, resultado e encerramento. | Sessão completa com WAN desligada; ACK de voto inequívoco; perda/retorno de Wi-Fi; estado reconstituído sem duplicação; cálculo independente confere resultado. |
| **L5 — segurança e recuperação** | Dois tenants, papéis, restauração, migração, atualização/rollback, auditoria e acessibilidade na instalação local. | Testes negativos passam; backup local restaura banco e arquivos; release de teste pode ser atualizada e revertida fora da sessão; falhas ficam documentadas. |
| **L6 — regressão total local** | Execução consolidada das suítes e jornadas em ambiente limpo com fixtures recriadas. | Todas as linhas da matriz local passam ou recebem justificativa aprovada; relatório final reproduz comandos, SHA, resultados, limitações e itens que dependem de homologação. |

## Matriz de cobertura local

Manter cada linha associada aos testes existentes em `tests/`, `scripts/` e às telas/rotas correspondentes. Atualizar o status e apontar para uma etapa com evidência; não inferir cobertura pela quantidade de testes.

| Área | Cobertura mínima local | Status inicial |
|---|---|---|
| Instalação limpa e dados descartáveis | Inicialização sem dados prévios, migrações, seed fictício e limpeza segura | A levantar em L0 |
| Identidade, papéis e isolamento | Acesso permitido/negado para cada papel; tentativa cruzada entre duas Câmaras | Parcial; mapear em L0/L1 |
| Estrutura e configuração regimental | Vigências, suplência, impedimentos, quórum, maiorias e versões | Parcial; regras genéricas localmente exercitadas; casos institucionais ainda não existem |
| Sessão, numeração e pauta | Concorrência, revisão, cancelamento, publicação e mudança após preparação | API/domínio parcialmente verificados localmente; UI pendente |
| Documentos e transferência | MIME, hash, anexos, quota, retomada, corrupção, retenção e ACK | Parcial/ensaiado |
| Presença e quórum | Check-in/out, repetição, licença, suplência e quórum variável por ato | API/domínio local parcialmente verificados; servidor desktop pendente |
| Fala e cronômetro | Fila, prioridade, interrupção, retomada, cancelamento e atualização do telão | Jornadas locais web/PWA parciais; fala encerra após prorrogação e dois telões recebem perfil/presença/freeze (093–095/105) |
| Votação nominal/simbólica | Reenvio/ACK perdido, impedimento, opções, contagem, empate, pausa, anulação e reconta independente | UI Mesa + PWA cobre opção customizada, retentativa e recibo (106); API rejeita entradas inválidas sem persistir (107), fecha empate nominal (108), publica vitória por margem (109), confere contagem oficial (110/111), verifica empate simbólico oficial por API e interface (112/113), concorrência em SQLite/PostgreSQL e duas instâncias HTTP (114–117), e retentativa PWA com 429, 503 e ACK perdido mantendo um único voto (118). Permanecem: falhas reais de rede, demais códigos HTTP, impedimentos combinados, matriz de papéis, servidor desktop e regras institucionais |
| Voto secreto oficial | Negação explícita em rotas/UI oficial | Bloqueio negativo existente; sigilo não implementado |
| Autoridade e diário local | Duplo escritor, época vencida, integridade, assinatura, sequência e idempotência | Componentes internos ensaiados; fluxo de ato pendente |
| LAN e reconexão | Tablets/móveis/notebooks, snapshots, cursores, perda/reconexão e cliente atrasado | Pendente; API LAN não existe |
| Telão e acessibilidade | Dois perfis de telão, estado atrasado, teclado, contraste, mensagens e tamanhos | Etapa 105 cobre duas telas SQLite e perfil/presença/freeze; etapa 045 cobre dois nós, tela tardia e reconexão na stack PostgreSQL sintética. Consolidar no ciclo limpo; acessibilidade ampliada e hardware pendentes |
| Ata, relatório e portal | Permissão, cálculo, hash/versão, aprovação, retificação, publicação e ocultação | PDF do espelho/minuta renderizado em Chromium com sessão, pauta separada, votação, vazios e retry 503 (104/119–122/125); A4 com numeração, 8/5 páginas e sem cabeçalho órfão; cadeia de 44 eventos sintéticos válida pela API e verificador independente (125). Revisão em impressora, falha de download, retificação e visibilidade completa pendentes |
| Mídia, gravação e replay | Destino independente, falha/retorno, arquivo incompleto, hash e reprodução | Simulador parcial; equipamento real fora do escopo |
| E-mail, scheduler e webhooks | Capturador local; falha, retry, dedupe, pausa e retomada | Parcial; mapear simuladores em L2 |
| Backup, migração e recuperação | Banco + arquivos + aplicação; consistência e restauração limpa | Restore pontual demonstrado; automação local completa a mapear |
| Nextcloud/Alfresco/assinatura | Simuladores de API, ACL, ACK, divergência e compensação | Planejado; testes externos pertencem a P12 |
| Windows e Linux | Instalar, iniciar, atualizar, reiniciar, preservar dados e desinstalar mantendo backup | Linux CLI parcialmente exercitada; Windows apenas compilado |

## Registro obrigatório de cada incremento

Criar/atualizar `docs/etapas/NNN-*.md` usando o [modelo de registro](modelos/REGISTRO-ETAPA.md). Cada registro inclui: fase L e fase P relacionadas; requisito e papel; função e interface/API; arquivos e contratos alterados; SHA; sistema operacional, banco e ambiente; fixtures; comandos exatos; resultado esperado e observado; casos positivos e negativos; logs ou capturas sem dados sensíveis; falhas e correções; limitações; dependência externa; próximo critério de saída.

Atualizar também a linha correspondente desta meta e da [MATRIZ-ENTREGA.md](MATRIZ-ENTREGA.md). Se uma função mudar, documentar o comportamento e o procedimento no manual/runbook. Se não houver implementação, registrar **pendente**, o motivo e a prova necessária; não marcar como passou.

## Critério final de conclusão

A meta está concluída quando L0–L6 têm evidências revisadas, as suítes e jornadas locais passam numa instalação limpa, todos os papéis e áreas funcionais estão cobertos pela matriz, Windows e Linux foram executados nos respectivos sistemas, e um relatório de regressão documenta SHA, ambiente, comandos, resultados, limites e dependências externas. Isso comprova prontidão de engenharia local. O R2/R3 da [meta de produção](META-PRODUCAO.md) ainda exige equipamento e aceite institucional; testes locais não substituem homologação.
