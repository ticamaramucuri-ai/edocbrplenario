# Continuidade operacional da transmissão

Este roteiro vale por sessão e por Câmara. O caminho de mídia é `session-<id da sessão>`; confira o tenant antes de operar. O painel **Mesa do Plenário → Transmissão** reúne quatro evidências distintas: fonte local, encaminhamento RTMPS, link público confirmado por operador e segmentos de gravação. Nenhuma delas, isoladamente, comprova vídeo e áudio disponíveis na rede social.

## Antes de publicar

1. Confirme o OBS/encoder publicando no caminho da sessão e a fonte **pronta** no painel.
2. Ative o destino da Câmara, aguarde `Reconciliação: aplicada` e `Encaminhando`.
3. Confira imagem e som na página pública da plataforma usando outro dispositivo/rede. Só então use **Publicar link**. O endereço deve ser o evento público exato, em `publicUrl`, sem stream key.
4. Confira o link no portal público e no detalhe da sessão. Verifique também a gravação local; número de segmentos exige inspeção posterior de continuidade, áudio e integridade.

## Se a fonte cair

O painel muda para **Sinal local perdido** enquanto o acompanhamento permanece ativo. A intenção de encaminhamento e o link público ficam registrados para permitir reconexão; isso não significa que a plataforma esteja exibindo a live. Verifique OBS, rede local, MediaMTX e o caminho exato da sessão. Depois do retorno, confirme **Acompanhando sinal local**, destino `Encaminhando` e reprodução real na plataforma. Se o evento público não for recuperável, retire o link e comunique pelos canais institucionais.

## Se o destino falhar

Confira `controllerAvailable`, `syncStatus` e `lastErrorCode` no painel. A solicitação persistida será repetida pelo worker `bun run media:reconcile`. Use `bun run media:health` no host da instalação para identificar worker parado, pendência antiga ou destino em erro. Se necessário, reinicie o worker supervisionado, sem cadastrar novo destino nem trocar a stream key durante uma desativação pendente. Depois confirme o estado observado e a página pública.

## Ao encerrar

Desative todos os destinos e espere a aplicação da intenção antes de encerrar o acompanhamento local. Confira o catálogo e uma amostra de gravação com vídeo e áudio. Teste se a URL pública funciona como replay; se não funcionar, retire o link no painel. Guarde evidências operacionais sem incluir URLs RTMPS, stream keys ou credenciais.

O teste integrado `bun run test:media:public-link` simula perda/retorno de sinal, estado do destino, catálogo de gravação e preservação/retirada do link. A prova local com encoder e MediaMTX está em `bun run test:media:smoke`; ela agora interrompe e recupera o encoder e o receptor RTMPS. Em Linux x86_64, `bun run media:prepare-smoke` baixa o MediaMTX v1.21.2 para `/tmp` e verifica o checksum oficial. O ensaio exige FFmpeg e não substitui homologação com a conta real da plataforma.
