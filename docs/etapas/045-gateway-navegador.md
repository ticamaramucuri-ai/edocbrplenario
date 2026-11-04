# Etapa 045 — Gateway de navegador na homologação local

**Estado:** concluído no laboratório sintético; acesso e observação de outro host pendentes.

O navegador agora abre `http://127.0.0.1:3181/`. O Caddy do Compose encaminha apenas a query `XTransformPort=3003` para o serviço realtime e as demais rotas para o app. O build deixa `NEXT_PUBLIC_REALTIME_URL` vazia, para que o cliente use a mesma origem tanto no HTTP quanto no WebSocket. Assim, o bundle não depende do endereço `127.0.0.1:3103` da máquina que abre a página.

Banco, app, realtime, segundo nó, Mailpit e gateway têm bind fixo em `127.0.0.1`. O teste `python3 tests/test-staging-gateway-config.py` injeta `STAGE_BIND=0.0.0.0` e `STAGE_GATEWAY_BIND=0.0.0.0` e verifica no Compose renderizado que nenhuma dessas variáveis publica uma porta. Um acesso externo exigirá proxy TLS do host apontado para `127.0.0.1:3181`, com passagem de WebSocket. O domínio, certificado, controle de acesso e execução em outro host não estão configurados.

## Verificação executada

- `docker compose ... build app`: build de produção concluído.
- `docker compose ... config --quiet`: topologia válida.
- `curl http://127.0.0.1:3181/api/v1/health?ready=1`: HTTP 200 com `database=ready` e `Via: Caddy`.
- `bun scripts/staging-display-browser.mjs`: três telas Chromium; WebSocket no gateway e no segundo nó; quadro congelado, reconexão, troca de sessão, saída por teclado e sete auditorias automatizadas de acessibilidade passaram. [Prova JSON](045-prova-gateway-browser.json).
- Treze sessões antigas do ensaio sintético de corte de rede foram encerradas pelas transições da API, incluindo cancelamento justificado de duas votações ainda preparadas. Nenhuma Câmara real foi alterada.

## Próxima verificação

Em host de homologação separado, configurar TLS e domínio, abrir a interface de outra máquina e executar o navegador e a sonda remota do lado de fora. Repetir então a matriz de falhas com observador externo e medir o reinício do host inteiro. A operação de Mucuri depende também dos dados regimentais e do aceite da Câmara.
