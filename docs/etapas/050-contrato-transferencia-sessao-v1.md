# P4 / Etapa 050 — contrato inicial de transferência web → servidor local

**Estado em 07/11/2026:** contrato puro v1 e verificador implementados; ainda não há exportador, rota de download, servidor desktop, distribuição LAN nem autoridade para atos offline. O modo offline oficial permanece bloqueado.

## Decisão implementada

`src/lib/session-transfer-contract.ts` define `edocbr.session-transfer` versão 1 para uma Câmara, uma sessão e uma revisão. O manifesto contém identificadores e versões, data, pauta, política de preparação, política deliberativa, composição e metadados de cada PDF/anexo obrigatório. Cada artefato precisa de ID, origem, tamanho e SHA-256; o consumidor recebe os **bytes** por ID e recusa ausência, tamanho/hash divergente ou item extra. Um anexo representado somente por URL não atende ao contrato.

O manifesto é serializado com chaves ordenadas e domínio `edocbr.session-transfer.v1`, depois assinado com Ed25519. O verificador recebe **fora do pacote** a chave pública confiável para o `keyId` e exige Câmara/sessão esperadas, revisão não inferior à já preparada e, quando a revisão já foi escolhida, seu ID exato. Alterar pauta, política, composição ou metadados invalida a assinatura. Identificadores duplicados são recusados. Nenhuma chave privada ou credencial entra no pacote.

O contrato contém **dados de preparação**. Uma assinatura válida prova integridade e origem apenas se a chave confiável tiver sido provisionada de modo seguro; ela não transfere autoridade da sessão, não autentica um dispositivo parlamentar e não confirma que o regimento foi aprovado. O congelamento de revisão, comando de abertura, sequência/ACK e promoção de reserva serão contratos separados antes de permitir voto local. A política deliberativa ainda é um snapshot JSON assinado; seu esquema e os casos de cálculo precisam ser fixados contra a configuração oficial na próxima rodada.

## Prova

`DATABASE_URL=file:/tmp/edocbr-session-transfer-test.db bun test tests/session-transfer-contract.test.ts` passou com quatro casos: pacote assinado íntegro; Câmara/sessão/revisão ou chave incompatíveis; alteração de pauta, política ou assinatura; arquivo ausente, adulterado, URL isolada, ID repetido e bytes extras. `bun run typecheck` e `bun run lint` passaram. A CI executará o teste de contrato em cada PR. Os dados são fictícios e o módulo não consulta banco nem habilita rota pública.

## Próxima entrega P4

1. Fixar o snapshot deliberativo com casos do motor atual e ligação à versão de configuração oficial.
2. Construir exportador transacional da revisão publicada, com tenant isolado, lista de documentos da revisão e todos os anexos de matéria materializados; URL externa sem cópia verificada bloqueia a prontidão.
3. Definir identidade do servidor local, provisionamento/rotação da chave pública, assinatura no servidor, download autenticado e importação atômica com ACK por artefato.
4. Modelar autoridade única, sequência de comandos/eventos, deduplicação, ACK e quarentena; fazer modelo de ameaça antes de expor API LAN.

**Gate P4:** o mesmo caso de presença/voto/ata deve produzir resultado idêntico nos executores web e local de teste; assinatura, integridade, versão e autoridade precisam de testes negativos. Este incremento cobre apenas o primeiro contrato de dados e integridade.
