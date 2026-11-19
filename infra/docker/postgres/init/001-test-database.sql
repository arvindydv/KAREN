-- Local-only: a separate database for integration tests so test runs never touch dev data.
CREATE DATABASE karen_test OWNER karen;
-- Local-only: shadow database used by `prisma migrate diff` drift checks.
CREATE DATABASE karen_shadow OWNER karen;
