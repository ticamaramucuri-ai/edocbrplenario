# Etapa 045 — Vault cifrado para a staging sintética

**Estado:** ferramenta e prova local concluídas em 07/11/2026; implantação e prova VPS → computador receptor ainda devem ser registradas nesta etapa. O gate P1 permanece aberto.

## Objetivo e escopo

Criar uma rotina repetível que produza snapshot consistente de PostgreSQL e dos quatro volumes da staging `staging-example`, envie somente bytes cifrados por SSH e aceite a cópia no receptor somente após decifrar e executar `backup-bundle.py verify`. O receptor guarda o certificado e a chave privada; somente o certificado público vai à VPS. A retenção elimina cópias antigas apenas depois do sucesso da nova cópia.

Arquivos: `scripts/staging-snapshot-stream.py` na fonte e `scripts/staging-offhost-vault.py` no receptor. A fonte recusa bancos com outro tenant ou sem gravação fictícia de referência. Ela pausa os quatro escritores durante a cópia, religa-os mesmo se a coleta falhar e cifra o tar antes de enviá-lo pela saída padrão. O receptor grava objeto `.cms` e metadados `.json` sob vault modo 0700, verifica dump e hashes dos arquivos, e mantém por padrão as últimas sete cópias. A decifragem temporária ocorre em diretório privado do receptor e é apagada ao término.

## Procedimento de ensaio

Criar certificado e chave no receptor, com `key.pem` em modo 0600, e copiar **somente** `cert.pem` para um caminho privado na VPS. Exemplo com caminhos deliberadamente genéricos:

```bash
openssl req -x509 -newkey rsa:3072 -nodes -days 365 \
  -subj '/CN=edocbr-staging-backup' -keyout /caminho/privado/key.pem \
  -out /caminho/privado/cert.pem
chmod 600 /caminho/privado/key.pem
python3 scripts/staging-offhost-vault.py \
  --vault /caminho/privado/vault \
  --cert /caminho/privado/cert.pem --key /caminho/privado/key.pem \
  --target suporteplenario@5.183.35.108 \
  --identity /caminho/privado/chave-ssh \
  --remote-repo /home/suporteplenario/edocbr-plenario \
  --remote-cert /caminho/privado/cert.pem --keep 7
```

Executar fora de uma sessão em curso, pois a coleta interrompe temporariamente app, realtime, webhooks e scheduler. O arquivo `.json` do vault contém SHA-256 do objeto cifrado, manifesto e quantidade de arquivos; não contém segredos. O operador deve verificar a saída, `docker compose ps`, `staging-smoke.py` e o observador externo. Cópias em vault devem ser restauradas periodicamente em host isolado para comprovar recuperação da aplicação e mídia, além da conferência automática do pacote.

## Prova e limites

Em 07/11/2026, o ensaio local com certificado RSA temporário produziu objeto cifrado de **4.475.448 bytes**, SHA-256 `1ce1aad7fb4b997e9f88a8a40888d4b5b30ef29805464c97aeb6e088c291c0ac`. O receptor decifrou, conferiu o dump PostgreSQL e **nove arquivos**; SHA-256 do manifesto `75be398796b0b080c838302c7fa2e446122326329855426eb9cdf98d44d0d4ac`. Os arquivos, chave e vault desse ensaio foram apagados após a prova. Os quatro escritores voltaram a operar.

Esta ferramenta ainda **não** configura backup contínuo. O computador local não foi aprovado como destino durável e sempre disponível. Faltam destino com capacidade/redundância, custódia e recuperação da chave, agendamento com controle de sobreposição, alerta entregue a responsável, restauração periódica automatizada, teste de perda total e metas RTO/RPO. O pacote usa CMS cifrado, mas a autenticação de origem depende do SSH e da proteção da VPS/vault; uma assinatura de origem deverá ser avaliada antes de uso institucional. Não usar com dados reais de Câmara nem tratar os tempos do ensaio como SLA.

**Próxima execução P1:** validar o fluxo na VPS sintética; escolher destino independente durável e responsável; configurar agenda/alerta, retenção aprovada, cópia de chave sob custódia e ensaio de restauração após falha simulada. P4 pode começar tecnicamente em paralelo com dados fictícios; a liberação de P1 continua dependente das decisões operacionais.
