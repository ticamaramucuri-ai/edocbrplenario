# Etapa 004 — Controle de destinos RTMPS

**Data:** 10/10/2026 · **Estado:** em andamento. Controle local implementado; homologação social e resiliência distribuída pendentes.

## Entrega

O papel `media_operator` pode acompanhar o sinal e controlar destinos, sem
permissão para votação, presença ou transições da sessão. A administração da
Câmara pode criá-lo e editá-lo. O painel mostra destinos configurados apenas
para o tenant da sessão, com estado `disabled`, `idle`, `forwarding` ou `error`
e bytes de saída. A nova API aciona o `forward` de cada caminho pelo MediaMTX
v1.21.2; início exige sinal local confirmado e encerramento do acompanhamento
exige desativar todos os destinos. O arquivo de chaves fica fora do banco e do
repositório, com permissão restrita. A resposta ao navegador e a auditoria
contêm apenas identificadores, nunca a URL RTMPS ou a stream key.

Os arquivos principais são
[adaptador](../../src/lib/server/media-control.ts),
[API](../../src/app/api/v1/sessions/[id]/transmission/destinations/route.ts),
[painel](../../src/modules/plenary/transmission-tab.tsx) e
[guia operacional](../transmissao/destinos-rtmps.md).

## Verificações

- Testes de isolamento por tenant, permissões do arquivo, idempotência de
  liga/desliga, preservação de outros encaminhamentos e ocultação da chave.
- TypeScript, ESLint e build do app.
- Control API real do MediaMTX v1.21.2 em loopback: GET da configuração,
  PATCH de destino, lista de estado, desativação e reativação pelo adaptador.
  O teste verificou `idle` sem fonte.
- `bun run test:media:smoke` com o adaptador real: FFmpeg publicou vídeo e
  áudio RTMP; a API ativou um destino RTMPS local; o estado chegou a
  `forwarding`; origem e destino gravaram arquivos H.264/AAC válidos. A prova
  usou dois servidores MediaMTX locais, não uma conta social.

## Limites e próxima etapa

O arquivo de destinos é configuração de piloto, não um cofre/serviço de
segredos. A serialização das alterações é local ao processo; múltiplas
réplicas exigem controlador único, fila e reconciliação persistente. A
auditoria grava solicitação antes do PATCH e resultado depois; uma falha entre
PATCH e confirmação pode deixar o serviço alterado sem auditoria final, sendo
necessário conferir o GET. O estado `forwarding` confirma transporte, não
publicação pública. Não há controle do OBS, prova de gravação contínua,
alertas automáticos nem credenciais institucionais configuradas.

Na etapa 005, implementar controlador durável e reconciliação após reinício,
eventos/alertas para perda de sinal e falhas de destino, confirmação de
gravação e prévia. Depois, homologar com câmeras, mixer/áudio, rede e contas
da Câmara, com ensaio completo e aceite operacional. A migração definitiva
para PostgreSQL e execução do CI remoto continuam dependências de produção.
