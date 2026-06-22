# NEXUS — Microblogging Multi-Container Stack

Ein Twitter-artiges Netzwerk im CRT-Terminal-Look, komplett dockerisiert.

```
┌──────────┐   ┌─────────┐   ┌──────────┐
│ frontend │ ← │ backend │ ← │    db    │
│  nginx   │   │  node   │   │ postgres │
└──────────┘   └────┬────┘   └──────────┘
                    ↓
              ┌──────────┐   ┌──────────┐
              │   mail   │   │ adminer  │
              │ MailHog  │   │ DB GUI   │
              └──────────┘   └──────────┘
```

## Services

| Service    | Image                   | Port  | Zweck                           |
|------------|-------------------------|-------|---------------------------------|
| `frontend` | nginx (build: lokal)    | 3000  | React SPA + Reverse-Proxy `/api`|
| `backend`  | node:20 (build: lokal)  | 4000  | Express REST API + SSE          |
| `db`       | postgres:16-alpine      | —     | Persistenz                      |
| `mail`     | mailhog/mailhog         | 8025  | Catcht alle Verifikations-Mails |
| `adminer`  | adminer                 | 8080  | DB-Browser (optional)           |

## Schnellstart

```bash
# 1. .env anlegen
cp .env.example .env

# 2. (Empfohlen) JWT_SECRET neu generieren
# Linux/macOS:
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env

# 3. Hochfahren
docker compose up -d --build

# 4. Logs verfolgen (optional)
docker compose logs -f backend
```

## Zugriff

| URL                       | Was                                          |
|---------------------------|----------------------------------------------|
| http://localhost:3000     | **NEXUS App** (das ist die UI)               |
| http://localhost:8025     | **MailHog** — hier kommen die Email-Codes an |
| http://localhost:8080     | **Adminer** — DB-GUI (Server: `db`, User/Pass aus `.env`) |
| http://localhost:4000/api/health | Backend Healthcheck                   |

## Login-Flow

1. App öffnen: http://localhost:3000
2. Eigene Email eingeben → `[ TRANSMIT CODE ]`
3. MailHog öffnen (http://localhost:8025) → 6-stelligen Code aus der Mail kopieren
4. Code in der App eingeben
5. Beim ersten Login: Username, Display-Name und (optional) Avatar wählen → drin

### Owner-Account

Der Owner wird beim ersten Backend-Start **automatisch angelegt**. Default-Werte aus `.env`:

```
[email protected]
OWNER_USERNAME=admin
OWNER_DISPLAY_NAME=SYSTEM
```

Um sich als Owner einzuloggen: Owner-Email eingeben → Code aus MailHog → fertig.
Das Owner-Profil ist im UI schreibgeschützt (keine Änderungen an Name / Avatar / Bio möglich), und der Owner darf **jeden Post löschen** (Moderator-Privileg).

## Datenmodell

- `users` — Account-Daten, inkl. `is_owner`-Flag
- `posts` — Top-Level, Replies (`reply_to`) und Reposts (`repost_of`) in einer Tabelle
- `post_hashtags` — denormalisiert, für schnelle Trending-Queries
- `likes` — m:n, composite primary key
- `follows` — m:n, mit `CHECK (follower_id <> followee_id)`
- `verification_codes` — temporäre Codes mit Ablauf

Siehe [`db/init.sql`](./db/init.sql).

## API-Endpunkte (Highlights)

```
POST   /api/auth/request-code        { email }
POST   /api/auth/verify-code         { email, code }       → { token, user } OR { regToken, needsRegistration }
POST   /api/auth/register            { regToken, username, displayName, avatar? }
GET    /api/me
PATCH  /api/me                       { displayName?, bio?, avatar? }
GET    /api/users/:id
GET    /api/users/:id/posts          ?replies=1
POST   /api/users/:id/follow
DELETE /api/users/:id/follow
GET    /api/users                    Vorschläge
GET    /api/posts                    ?tab=all|following  oder  ?hashtag=ops
POST   /api/posts                    { content?, replyTo?, repostOf? }
GET    /api/posts/:id                → { post, parents, replies }
DELETE /api/posts/:id
POST   /api/posts/:id/like
DELETE /api/posts/:id/like
GET    /api/trending
GET    /api/events?token=...         Server-Sent Events (Live-Feed)
```

Auth via `Authorization: Bearer <JWT>`.

## Echtzeit

Der Server pusht über **Server-Sent Events** (`/api/events`). Bei einem neuen oder gelöschten Post wird der Client per `post:new` / `post:deleted` benachrichtigt und lädt den aktuellen View neu. nginx ist mit `proxy_buffering off` konfiguriert, damit SSE nicht gepuffert wird.

## Datenpersistenz

Postgres-Daten liegen im benannten Volume `db_data` und überleben Container-Restarts. Komplett-Reset:

```bash
docker compose down -v
```

## Hardening für Production

- **JWT_SECRET ZWINGEND** mit `openssl rand -hex 32` neu setzen
- `mail`-Service durch echten SMTP-Provider ersetzen (z. B. SendGrid, Mailgun) — Env-Vars `SMTP_HOST`, `SMTP_PORT` im `backend`-Service anpassen, ggf. `SMTP_USER`/`SMTP_PASS` ergänzen und im Mailer-Setup `auth: { user, pass }` einbauen
- `adminer` nicht öffentlich exposen (oder ganz entfernen)
- Frontend hinter HTTPS-Reverse-Proxy (Caddy / Traefik)
- Rate-Limiting für `/api/auth/*` einbauen
- `POSTGRES_PASSWORD` randomisieren

## Häufige Probleme

| Symptom                            | Fix                                                |
|------------------------------------|----------------------------------------------------|
| Backend startet, dann Crash-Loop   | `docker compose logs db` — DB ggf. noch nicht bereit; healthcheck wartet 30s |
| "could not send email"             | `mail`-Container down: `docker compose up -d mail` |
| Frontend zeigt 502 bei /api        | `backend` läuft nicht: `docker compose logs backend` |
| Port 3000/4000/8025 schon belegt   | In `docker-compose.yml` Port-Mapping ändern        |

## Owner-Defaults ändern

In `.env`:

```env
[email protected]
OWNER_USERNAME=root
OWNER_DISPLAY_NAME=THE_ARCHITECT
```

Dann `docker compose down -v && docker compose up -d --build` (das `-v` löscht das DB-Volume, damit der Owner neu gesetzt wird).

---

`// nexus_terminal · multi-container build · v1.0`
