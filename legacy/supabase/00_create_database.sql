-- Run this once, connected to the default "postgres" database.
-- CREATE DATABASE cannot run inside the same script/transaction as table creation,
-- so it lives in its own file — run this first, then connect to "passbar" and run schema.postgres.sql.

CREATE DATABASE passbar;
