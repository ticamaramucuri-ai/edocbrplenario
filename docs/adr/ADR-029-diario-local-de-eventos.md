# ADR-029 — diário local durável de eventos

**Estado:** implementação inicial em ensaio; sem autoridade de sessão ou voto offline · **Data:** 09/11/2026.

## Decisão

O servidor local usa um banco SQLite próprio (`events.sqlite`) dentro da identidade privada de uma Câmara, com WAL e `synchronous=FULL`. Cada sessão mantém sequência monotônica e cursor, e cada `commandId` é único naquela sessão. A gravação do evento e do cursor ocorre numa transação `BEGIN IMMEDIATE`; uma repetição idêntica retorna o evento existente, enquanto comando com mesma chave e conteúdo diferente ou sequência esperada desatualizada falha. O diário vincula Câmara, desktop designado e impressão digital da chave Ed25519. Cada evento inclui o hash anterior, hash canônico e assinatura do desktop. A abertura verifica integridade SQLite, cadeia, assinaturas e cursores; uma divergência impede iniciar o processo de sincronização.

Esta base usa o SQLite **apenas no computador servidor**. Tablets e notebooks nunca compartilham o arquivo por rede. O SaaS receberá eventos assinados por protocolo próprio após P6, não por cópia de tabelas. A escolha de SQLite para o diário não decide sozinha a base de todos os módulos locais nem substitui o motor transacional de presença/voto.

## Limites e consequência

O diário é uma infraestrutura interna. Ainda não valida regra regimental, elegibilidade, voto, autoridade do desktop, concessão com fencing, ACK SaaS, snapshot para dispositivos ou comutação de reserva. O encadeamento e a assinatura detectam adulteração de eventos existentes, mas a eliminação integral do banco requer confronto com backup/ACK externo; a chave privada e o disco ainda exigem custódia e criptografia em P10. O teste atual não simula perda real de energia nem executa o `.exe` em Windows. O modo WAL exige backup coerente do banco e de seus arquivos auxiliares.

Antes de permitir atos oficiais, P4/P6 devem: extrair comandos de domínio determinísticos; conceder uma autoridade por sessão com época/fencing; gravar resultado, auditoria e outbox na mesma transação; comparar os mesmos casos no SaaS e no executor local; testar queda de energia, WAN, réplica e reserva. Nenhum endpoint LAN de escrita será aberto apenas por este ADR.

Referências: [ADR-027](ADR-027-saas-nucleo-local-operacao-offline.md), [ADR-028](ADR-028-confianca-transferencia-sessao.md), [SQLite no Bun](https://bun.sh/docs/runtime/sqlite), [WAL do SQLite](https://www.sqlite.org/wal.html).
