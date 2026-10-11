# Etapa 028 — Gravação verificável e replay local

**Data:** 11/10/2026 · **Estado:** implementação e teste local concluídos; aceite institucional do vídeo pendente.

Após encerrar a sessão e a mídia, o operador pode preparar um replay MP4 a partir dos segmentos MediaMTX. O sistema inspeciona H.264/AAC, registra duração, tamanho e SHA-256 de cada segmento, identifica lacunas temporais e grava um manifesto associado à sessão e à Câmara. O arquivo derivado fica fora do banco, em diretório privado, com SHA-256 próprio. Publicação e retirada são ações separadas, auditadas, versionadas e idempotentes. Lacunas exigem justificativa explícita. O portal mostra um player apenas para replay publicado e dentro do prazo de visibilidade da Câmara.

O endpoint público valida Câmara e sessão, confere SHA-256 antes de servir e aceita Range para reprodução. O teste integrado gera segmentos de vídeo/áudio, detecta alteração do original antes de publicar, comprova acesso parcial, nega outra Câmara, detecta adulteração do replay, restaura cópia íntegra, confirma H.264/AAC e retira o vídeo do portal. O teste roda com banco descartável em `bun run test:media:archive` e integra a CI. Typecheck, lint e build são gates adicionais.

**Configuração:** `MEDIA_RECORDINGS_ROOT` aponta para o diretório privado onde o MediaMTX salva `session-<id>/*.mp4`; `MEDIA_REPLAY_ROOT` aponta para diretório privado separado, com espaço para o MP4 derivado. Ambos devem ser absolutos, existentes, sem acesso público e acessíveis ao processo do app. `ffmpeg` e `ffprobe` são necessários no host. Em Configurações da Câmara, `replayVisibilityDays` limita a exibição pública; vazio significa retirada manual. O prazo não apaga originais, que dependem de política documental institucional. SQL revisável em [028-recording-archive.sql](../../prisma/sql/028-recording-archive.sql).

No banco local de desenvolvimento, foi criada `db/custom.db.backup.recording-archive-20261011` antes da migração aditiva. Nenhum replay real foi publicado para Mucuri.

**Limites:** este fluxo comprova integridade dos bytes registrados e codecs, mas a análise editorial do vídeo completo, sincronização percebida, acessibilidade, retenção legal e aceite institucional exigem revisão humana. O armazenamento local ainda não oferece replicação ou backup automatizado do acervo; isso integra a fase operacional SaaS. A verificação SHA-256 a cada acesso público é conservadora e deverá ser medida sob carga antes da produção.

**Próxima fase:** jornada completa de sessão fictícia com duas Câmaras, testes de concorrência, presença, pauta, votação, correção, ata, transmissão e indisponibilidade de mídia sem bloquear atos legislativos.
