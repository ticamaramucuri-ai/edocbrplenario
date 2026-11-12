# 125 — Primeira prévia executável dos apps desktop e móvel

**Estado em 11/11/2026:** incremento P5 de laboratório. Não é instalador, API LAN nem sessão local autorizada.

## Entrega

`bun run local:app -- <raiz-absoluta> <arquivo-de-credencial> [porta]` inicia uma interface de pré-voo em `127.0.0.1:3185` por padrão. O processo é independente da janela do navegador. Lê a identidade local já vinculada e confere novamente os pacotes importados a cada pedido. A mesma interface adapta a composição para desktop e celular; o celular foi ensaiado como viewport no navegador do computador, não como aparelho na LAN.

O contrato `GET /api/status` informa versão, Câmara, dispositivo, revisão, quantidade de artefatos, integridade do pacote e motivos de bloqueio. Ele não contém chave, senha, bytes de documentos ou concessão. Pacote `ready` significa apenas que os bytes e a assinatura passaram pela conferência existente; `canOpenSession` permanece sempre `false`, pois a autoridade operacional não existe. Respostas não são cacheadas. A prévia atende somente loopback, rejeita outro host e qualquer método de escrita; a interface usa política de conteúdo restritiva e constrói texto de dados por `textContent`.

## Prova local

- `bun run test:local:app`: contrato de bloqueio, erro de pacote, API somente leitura e processo real com identidade/credencial sintéticas.
- `bun run test:local:app:browser`: navegação Chromium em 1440×900 e 390×844, pacote íntegro versus abertura bloqueada, pacote incompleto e falha do inventário sem estado antigo exibido.
- `bun run typecheck`, `bun run lint`, `bun run build`: gates de aplicação.

Resultado local: **16 testes passaram** no conjunto da prévia, CLI anterior, armazenamento de pacotes e diário local; typecheck, lint e build passaram. Capturas da interface realmente renderizada estão em `docs/previews/desktop-mobile-plan/primeiro-ciclo-desktop.png` e `primeiro-ciclo-celular.png`, com fixture sintética de uma revisão íntegra e outra incompleta.

## Limites e próximo incremento

A prévia não tem autenticação de usuário, TLS LAN, dispositivo móvel físico, PDF servido, snapshot/cursor de plenário, Tauri/instalador, concessão de autoridade ou comandos locais. Por isso não aceita conexão de outros dispositivos nem libera voto/presença. O próximo incremento P5 deve especificar e testar autenticação nominal e do dispositivo, certificado TLS utilizável sem DNS externo e contrato de leitura de snapshot/documentos na LAN antes de abrir o serviço para a rede da Câmara.

O plano intercalado e os mockups estão em `docs/superpowers/plans/2026-11-11-desktop-movel-plenario.md`, `docs/previews/desktop-mobile-plan/` e `docs/previews/telao-13/`.
