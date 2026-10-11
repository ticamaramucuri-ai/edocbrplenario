# Etapa 001 — Segurança de acesso e base de mídia

**Data:** 10/10/2026 · **Estado:** concluída para o escopo desta etapa. O sistema como um todo continua em piloto, sem liberação para sessões oficiais.

## Objetivo

Bloquear os dois acessos indevidos mais imediatos identificados na análise inicial e escolher componentes candidatos para a transmissão ao vivo sem impor ferramentas ao hardware ainda desconhecido da Câmara.

## Entregue

1. A API só aceita `x-actor-id` quando `LEGIS_DEMO_MODE=true` **e** `NODE_ENV` não é `production`. Sem sessão por senha e sem esse modo explícito, as rotas privadas devolvem 401. O bootstrap anônimo não lista usuários nem devolve contagens/sessões internas; a interface só apresenta escolha de perfis quando o modo demo está ativo.
2. `GET /api/v1/realtime/token` exige a mesma autenticação da API e emite concessão HMAC com tenant, ator e validade de 120 segundos. O serviço de tempo real exige essa concessão para a sala interna, confere assinatura/tenant/prazo e encerra a conexão no vencimento; o cliente busca outra concessão na reconexão. A sala pública continua disponível para os eventos já sanitizados.
3. O caminho do banco do serviço de tempo real passou a ser relativo ao projeto, com `REALTIME_DB_PATH` opcional para testes/implantação. A chave compartilhada `REALTIME_AUTH_SECRET` precisa ter pelo menos 32 bytes e estar no ambiente da API e do serviço; ausente, o acesso interno falha fechado.
4. Testes de unidade para assinatura, expiração, alteração de token e habilitação do demo; smoke de Socket.IO para acesso público, acesso interno válido, sem token e de outro tenant.
5. `.env.example` descreve a configuração sem guardar segredo e `.gitignore` protege dependências, bases locais, gravações, logs e arquivos de ambiente quando o controle de versão for ativado.

## Pesquisa e escolha inicial de mídia

**OBS Studio** é o candidato para a estação de produção do plenário: cenas, fontes de câmera/captura, mixagem de áudio e saídas de transmissão e gravação independentes. [Fontes do OBS](https://obsproject.com/kb/sources-guide) · [Visão geral](https://obsproject.com/kb/OBS-Studio-Overview).

**MediaMTX** é o candidato para receber uma única contribuição local, encaminhá-la por RTMPS a destinos sociais, gravar segmentos e fornecer métricas. Sua documentação cobre [encaminhamento, inclusive RTMPS](https://mediamtx.org/docs/features/forward), [gravação](https://mediamtx.org/docs/features/record) e [métricas](https://mediamtx.org/docs/features/metrics). **FFmpeg** fica como ferramenta de diagnóstico/transcodificação apenas quando um destino exigir perfil diferente; a operação normal não dependerá de scripts avulsos.

Isso é uma **hipótese técnica**, ainda sem implantação. Na próxima prova, comparar qualidade e falha de OBS→MediaMTX→destino com OBS→destino direto, usar câmeras/mesa de som da Câmara e medir CPU, banda, latência, perda de quadros, áudio e integridade da gravação. Não há contas sociais, chaves nem vídeo real configurados neste repositório.

## Verificação executada

- `bun run test:security`: **3 testes, 0 falhas**.
- `bun run lint`: **passou**.
- Servidor Next local com cópia temporária do banco e modo demo desligado: bootstrap anônimo **200, 0 atores, contagens zeradas**; ID de usuário ativo via `x-actor-id` em rota privada **401**; login por senha fictícia **200**; token de tempo real com cookie **200**.
- Serviço Socket.IO local contra essa cópia: público **aceito**; interno sem token **rejeitado**; interno com token de outro tenant **rejeitado**; interno com token correto **aceito**.
- `tsc --noEmit` ainda falha por erros preexistentes distribuídos no repositório (principalmente assinatura `NextRequest`/`Request`, tipos dos mini-serviços e código fora desta etapa). Isso impede usar a checagem de tipos como gate geral agora e entra na próxima etapa. A rota nova de token foi escrita com `Request` para não acrescentar esse erro.

## Limites e riscos remanescentes

- O piloto ainda usa SQLite e voto secreto com associação entre parlamentar e valor no banco. Não está pronto para deliberação oficial.
- A concessão de WebSocket dura até 120 segundos; revogação de uma sessão já conectada passa a valer até o próximo vencimento/reconexão. É necessário ensaiar encerramento e rotação de segredo antes da implantação.
- A cópia analisada não contém um repositório Git operacional nem `.github/workflows`; a esteira de CI precisa ser criada quando o controle de versão for estabelecido.
- Não foram instaladas skills ou plugins: a alteração foi feita e verificada com ferramentas do próprio projeto. Uma skill só fará sentido quando houver procedimento repetido e estável, por exemplo homologação de sessão ou operação de mídia.

## Próxima etapa esperada — 002: qualidade e prova de transmissão

**Entrada:** esta etapa documentada; relação de equipamentos, rede e canal institucional da Câmara piloto. A prova local com fontes sintéticas pode começar antes desses dados.

**Trabalho:** normalizar os erros de tipo em lotes e tornar `tsc` bloqueante; implantar CI de lint/testes/tipos; criar ambiente de mídia reproduzível com OBS ou fonte sintética e MediaMTX; provar ingestão, gravação, RTMPS de teste, métricas e falha/reconexão; especificar contrato do Painel de Transmissão.

**Saída:** build e testes passando no CI, gravação íntegra e recuperável, medição de transmissão com fonte sintética e com equipamento real, definição aceita dos controles do operador e plano de credenciais para cada destino.
