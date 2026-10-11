# Destinos RTMPS por Câmara — piloto local

O painel da sessão ativa/desativa encaminhamentos RTMPS do MediaMTX. Ele mostra
o estado do transporte (`idle`, `forwarding`, `error`) e bytes enviados. O
operador deve conferir o recebimento e a publicação na interface da rede
social antes de declarar a live pública.

## Preparação

1. Instale MediaMTX v1.21.2 em host controlado e publique o programa do OBS
   com vídeo H.264 e áudio AAC no caminho `session-<id da sessão>`.
2. Cadastre esse caminho explicitamente no arquivo de configuração do
   MediaMTX, com `source: publisher`. Habilite `api: yes` e `metrics: yes`,
   vinculando `apiAddress` e `metricsAddress` a `127.0.0.1`. Configure
   autenticação de publicação e leitura conforme o ambiente. Não exponha a
   Control API à rede pública.
3. Defina `MEDIA_CONTROL_URL=http://127.0.0.1:9997` e
   `MEDIA_METRICS_URL=http://127.0.0.1:9998/metrics` no servidor da aplicação.
   O app aceita somente endereços HTTP de loopback para essas duas APIs.
4. Crie fora do repositório um JSON privado, com permissão `0600` ou `0400`,
   apontado por `MEDIA_DESTINATIONS_FILE`. Cada item deve ter `tenantId` real,
   `id`, `label`, `platform` (`youtube`, `facebook`, `instagram`, `other`) e
   `dest` no formato `rtmps://servidor/caminho#chave`. Exemplo estrutural sem
   credencial real:

```json
[
  {
    "tenantId": "ID_DA_CAMARA",
    "id": "youtube-oficial",
    "label": "Canal oficial",
    "platform": "youtube",
    "dest": "rtmps://SERVIDOR_DE_INGESTAO/CAMINHO#CHAVE_DE_TESTE"
  }
]
```

O `tenantId` corresponde ao ID interno da Câmara, não ao nome ou slug. O
arquivo inteiro deve ficar legível apenas pelo usuário do processo do app.
O campo opcional `destFingerprint` aceita SHA-256 hexadecimal do certificado
apenas para ensaios com destino TLS próprio e certificado autoassinado; em
produção, prefira certificado TLS válido.
Guarde as chaves originais em cofre institucional e faça rotação após testes.
Não cole URLs com chave em chamados, logs ou capturas de tela. A Control API
do MediaMTX também devolve a URL completa a clientes autorizados; restrinja
acesso ao host e não publique esse serviço em proxy público.

## Operação

No painel **Mesa do Plenário → Transmissão**, prepare o acompanhamento,
publique o programa no OBS, confirme o sinal e só então ative cada destino.
Mantenha o worker `bun run media:reconcile` supervisionado com as mesmas
variáveis `DATABASE_URL`, `MEDIA_CONTROL_URL`, `MEDIA_METRICS_URL` e
`MEDIA_DESTINATIONS_FILE` do app. O clique grava uma solicitação; aguarde
`Reconciliação: aplicada` e confira o estado observado antes de prosseguir.
Há um [modelo de serviço systemd](../../deploy/systemd/legis-media-reconcile.service.example)
para adaptar aos caminhos, usuário e política de acesso da instalação.
Execute `bun run media:health` com o mesmo `DATABASE_URL` para verificar o
worker e a fila. O comando produz JSON e retorna 0 para saudável, 2 para
worker parado, pendência antiga ou destino em erro, e 3 se a consulta falhar.
Instale o [timer de exemplo](../../deploy/systemd/legis-media-health.timer.example)
e encaminhe falhas da unidade ao monitoramento operacional da Câmara; o
timer por si só não envia alertas externos.
`forwarding` e aumento de bytes indicam saída do MediaMTX, mas não provam que
a plataforma publicou a live. Confira vídeo e áudio em um dispositivo externo.
Ao encerrar, desative todos os destinos antes de encerrar o acompanhamento
local. Se a fonte cair, o estado mostra perda de sinal; a configuração de
encaminhamento permanece até ação do operador.

Alterações via Control API são estado operacional do MediaMTX. Um reinício pode
restaurar o arquivo de configuração anterior; o worker verifica a cada ciclo
e reaplica a intenção guardada no banco. Se o serviço falhar, a solicitação
continua pendente/com erro e recebe nova tentativa com intervalo progressivo.
O lease da intenção evita que dois workers apliquem simultaneamente o mesmo
destino; um segundo lease por caminho serializa alterações de destinos
diferentes na mesma sessão. Se o caminho ficar ocupado, o worker tenta de
novo e expõe `MEDIA_PATH_BUSY` como erro operacional. Mantenha o worker como serviço supervisionado; sem ele, a
solicitação fica pendente. Não remova/rotacione uma chave do arquivo privado
antes de desativar o destino e conferir a aplicação, pois o worker precisa da
URL antiga para retirar um encaminhamento já configurado.

## Critérios para homologação com conta institucional

- Stream key de teste por plataforma, permissões da conta, política de
  publicação e consentimento institucional definidos.
- Vídeo e áudio validados na plataforma, com retorno externo e medição de
  latência, perdas e estabilidade durante sessão completa.
- Ensaio de falha de WAN, queda do encoder, recuperação, reinício do servidor
  e rotação da chave; registro local e gravação conferidos.
- Operadores treinados para iniciar, conferir e encerrar cada destino.
