# Etapa 048 — Repetição segura do auto check-in no navegador

**Estado:** incremento funcional local concluído; uso institucional permanece sujeito ao aceite da Câmara.

O App do Parlamentar guarda no navegador apenas o UUID do auto check-in pendente, associado ao ator e à sessão. Se a resposta HTTP se perder e a aba for recarregada, um novo toque usa a mesma chave; a API devolve o evento já gravado sem duplicar presença, auditoria ou tempo real. Quando o servidor confirma a presença, o app apaga a chave. Ao iniciar outra sessão, uma chave nova é criada. O armazenamento bloqueado não impede a tentativa, mas perde essa proteção entre recargas.

O app também envia o ID da sessão que apresentou ao parlamentar. Se a sessão-alvo no servidor mudou antes do recebimento, a API responde 409 e não registra presença na sessão nova. Clientes anteriores, sem esse campo, continuam aceitos.

Na votação aberta, a API agora rejeita com 409 um `commandId` reutilizado com outro valor, mesmo quando o parlamentar é o mesmo. Repetição do mesmo comando continua retornando o voto anterior sem novo lançamento. Este ajuste não armazena escolha de voto no navegador. Uma tentativa de voto sem resposta ainda requer conferência do estado antes de uma nova escolha; a reconciliação completa do histórico de comandos de alteração do voto exige evolução própria do modelo.

**Verificação:** `tests/pending-checkin.test.ts` cobre repetição após remount, separação por ator/sessão, limpeza, registro corrompido e armazenamento bloqueado. `tests/attendance-commands.test.ts` cobre sessão divergente e repetição oficial. `tests/voting-flow-guards.test.ts` cobre repetição idêntica, conflito de valor e auditoria única. Testes de domínio, lint e typecheck passaram. O teste do navegador entra no CI.

**Próxima dependência:** validar com parlamentares e equipe da Câmara o uso em dispositivos reais, quedas de rede e transições da sessão. As regras regimentais oficiais continuam pendentes; nenhuma operação real foi executada.
