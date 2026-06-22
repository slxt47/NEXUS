-- ============================================================
-- NEXUS schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS ------------------------------------------------------
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    username      TEXT UNIQUE NOT NULL,
    display_name  TEXT NOT NULL,
    bio           TEXT NOT NULL DEFAULT '',
    avatar        TEXT,                       -- data URL (komprimiert) oder NULL
    is_owner      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_username ON users (username);

-- EMAIL-CODES ------------------------------------------------
CREATE TABLE verification_codes (
    email      TEXT PRIMARY KEY,
    code       TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    verified   BOOLEAN NOT NULL DEFAULT FALSE,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE  -- gesetzt nach Verify
);

-- POSTS ------------------------------------------------------
CREATE TABLE posts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    reply_to   UUID REFERENCES posts(id) ON DELETE CASCADE,
    repost_of  UUID REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_posts_created  ON posts (created_at DESC);
CREATE INDEX idx_posts_author   ON posts (author_id);
CREATE INDEX idx_posts_reply    ON posts (reply_to);
CREATE INDEX idx_posts_repost   ON posts (repost_of);

-- HASHTAGS (denormalized lookup table für schnelle Trending-Abfragen)
CREATE TABLE post_hashtags (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag     TEXT NOT NULL,
    PRIMARY KEY (post_id, tag)
);
CREATE INDEX idx_hashtags_tag ON post_hashtags (tag);

-- LIKES ------------------------------------------------------
CREATE TABLE likes (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);
CREATE INDEX idx_likes_post ON likes (post_id);

-- FOLLOWS ----------------------------------------------------
CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX idx_follows_followee ON follows (followee_id);

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

