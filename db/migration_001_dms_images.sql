-- ============================================================
-- Migration 001: DMs + Bild-Posts
-- Auf bestehender Installation anwenden mit:
--   docker exec -i nexus_db psql -U nexus -d nexus < db/migration_001_dms_images.sql
-- ============================================================

-- 1) image_url an Posts anhängen
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2) Messages-Tabelle für DMs
CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at     TIMESTAMPTZ,
    CHECK (sender_id <> receiver_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_sender   ON messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages (receiver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_pair     ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC);
