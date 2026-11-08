# P4/P5 — cliente de transferência do servidor local

**Estado em 08/11/2026:** biblioteca de download e importação pronta para ensaio; ainda não é um aplicativo instalável Windows/Linux.

`downloadAndPrepareSession` recebe a identidade do desktop, a chave privada Ed25519 local, o mapa de chaves públicas da Câmara confiadas por canal administrativo, a sessão e a raiz de armazenamento. Exige origem HTTPS, monta o caminho da sessão sem aceitar credenciais na URL, assina método/caminho/timestamp/nonce, recusa redirecionamento, confere tipo do corpo, lê o transporte limitado e chama o importador atômico. Resposta HTTP não autoriza confiança em chave nova. Mesmo erro de rede, assinatura inválida ou pacote incompleto não promove a revisão local. Repetir o pacote íntegro é idempotente.

O contrato de bytes de pedido foi extraído para `src/lib/local-device-request.ts`, compartilhado pelo cliente e pelo verificador SaaS sem importar banco, autenticação web ou módulos do servidor no processo local.

**Prova:** `bash scripts/test-session-transfer-export.sh` baixa o pacote pela rota em processo com pedido assinado, importa, relê, repete idempotentemente, rejeita chave não confiável e origem sem HTTPS. `bash scripts/test-local-device-identity.sh` cobre o verificador. TypeScript e lint completam o gate. A CI executa ambos.

**Próximo passo:** bootstrap e custódia da chave privada no equipamento, registro administrativo com verificação de impressão digital, distribuição autenticada da chave pública da Câmara, configuração persistente, descoberta de sessões e sincronização agendada. Depois, ACK durável e retomada por artefato; instalar/ensaiar Windows e Linux. Nenhum desses itens é afirmado como concluído por esta biblioteca.
