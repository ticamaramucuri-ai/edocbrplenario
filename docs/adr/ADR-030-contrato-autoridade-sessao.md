# ADR-030 — contrato assinado de autoridade da sessão

**Estado:** contrato e reserva transacional implementados; endpoint, cercamento dos escritores web, revogação e execução oficial pendentes · **Data:** 09/11/2026.

## Decisão

O SaaS emitirá uma concessão Ed25519 versionada para uma Câmara, sessão, dispositivo designado, revisão preparada e SHA-256 do manifesto. A concessão carrega uma época positiva, início e vencimento, com duração máxima de 15 minutos. O cliente verifica assinatura contra chave pública confiada fora de banda, escopo completo, época mínima persistida e validade antes de considerar uma futura operação local autorizada. A assinatura usa prefixo de domínio e campos em ordem fixa; campos extras são rejeitados.

A época será incrementada de modo transacional pelo SaaS na emissão ou comutação. O servidor local deverá persistir a maior época observada e rejeitar épocas menores mesmo após reinício. Uma concessão curta limita a janela de desconexão autorizada; a política de renovação e de operação offline prolongada depende de decisão institucional e de ensaio de reserva. Relógios de SaaS e desktop precisam de monitoramento e tolerância explicitamente projetada; este contrato falha fechado fora da validade.

## Limites e próximos gates

`src/lib/session-authority-contract.ts` implementa assinatura e verificação. `src/lib/server/session-authority-lease.ts` reserva uma única concessão vigente por sessão em transação serializável, após conferir designação, sessão publicada, revisão atual e ACK integral. O mesmo desktop recebe a concessão existente ou renova próximo do vencimento; outro desktop só recebe após o vencimento, sempre com época maior. A reserva é auditada. A chave de assinatura é injetada no serviço, ainda sem custódia institucional ou endpoint público. A FK impede excluir o dispositivo atualmente referenciado; a época permanece na linha da sessão após a troca.

Ainda não há cercamento de todas as mutações web, prova de revogação durante queda de WAN, armazenamento local da maior época, vínculo do diário ao grant, comando de voto ou conciliação. Assinatura válida não prova que o SaaS não concedeu uma época superior a outro desktop. Nenhum ato oficial deve ser habilitado por este contrato isolado.

A transação passou em PostgreSQL descartável com três processos independentes. Próximo incremento: provisionar chave confiável, cercar os escritores web durante a autoridade local e expor emissão autenticada só depois desses gates. Em seguida persistir o grant e a maior época no desktop, conectar comandos, outbox e reconciliação. Seguir [ADR-029](ADR-029-diario-local-de-eventos.md) e [ADR-027](ADR-027-saas-nucleo-local-operacao-offline.md).
