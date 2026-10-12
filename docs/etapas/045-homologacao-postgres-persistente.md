# Etapa 045 — PostgreSQL persistente de homologação local

**Estado:** banco isolado provisionado; aplicação e serviços ainda não migrados.

`deploy/staging/compose.yaml` mantém PostgreSQL 16 em volume Docker nomeado e publica a porta 55432 somente em `127.0.0.1`. `python3 scripts/staging-postgres.py up` cria uma senha aleatória em `deploy/staging/.env` (ignorado pelo Git, permissão 0600), inicia o banco e aplica as migrações versionadas 0001–0013. Não copia o SQLite ativo nem aponta o Next.js para esta instância. `status` consulta o banco; `restart-proof` grava um marcador técnico temporário, reinicia somente o contêiner, confirma que o marcador persistiu e remove a tabela de prova. `stop` para o contêiner sem apagar o volume ou a senha.

Comandos no diretório do projeto:

```bash
python3 scripts/staging-postgres.py up
python3 scripts/staging-postgres.py restart-proof
python3 scripts/staging-postgres.py status
# Quando não precisar do banco ligado:
python3 scripts/staging-postgres.py stop
```

**Evidência local:** [prova JSON](045-prova-postgres-persistente.json). As 13 migrações foram aplicadas, o banco respondeu em loopback e o marcador sobreviveu ao reinício do contêiner. O volume permanece disponível para a próxima etapa. A aplicação de demonstração continuou respondendo em `localhost:3000` sobre SQLite; não houve corte, cópia de dados oficiais ou ensaio de recuperação de mídia. O tempo de reinício nesta prova mede somente a consulta ao banco, não RTO da aplicação.

As consultas de saúde de realtime e webhooks aceitam `REALTIME_HEALTH_URL` e `WEBHOOKS_HEALTH_URL`; o worker de correio aceita `MAIL_WORKER_HEALTH_HOST`. O padrão do worker é loopback. Em uma rede privada de contêineres, `0.0.0.0` só deve ser usado sem publicação da porta 3006; isso prepara a próxima ligação dos serviços sem abrir o health à internet.

**Próximo incremento técnico:** gerar cliente e build PostgreSQL em ambiente isolado, ligar Next.js e os três serviços ao banco de homologação, configurar diretórios persistentes para fotos/documentos/gravações/replay e fazer uma jornada completa com dados sintéticos. Depois, injetar queda de serviço e banco e medir retorno até HTTP útil, filas e mídia. A implantação institucional, contas oficiais, SMTP real e metas RTO/RPO exigem aceite e ambiente da Câmara; Nextcloud e Alfresco continuam para o fim.
