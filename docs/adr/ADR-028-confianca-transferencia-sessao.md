# ADR-028 — confiança e identidade na transferência SaaS → servidor local

**Estado:** arquitetura de segurança em implementação; nenhum endpoint de download ou autoridade offline foi liberado. **Data:** 07/11/2026. Complementa [ADR-027](ADR-027-saas-nucleo-local-operacao-offline.md) e o [contrato P4](../etapas/050-contrato-transferencia-sessao-v1.md).

## Limites de confiança

1. **SaaS e cada Câmara:** autorização por papel e `tenantId` no servidor; um tenant não pode consultar, assinar ou baixar pacote de outro. A chave privada da Câmara é provisionada em diretório separado do repositório e não entra no banco nem na resposta HTTP. O pacote assinado inclui Câmara, sessão, revisão, pauta, regras, composição e hashes de todos os bytes.
2. **SaaS e desktop designado:** TLS protege o transporte. O desktop conhece a chave pública confiável por canal administrativo fora do pacote; a própria resposta de download não pode declarar a chave que deve ser confiada. Cadastro, designação, revogação e verificação Ed25519/nonce estão implementados em ensaio; falta bootstrap físico da chave e download protegido.
3. **Desktop e dispositivos da LAN:** os parlamentares, Mesa e telão obtêm dados do desktop, mas uma assinatura válida do pacote **não** concede direito de votar nem autoridade ao desktop. Usuário, dispositivo e sessão precisam de autenticação e autorização separadas. Ainda não foi implementado.
4. **Desktop e disco local:** revisão só é marcada preparada após verificar manifesto, assinatura e todos os arquivos. O ponteiro troca após gravar a revisão completa; a leitura relê e confere os bytes. A instalação precisa de controle de acesso físico, criptografia e backup/restore homologados antes de uso oficial.

## Ameaças e controles exigidos

| Ameaça | Controle implementado ou exigido | Prova necessária antes de produção |
|---|---|---|
| Troca de bytes, manifesto ou assinatura em trânsito/disco | Ed25519, hash SHA-256 por artefato, chave pública externa ao pacote, releitura local | Negativos para arquivo ausente/adulterado, chave alheia e manifesto alterado; ensaio de transporte real |
| Repetição de pacote antigo ou número de revisão colidente | Importador recusa regressão e mesmo número com conteúdo diferente; revisão atual não muda com pacote inválido | Perda/repetição de resposta, corrida entre revisões e rollback operacional |
| Comprometimento/rotação da chave privada | Chave por Câmara, permissões restritas, impressão digital pública, troca explícita da chave ativa; desktop não confia automaticamente em chave nova | Plano de revogação e distribuição autenticada da nova chave, custódia, backup seguro e incidente de chave |
| Dispositivo falso baixa sessão ou envia comandos | Identidade Ed25519, registro/designação/revogação por Câmara, nonce persistido e expiração de 2 minutos; **download e comando pendentes** | Ensaiar transporte, revogação durante resposta, outra Câmara, relógio e extração de segredo |
| Dois desktops escrevem atos concorrentes | Concessão de autoridade única com época/fencing token, bloqueio central e promoção assistida; **pendente** | WAN cai/retorna, reserva assume, líder antigo tenta gravar, ACK e reconciliação |
| Ator da LAN tenta voto/presença sem permissão | TLS LAN, login nominal, dispositivo autorizado, papel e `commandId` idempotente; **pendente** | Negativos por papel, outro parlamentar, dispositivo revogado e repetição |
| Falha de energia no meio da importação | Diretório de revisão e ponteiro separados; órfão pode ser reconstruído; trava residual exige recuperação manual | Desligamento forçado em Windows/Linux, integridade do sistema de arquivos e backup restaurado |

## Ordem para abrir a API

O [registro do desktop](../etapas/058-identidade-servidor-local.md) e a verificação de pedido assinado com nonce estão implementados. A próxima etapa deve ligar essa autenticação a uma rota TLS que responda apenas ao dispositivo ativo e designado, assine o manifesto com a chave privada da Câmara e entregue os bytes completos. O importador confere com chave pública provisionada antes e devolve ACK por artefato. Só após essa prova serão desenhados concessão de autoridade, comandos e sincronização de atos. O endpoint de download não deve reutilizar credenciais genéricas de API nem `x-actor-id` de demonstração.

O provisionamento sintético atual não representa custódia institucional. O comando `bun run transfer:key:provision -- <tenantId>` requer `EDOCBR_TRANSFER_KEY_ROOT` fora do repositório e imprime somente chave pública, ID e impressão digital; o operador deve distribuir a chave pública por canal administrativo autenticado. A chave privada exige volume/secret mount e backup cifrado com responsáveis definidos.
