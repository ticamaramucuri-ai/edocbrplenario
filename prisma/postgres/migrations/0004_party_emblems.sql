-- Identidade visual do partido é única por Câmara.
ALTER TABLE "Party" ADD COLUMN "emblemUrl" TEXT;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM "Parliamentarian" WHERE "partyEmblemUrl" IS NOT NULL
    GROUP BY "tenantId", party HAVING count(DISTINCT "partyEmblemUrl") > 1
  ) THEN
    RAISE EXCEPTION 'Emblemas legados conflitantes; resolver por Câmara/partido antes de migrar';
  END IF;
END $$;

UPDATE "Party" p SET "emblemUrl" = m."partyEmblemUrl"
FROM "Parliamentarian" m
WHERE p."tenantId" = m."tenantId" AND p.acronym = m.party
  AND p."emblemUrl" IS NULL AND m."partyEmblemUrl" IS NOT NULL;

INSERT INTO "Party" (id, "tenantId", acronym, name, "emblemUrl", active, "createdAt", "updatedAt")
SELECT 'legacy-party-' || md5(m."tenantId" || ':' || m.party), m."tenantId", m.party, m.party,
       min(m."partyEmblemUrl"), true, now(), now()
FROM "Parliamentarian" m
WHERE m."partyEmblemUrl" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Party" p WHERE p."tenantId" = m."tenantId" AND p.acronym = m.party)
GROUP BY m."tenantId", m.party;

UPDATE "Parliamentarian" m SET "partyEmblemUrl" = p."emblemUrl"
FROM "Party" p WHERE p."tenantId" = m."tenantId" AND p.acronym = m.party
  AND m."partyEmblemUrl" IS DISTINCT FROM p."emblemUrl";
