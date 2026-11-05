# Etapa 049 — Confirmação de voto após perda da resposta

**Estado:** incremento funcional local concluído; homologação regimental e em dispositivos reais pendente.

Quando o App do Parlamentar não recebe resposta por falha de rede ou servidor, a tela conserva em memória o valor e o `commandId` da tentativa. Ela bloqueia outra escolha e mostra **Tentar novamente**. O botão reenvia o mesmo comando. Se a votação mudou ou foi encerrada, o aviso continua visível enquanto a tela permanece aberta, para que o parlamentar possa conferir a tentativa anterior.

No servidor, a repetição do comando já gravado é consultada antes da condição de votação aberta. Assim, o mesmo ator, parlamentar, valor e chave recebem a confirmação do registro anterior mesmo que a Mesa tenha encerrado a votação nesse intervalo. A repetição não cria novo voto, evento de auditoria ou publicação de tempo real. Uma chave reutilizada por outro ator, parlamentar ou valor retorna 409. Comando novo continua proibido após o encerramento. A resposta `receiptPending` deixa de anunciar recibo futuro quando a votação já terminou.

**Verificação:** `bun run test:voting:flow-guards` prova repetição antes e depois do fechamento nas rotas da Mesa e do App do Parlamentar, conflito de ator/valor, comando novo recusado após fechamento, `receiptPending` coerente e auditoria única; typecheck e lint passam. O mecanismo não altera regra de quórum nem resultado apurado.

**Limites:** a tentativa pendente fica somente na memória da aba; fechar ou recarregar o navegador antes da confirmação perde a chave de repetição. O modelo atual guarda no voto apenas o último `commandId`, portanto uma tentativa antiga não pode ser confirmada por essa via depois que outra alteração do mesmo voto foi gravada. Um livro imutável de comandos e uma reconciliação de tentativas após recarga são evoluções futuras. Nenhuma escolha de voto secreto é persistida no navegador por este incremento. Sessões e contas institucionais ainda exigem aceite da Câmara.
