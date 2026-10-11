# Checklist de homologação e corte SQLite→PostgreSQL

**Estado:** preparação. Este documento não autoriza nem executa o corte do piloto.

## Entrada e responsáveis

- Responsável técnico nomeia operador do banco, operador da aplicação/mídia e pessoa de aceite da Câmara; registra janela, canais de comunicação e ponto de decisão.
- Conferir backup íntegro do SQLite **e** dos arquivos de anexos, fotos/emblemas, gravações e replay; registrar horário, hash e teste de restauração. Uma cópia do banco sem os arquivos não conclui a migração.
- Com todos os escritores pausados, `python3 scripts/backup-bundle.py create --database sqlite --sqlite-source CAMINHO --output DESTINO_NOVO --images-root RAIZ_ABSOLUTA --public-root PUBLIC_ABSOLUTO --recordings-root GRAVACOES_ABSOLUTO --replay-root REPLAY_ABSOLUTO` cria pacote com manifesto SHA-256. `verify --bundle DESTINO` confere integridade; `restore-files --bundle DESTINO --target DESTINO_NOVO` copia e reverifica em ambiente isolado. Para PostgreSQL, use `--database postgresql` e `POSTGRES_BACKUP_URL` pelo gerenciador de segredos; o dump é `pg_dump -Fc`. Grave a hora de suspensão das escritas antes de executar. O pacote sozinho não prova restauração funcional: restaurar o dump e validar APIs.
- O cliente `pg_dump` deve ser compatível com o servidor de destino da restauração. Quando necessário, defina `POSTGRES_DUMP_BIN` para um executável da versão adequada; o ensaio da CI usa o cliente PostgreSQL 16 do contêiner. Confirme `pg_restore` e consulta funcional na instância restaurada antes do corte.
- Inventariar referências e manifests com `python3 scripts/audit-external-assets.py --source CAMINHO --strict` e raízes privadas de mídia quando houver gravações. Auditar fotos com `python3 scripts/audit-parliamentarian-images.py --source CAMINHO --root RAIZ_ABSOLUTA --strict`. Resolver toda pendência antes do corte.
- Executar `bun run test:postgres:production-write -- CAMINHO` com uma réplica autorizada e máquina sem instância Next ativa. Registrar contagens, checksum das migrações, tempos de cópia/recuperação, 5xx e diferenças. Não usar o banco ativo como destino.
- Homologar regras regimentais, usuários, papéis, sessões, resultados e equipamentos de captação com a Câmara; validar contas sociais institucionais quando disponíveis.

## Janela de corte

1. Colocar Next e trabalhadores em modo de manutenção e parar **todas** as escritas, jobs, outbox, webhooks e mídia que gravem estado. Anotar o último instante de escrita confirmado.
2. Gerar snapshot final consistente de SQLite e arquivos; verificar `quick_check`, chaves estrangeiras, hashes e capacidade de restaurar. Manter backup protegido e imutável durante a janela.
3. Aplicar migrações versionadas 0001–0010 em PostgreSQL vazio; conferir `db:postgres:status`. Copiar com `db:postgres:copy -- --source CAMINHO_SNAPSHOT` e exigir 75 tabelas, contagens e hash de todas as colunas sem divergência, inclusive bytes dos PDFs da sessão. Se falhar, descartar destino e interromper corte.
4. Gerar build/cliente PostgreSQL da versão exata homologada e configurar **juntos** Next, realtime, webhooks e scheduler. Confirmar ambiente e segredos por serviço, sem expor URLs ou chaves em logs.
5. Antes de liberar escrita, executar leituras públicas e autenticadas de cada Câmara, negação cruzada, login, saúde dos serviços, outbox pendente, webhooks e calendário de jobs; conferir arquivos e reprodução de mídia.
6. Responsáveis registram aceite. Liberar escrita e monitorar erros HTTP, filas, latência, votos, eventos e mídia. Anotar hora da primeira escrita confirmada no PostgreSQL.

## Decisão e retorno

- **Antes da primeira escrita PostgreSQL:** se uma verificação falhar, manter PostgreSQL fora de serviço e restaurar a configuração SQLite original; só reabrir depois de confirmar integridade e serviços.
- **Depois da primeira escrita PostgreSQL:** não retornar diretamente ao snapshot SQLite. Congelar novas escritas, preservar `pg_dump`/WAL e trilhas, avaliar reconciliação de transações com responsáveis técnicos e institucionais. Recuperar PostgreSQL para um ponto consistente é o caminho preferencial; uma reversão para SQLite exige plano de replay e prova de que nenhum voto, ato ou recibo foi perdido.
- Registrar a duração real desde incidente até serviço útil (RTO observado) e o último ato confirmado preservado (RPO observado), incluindo arquivos, filas e mídia. Comparar com metas aprovadas previamente; tempos de laboratório não substituem essas metas.
