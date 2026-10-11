# Etapa 025 — Conferência e link público da transmissão

**Data:** 11/10/2026 · **Estado:** implementada e verificada localmente.

O painel da sessão apresenta fonte, destinos encaminhando, segmentos de gravação e publicação do link. Cada Câmara configura seus próprios destinos no arquivo privado. A URL de visualização (`publicUrl`) é distinta da URL RTMPS com chave. O operador confere vídeo e áudio na plataforma antes de publicar o link. O sistema exige fonte pronta, intenção aplicada e saída RTMPS observada, grava a confirmação na auditoria e publica a URL no portal ao vivo e no detalhe público da sessão. O link pode ser retirado e fica preservado no registro após o encerramento para eventual replay, sujeito à conferência do operador.

O endpoint usa permissão `media.manage`, versão otimista e idempotência. O portal somente recebe o endereço HTTPS de visualização. O teste integrado em banco descartável cobre isolamento entre Câmaras, falta de confirmação, reconciliação pendente, destino ocioso, perda de sinal, publicação, repetição do comando, retirada, auditoria sem stream key e visibilidade pública ao vivo e histórica. Executar `bun run test:media:public-link`.

**Implantação local:** o schema adiciona três colunas opcionais em `Transmission`. SQL de referência em [025-transmission-public-link.sql](../../prisma/sql/025-transmission-public-link.sql). Aplicar em cópia de segurança antes de atualizar o app. O arquivo de destinos continua fora do repositório; `publicUrl` é opcional e configurado por Câmara.

No ambiente local de desenvolvimento, foi criada a cópia `db/custom.db.backup.media-public-link-20261011` e aplicada a migração aditiva ao banco `db/custom.db`.

**Limite:** a API do MediaMTX comprova apenas transporte. A publicação real nas redes, áudio, latência e disponibilidade do replay precisam de homologação com contas institucionais e observação externa. O sistema não tem credenciais de plataformas neste ambiente.

**Próxima etapa:** ensaio de transmissão ponta a ponta com conta de teste institucional: queda/reconexão da fonte, recuperação do worker, gravação, checagem externa em dispositivo separado e medição de latência. Depois, consolidar operação multi-Câmara e seguir para as integrações com Nextcloud e Alfresco somente no final do projeto.
