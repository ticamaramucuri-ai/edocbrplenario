-- Etapa 010: contador por Câmara/ano, inicializado pelas sessões existentes.
-- Aplicar em backup/cópia antes da base local; não executar db:push --accept-data-loss.
BEGIN TRANSACTION;
CREATE TABLE IF NOT EXISTS "SessionNumberCounter" (
  "tenantId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "lastNumber" INTEGER NOT NULL,
  PRIMARY KEY ("tenantId", "year"),
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "SessionNumberCounter" ("tenantId", "year", "lastNumber")
SELECT "tenantId", "year", MAX("number") FROM "Session" GROUP BY "tenantId", "year" HAVING 1 = 1
ON CONFLICT("tenantId", "year") DO UPDATE SET
  "lastNumber" = MAX("SessionNumberCounter"."lastNumber", excluded."lastNumber");
COMMIT;
