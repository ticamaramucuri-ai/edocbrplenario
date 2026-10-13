# Etapa 045 — Aplicação e serviços na homologação PostgreSQL

**Estado:** stack local isolado em execução com dados sintéticos. Ainda não é implantação institucional.

O `deploy/staging/compose.yaml` executa PostgreSQL 16, Next.js de produção, realtime, webhooks e scheduler. A imagem gera o cliente Prisma para PostgreSQL e compila o Next.js dentro do Docker; o schema SQLite e o cliente do checkout local não são alterados. Banco, fotos, gravações e replay usam volumes nomeados. O banco, a aplicação e o realtime são publicados apenas em `127.0.0.1` nas portas 55432, 3100 e 3103. Webhooks e scheduler ficam na rede privada do Compose. A aplicação em `localhost:3000` permanece separada em SQLite.

O seed é idempotente e cria somente a Câmara fictícia `staging-example` e um administrador sintético (`stage-admin@example.invalid`). A senha e o segredo de tempo real são gerados no arquivo privado `deploy/staging/.env`, ignorado pelo Git e com permissão 0600. Não usar dados reais nessa instância. A interface usa a porta 3103 para Socket.IO; a URL fica embutida no build por `NEXT_PUBLIC_REALTIME_URL`. Se a porta de realtime mudar, é necessário reconstruir a imagem.

```bash
python3 scripts/staging-postgres.py stack-up
python3 scripts/staging-smoke.py
python3 scripts/staging-postgres.py stack-status
python3 scripts/staging-postgres.py stack-stop
```

`stack-stop` preserva PostgreSQL e volumes. O comando `stop` anterior para somente PostgreSQL e deve ser usado depois de `stack-stop`. Para conhecer a senha sintética no próprio computador, leia `STAGE_ADMIN_PASSWORD` do arquivo privado; não a copie para tickets nem para o repositório. A página local fica em `http://127.0.0.1:3100/`.

O ensaio HTTP fez login por cookie, cadastrou um parlamentar fictício, criou sessão em rascunho e confirmou que o rascunho não aparece na API pública. Após reiniciar o contêiner da aplicação, a mesma sessão e o mesmo parlamentar continuaram presentes. Os quatro processos passaram a responder aos healthchecks; a aplicação antiga seguiu respondendo em `localhost:3000`. [Prova estruturada](045-prova-stack-postgres.json).

**Limites desta etapa:** os volumes de mídia estão montados, mas ainda faltam teste de gravação/replay e restauração conjunta de banco+arquivos. Não há MediaMTX nem destino social oficial nesse stack; a entrega SMTP fica desativada sem credenciais. Acesso de navegador por outro host requer gateway/TLS e revisão da URL Socket.IO. A próxima fase técnica é backup/restauração dos volumes e teste de falha/retomada dos workers; depois vêm pré-voo institucional, piloto acompanhado e integração com Nextcloud/Alfresco por último.
