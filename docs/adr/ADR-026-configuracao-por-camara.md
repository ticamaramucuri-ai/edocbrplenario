# ADR-026 — Configuração por Câmara no edocBR Plenário

**Data:** 11/10/2026 · **Estado:** aceita como diretriz de desenvolvimento. A implementação de todas as políticas listadas abaixo é incremental.

## Contexto

O edocBR Plenário é um SaaS multi-Câmara. Tipos de sessão, quóruns, maioria, fala, pauta, publicidade, documentos, mídia e identidade visual podem diferir entre Câmaras. Um padrão conveniente para o piloto não pode virar regra oculta para os demais clientes. A configuração também não pode permitir uma combinação inválida que produza um resultado deliberativo inconsistente.

## Decisão

1. Cada opção de negócio pertence a um `tenantId` e é lida e validada no servidor. Interfaces usam as mesmas opções para orientar o operador, mas não são a barreira de autorização.
2. Padrões explícitos preservam instalações existentes e servem para ensaio; uma Câmara só recebe configuração oficial após revisão de seu regimento e aceite dos responsáveis. Mucuri não fornece valores universais a outras Câmaras.
3. Políticas que afetam um ato são versionadas ou copiadas para esse ato no momento da confirmação. Mudança posterior da Câmara só afeta operações futuras; retificações referenciam a versão anterior.
4. Recursos da plataforma (por exemplo, limites do plano, segurança mínima e disponibilidade de mídia) e escolhas da Câmara têm camadas diferentes. A configuração da Câmara nunca amplia permissão além do plano nem reduz controle de segurança obrigatório.
5. Configurações de alto impacto exigem RBAC, validação, auditoria de antes/depois e prévia das consequências. Não se permitem chaves arbitrárias de JSON nas APIs públicas de configuração.
6. Toda consulta, evento, cache, arquivo, revisão de pauta, chave de transmissão e teste deve preservar o isolamento entre Câmaras. Testes multi-tenant verificam tanto a diferença de comportamento quanto a impossibilidade de ler dados de outra Casa.

## Ordem de aplicação

- **Implementado na etapa 011:** tipos de sessão habilitados, secretário obrigatório e mínimo de matérias por Câmara; snapshot da política na publicação inicial.
- **Implementado na etapa 012:** emendas à pauta convocatória respeitam o mínimo vigente da Câmara e guardam justificativa, diferença e política por revisão; o portal apresenta a revisão atual.
- **Próximas etapas:** política regimental por tipo de sessão/votação (quórum de instalação e deliberação, elegibilidade, maiorias, desempate, Presidência), tempos de fala, atos de alteração de pauta e publicação, modelos documentais, regras de privacidade e acessibilidade.
- **Transmissão:** destinos, contas, perfis de encoder, retenção e publicação do replay por Câmara, com segredo em cofre e capacidade dependente do plano; nenhum canal social deve ser global para todas.
- **Infraestrutura:** PostgreSQL, isolamento testado entre tenants, migrações e ensaio de alterações de política sob concorrência antes de produção.

## Consequências e limites

Uma configuração mais ampla aumenta o espaço de testes: cada política nova precisa de teste de validação, padrão, efeito futuro, snapshot e isolamento. A etapa 011 congela apenas a regra da **publicação inicial** da pauta; ainda não oferece histórico completo de emendas nem política regimental suficiente para votação oficial. Quando a política de votação for implementada, o motor atual deverá deixar de inferir maioria/quórum a partir de padrões genéricos.
