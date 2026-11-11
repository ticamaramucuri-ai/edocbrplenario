# Etapa 090 — Login, MFA e usuários

**Fase:** L1/L5, identidade e segurança  
**Data:** 10/11/2026  
**Ambiente:** Linux, Bun 1.4.2, SQLite temporário via `mktemp`; sem serviço externo

## Incremento e comando

Adicionei `tests/auth-mfa-users.test.ts`, `scripts/test-auth-mfa-users.sh` e o comando `bun run test:auth:mfa-users`. O código TOTP é produzido localmente com a implementação RFC 6238 do próprio projeto; a jornada percorre os handlers com cookie real de sessão.

```sh
bun run test:auth:mfa-users
```

**Resultado:** 1 teste aprovado, 38 assertions, zero falhas.

## Cobertura observada

- Senha incorreta retorna falha genérica; senha correta emite cookie `HttpOnly` e autentica `/auth/me`.
- Setup retorna segredo/URI uma vez; código inválido não habilita MFA; TOTP válido habilita; status expõe somente `mfaEnabled`.
- Login somente por senha é bloqueado sem criar cookie quando MFA está ativo; código MFA incorreto falha e válido cria sessão com `mfaVerifiedAt`.
- Cadastro/listagem de usuários é restrito ao tenant e não expõe hash de senha; duplicidade e parlamentar sem vínculo são recusados.
- Auto-desativação é recusada; troca de senha revoga sessão do usuário; senha antiga falha e nova funciona; edição cross-tenant é negada.
- Desativação do MFA exige senha e TOTP corretos e remove o segredo persistido; login normal volta a funcionar.

## Limites

Não foi exercitada a interface de configuração/QR, recuperação de conta, reset por fluxo administrativo completo, vínculo e troca de parlamentar em todos os papéis, nem a matriz global de autorização de cada rota. O ambiente é local sintético; não mede política de MFA institucional nem autenticação via IdP externo.
