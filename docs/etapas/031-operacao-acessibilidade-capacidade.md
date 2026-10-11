# Etapa 031 — Operação, acessibilidade e capacidade

**Data:** 11/10/2026 · **Estado:** em andamento; ensaios locais concluídos, aceite em equipamento e leitor de tela pendente.

O painel de transmissão agora mostra uma conferência única para pauta, convocação, presidência, quórum, fonte, gravação e destinos da Câmara. Cada bloqueio traz um próximo passo textual. O estado legislativo é separado da prontidão do transporte local; uma falha de mídia não marca a votação como indisponível. A rota `GET /api/v1/sessions/:id/readiness` exige `media.read`, isola a Câmara e não retorna URLs de ingestão nem chaves. Consultas periódicas de mídia não geram notificações repetidas quando o controlador está fora; a falha permanece legível no painel. Teste em banco descartável: 13 verificações, incluindo escopo de outra Câmara e confidencialidade.

O ensaio de capacidade `bun run test:session:capacity` registrou 21 votos concorrentes e 40 consultas públicas simultâneas ao mesmo resultado, sem falhas ou votos duplicados. Neste host, com handlers chamados diretamente e banco descartável SQLite, o lote de votos levou 160 ms, p95 observado por comando 155 ms e o lote de consultas 49 ms. O mesmo cenário passou em PostgreSQL efêmero (255 ms, 246 ms e 59 ms nessa execução). Esses números são amostras locais, sem rede HTTP, telões reais ou meta contratual; não representam SLA. A CI executa os testes de prontidão e capacidade nos dois provedores.

Na interface local, a aba Transmissão expôs os estados e ações na árvore de acessibilidade; os cartões usam títulos `h2` para navegação por seções. As setas esquerda/direita alternaram por teclado entre Telão e Transmissão, e os avisos permaneceram em texto, sem depender só de cor. A leitura com tecnologia assistiva e a navegação completa em equipamento da Câmara ainda exigem uma pessoa e dispositivo de homologação.

**Próxima entrega para encerrar a etapa:** testar teclado e leitor de tela em toda a jornada crítica, medir acesso HTTP/WebSocket com telões e vereadores reais, exercitar alertas com falhas prolongadas e registrar limites do ambiente dedicado. Manter os alertas operacionais visíveis sem consultar logs.
