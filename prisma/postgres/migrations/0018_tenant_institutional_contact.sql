-- Contatos institucionais próprios de cada Câmara; existentes permanecem sem dados.
ALTER TABLE "Tenant" ADD COLUMN "contactAddress" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactPostalCode" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactGeneralPhone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactAlternatePhone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactOmbudsmanPhone" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactGeneralEmail" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactProtocolEmail" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactOmbudsmanEmail" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactWebsiteUrl" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactServiceHours" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "contactSessionHours" TEXT;
