# ADR-030 — contrato assinado de autoridade da sessão

**Estado:** contrato implementado; concessão, persistência, revogação e execução oficial pendentes · **Data:** 09/11/2026.

## Decisão

O SaaS emitirá uma concessão Ed25519 versionada para uma Câmara, sessão, dispositivo designado, revisão preparada e SHA-256 do manifesto. A concessão carrega uma época positiva, início e vencimento, com duração máxima de 15 minutos. O cliente verifica assinatura contra chave pública confiada fora de banda, escopo completo, época mínima persistida e validade antes de considerar uma futura operação local autorizada. A assinatura usa prefixo de domínio e campos em ordem fixa; campos extras são rejeitados.

A época será incrementada de modo transacional pelo SaaS na emissão ou comutação. O servidor local deverá persistir a maior época observada e rejeitar épocas menores mesmo após reinício. Uma concessão curta limita a janela de desconexão autorizada; a política de renovação e de operação offline prolongada depende de decisão institucional e de ensaio de reserva. Relógios de SaaS e desktop precisam de monitoramento e tolerância explicitamente projetada; este contrato falha fechado fora da validade.

## Limites e próximos gates

`src/lib/session-authority-contract.ts` implementa somente assinatura e verificação. Ainda não há endpoint de emissão, exclusão mútua no banco central, prova de revogação durante queda de WAN, armazenamento do maior epoch, vínculo do diário ao grant, comando de voto ou conciliação. Assinatura válida não prova que o SaaS não concedeu uma época superior a outro desktop. Nenhum ato oficial deve ser habilitado por este contrato isolado.

Próximo incremento: transação de emissão por sessão no PostgreSQL com único dispositivo ativo, geração monotônica e auditoria; depois persistência local do grant e do maior epoch, gate de comandos, outbox e teste de comutação com dois processos. Seguir [ADR-029](ADR-029-diario-local-de-eventos.md) e [ADR-027](ADR-027-saas-nucleo-local-operacao-offline.md).
