# Etapa 045 — Vault cifrado para a staging sintética

**Estado:** ferramenta, prova local, promoção e transferência VPS → computador receptor concluídas em 07/11/2026. O gate P1 permanece aberto.

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

Uma segunda prova local executou duas coletas consecutivas com `--keep 1`: após as verificações restaram exatamente **um** objeto `.cms` e **um** metadado `.json`. Os dois manifestos foram verificados antes da poda. O material temporário também foi apagado.

O PR [#13](https://github.com/e-docBR/edocBRplenario/pull/13) passou nos jobs `application`, `media-smoke` e `postgres-foundation`; o `main` `c2ef6158eef1e7f60b8053b0fe8a3798a1261fcd` repetiu a CI com sucesso. A promoção controlada levou esse SHA à VPS e confirmou app e trabalhadores saudáveis. Em seguida, um certificado público temporário foi enviado à VPS; a chave privada ficou exclusivamente no computador receptor. O fluxo SSH produziu objeto cifrado de **512.567 bytes**, SHA-256 `10a94ddfa76222736388c30bd1e0f92c395c94f2cb6edce99ca8eeaedbd73c71`. O receptor decifrou e verificou dump PostgreSQL e **nove arquivos**, manifesto SHA-256 `5bb57669cddf83649f5075f0f80f9b0a1936f91799e0ce0ec5a74d4189ce11bd`. Certificado remoto, chave, vault e pacote temporários foram apagados após a prova. `staging-smoke.py` autenticou na VPS e confirmou tenant `staging-example`; o HTTPS público retornou `ok` e o mesmo SHA.

Esta ferramenta ainda **não** configura backup contínuo. O computador local não foi aprovado como destino durável e sempre disponível. Faltam destino com capacidade/redundância, custódia e recuperação da chave, agendamento com controle de sobreposição, alerta entregue a responsável, restauração periódica automatizada, teste de perda total e metas RTO/RPO. O pacote usa CMS cifrado, mas a autenticação de origem depende do SSH e da proteção da VPS/vault; uma assinatura de origem deverá ser avaliada antes de uso institucional. Não usar com dados reais de Câmara nem tratar os tempos do ensaio como SLA.

**Próxima execução P1:** validar o fluxo na VPS sintética; escolher destino independente durável e responsável; configurar agenda/alerta, retenção aprovada, cópia de chave sob custódia e ensaio de restauração após falha simulada. P4 pode começar tecnicamente em paralelo com dados fictícios; a liberação de P1 continua dependente das decisões operacionais.
