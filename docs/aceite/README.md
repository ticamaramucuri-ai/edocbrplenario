# Pacote de validação institucional

Cinco formulários para a Câmara preencher **escolhendo**, não redigindo. Cada
opção listada é uma opção que o sistema já sabe cumprir: nada aqui depende de
desenvolvimento novo, salvo onde está escrito `NÃO IMPLEMENTADO`.

Nenhum dado é cadastrado no sistema antes da assinatura do formulário
correspondente. Enquanto um formulário não voltar assinado, a fase que depende
dele permanece aberta — ensaio técnico local não fecha pendência institucional.

| Formulário | Assunto | Quem assina | Fase |
|---|---|---|---:|
| [046 — Matriz regimental](046-matriz-regimental.md) | Tipos de sessão, quórum, maiorias, impedimentos, suplência | Secretaria legislativa + Presidência | 046 |
| [046 — Composição da legislatura](046-composicao-legislatura.md) | Legislatura, mandatos, partidos, Mesa, comissões, licenças | Secretaria legislativa | 046 |
| [047 — Canal de convocação e ciência](047-canal-convocacao.md) | Canal, prazos, comprovante de entrega e de ciência | Secretaria legislativa | 047 |
| [048–049 — Casos de presença e votação](048-049-casos.md) | 10 a 15 casos reais anonimizados com resultado esperado | Mesa | 048–049 |
| [051 — Ata e publicação](051-ata-publicacao.md) | Formato, assinaturas, retificação, retenção, portal | Jurídico + Secretaria | 051 |

## Como preencher

1. Marque uma opção por pergunta (`[x]`). Onde houver `_____`, escreva só o
   número, a data ou o nome pedido.
2. Onde nenhuma opção servir, marque **Outro** e descreva. Isso vira tarefa de
   desenvolvimento antes do cadastro, não cadastro imediato.
3. Assine no rodapé, com nome, cargo e data. Sem assinatura o formulário não
   produz efeito no sistema.

## Depois da assinatura

A configuração é cadastrada, versionada e aprovada no próprio sistema (aba
Configuração oficial), que guarda um SHA-256 do estado aprovado: qualquer
alteração institucional posterior exige nova aprovação. Só então
`bun run pilot:preflight` pode chegar a `automaticReady: true`.
