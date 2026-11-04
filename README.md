<div align="center">

# Kindred

**A full-stack dating app with real-time chat and video calls, built with FastAPI and React.**

Swipe through people who fit you, see *why* they fit, match, then talk: live chat with replies, reactions and voice notes, peer-to-peer video calls, and a date planner. Everything updates over one WebSocket.

![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-async-009688?logo=fastapi&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2_async-D71F00)
![Postgres](https://img.shields.io/badge/Postgres-17-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-pub%2Fsub-DC382D?logo=redis&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![WebRTC](https://img.shields.io/badge/WebRTC-calls-333333?logo=webrtc&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-e2e-2EAD33?logo=playwright&logoColor=white)

<img src="docs/screenshots/discover.png" alt="Discover: swipe deck with compatibility score, question agreement and profile details" width="900" />

</div>

## Highlights

**Meeting people**
- **Swipe deck** with drag gestures, keyboard shortcuts (← → ↑ ⌫), like / pass / super like and undo.
- **Transparent matching.** Every card shows a 0–100 compatibility score and the interests you share. Discover only shows people whose gender, age *and distance* preferences fit yours, and yours theirs.
- **Compatibility questions.** Answer twenty questions with what you'd accept from a match and how much it matters; profiles show your agreement and the answers you share.
- **Filters** for verified profiles, recent activity, interests, prompts and minimum agreement, plus **daily top picks** with a reason for each.
- **Travel mode:** pick a city and the last day you'll be there (up to 30 days ahead). Until then your deck and distances are measured from there, locals can find you, and your card says "Visiting Lisbon". It ends on its own.
- **Save for later:** set someone aside without liking or passing. They leave the deck and wait under Likes until you decide.
- **Viewed you:** who opened your full profile in the last 30 days (a look counts after a few seconds, not a swipe past). **Browse privately** stops your own looks being recorded, and in return hides your viewers.
- **Likes with a comment** on a specific prompt. If it turns into a match, the comment opens the chat.
- **Photo verification:** copy a random pose in a selfie, a moderator compares it with your photos, and you get a blue tick.

**Talking**
- **Live chat over WebSockets**: instant delivery, typing indicators, read receipts, presence, optimistic sending with retry, an offline queue and auto-reconnect with backoff.
- **Replies** that quote the original (swipe a bubble on a phone), **edits** and **unsend** within 15 minutes, **reactions**, **photo messages** and **voice notes** with a recorder and a seekable waveform.
- **Audio and video calls**, peer to peer over WebRTC, with the WebSocket doing the signalling. Calls ring, can be declined or missed, and leave a record in the chat.
- **Search** across all your conversations, with highlighted snippets that jump to the message, even if it's pages back.
- **Pin, mute and archive** chats; muted chats stay quiet and out of the unread count.
- **Date planning** inside the chat: propose a place and time, accept or decline live, add it to your calendar (`.ics`), and get a **reminder** two hours before.
- **Notifications** for likes, matches, missed messages and reminders: a live bell, unread counts in the tab title and opt-in desktop notifications, plus **quiet hours** in your own time zone, when desktop alerts hold off and digests wait until morning.
- **An email digest** of what you missed while away: one email at most every six hours, only to a confirmed address, with a switch for each kind and an unsubscribe link that mail scanners can't trigger.
- **"Are you sure?"** before sending a message that reads as an insult. It's a nudge, not a filter: edit it or send anyway. The server owns the word list and shares it with the app, so the check is instant.

**Your account**
- **Profile editor** with photo upload (validated, EXIF-rotated, resized to WebP with Pillow), interests, prompts and preferences, plus a **profile strength** meter.
- **Email confirmation and password reset** through signed, single-purpose links.
- **Two-factor sign-in** with any authenticator app (TOTP, written to RFC 6238) and one-time recovery codes.
- **Signed-in devices:** see each browser ("Safari on iPhone", last active, IP) and sign any one out, every other one, or all of them. Below it, **recent security activity** lists sign-ins, wrong passwords, and password, email and two-factor changes.
- **Change your email address:** the new inbox has to confirm before it replaces the old one, and the old address is told when the change is asked for and when it's done.
- **Download your data** as one JSON file, pause your profile or delete the account.
- **Insights** on likes, match rate, reply rate and reply speed, with day-by-day charts.
- **Light and dark themes**, **keyboard shortcuts** (press `?`) and an **installable PWA**.

**Safety and operations**
- **Block and report** from any chat. Moderators get a report queue (which shows how many unkind messages a reported person has sent), a **photo verification** queue, a **member directory** with direct bans, **trends** (reports filed and resolved per day, time to resolve, what people report), **announcements** shown to everyone as a dismissable banner, and an append-only **audit log**.
- **Rate limits** on sign-in, sign-up, swipes, messages, uploads and emails.
- **Scales out:** with Redis, events, presence *and* rate limits are shared by every API worker.
- **Observable:** request IDs on every response and log line, optional JSON logs and a Prometheus `/metrics` endpoint.
- **A demo that feels alive.** About 55 seeded personas (a few in Lisbon, London, Paris and Berlin, for travel mode) like you back, reply in context (even to voice notes) and say yes to dates, so a reviewer can try every flow alone.

| Video call | Replies, edits, voice notes and a call record | Search |
| --- | --- | --- |
| <img src="docs/screenshots/video-call.png" alt="A video call in progress" /> | <img src="docs/screenshots/chat-features.png" alt="Chat with a quoted reply, an edited message, a voice note and a call record" /> | <img src="docs/screenshots/search.png" alt="Search results with the matching words highlighted" /> |

| Compatibility questions | Filters | Two-factor sign-in |
| --- | --- | --- |
| <img src="docs/screenshots/questions.png" alt="Answering a compatibility question" /> | <img src="docs/screenshots/filters.png" alt="Discover filters" /> | <img src="docs/screenshots/two-factor.png" alt="Setting up an authenticator app with a QR code" /> |

| Signed-in devices | "Are you sure?" | Moderation trends |
| --- | --- | --- |
| <img src="docs/screenshots/devices.png" alt="Settings listing three signed-in browsers, each with a sign-out button" /> | <img src="docs/screenshots/kindness.png" alt="A dialog asking whether to send a message that reads as an insult" /> | <img src="docs/screenshots/trends.png" alt="Reports filed and resolved per day, with time to resolve" /> |

| Match | Live chat | Likes you |
| --- | --- | --- |
| <img src="docs/screenshots/match.png" alt="It's a match screen" /> | <img src="docs/screenshots/chat-typing.png" alt="Chat with typing indicator" /> | <img src="docs/screenshots/likes.png" alt="Likes you grid" /> |

| Top picks | Planning a date | It's a date |
| --- | --- | --- |
| <img src="docs/screenshots/top-picks.png" alt="Today's top picks with reasons" /> | <img src="docs/screenshots/date-plan.png" alt="Plan a date dialog with ideas" /> | <img src="docs/screenshots/date.png" alt="Accepted date pinned in the chat" /> |

| Photo verification | Members | Moderation |
| --- | --- | --- |
| <img src="docs/screenshots/verification-review.png" alt="Comparing a posed selfie with the profile photo" /> | <img src="docs/screenshots/members.png" alt="Member directory for moderators" /> | <img src="docs/screenshots/moderation.png" alt="Report queue" /> |

| Insights | Notifications | Profile |
| --- | --- | --- |
| <img src="docs/screenshots/insights.png" alt="Insights with daily charts" /> | <img src="docs/screenshots/notifications.png" alt="Notification bell panel" /> | <img src="docs/screenshots/profile.png" alt="Profile editor with strength meter and questions" /> |

| Light theme | Light theme chat | Landing |
| --- | --- | --- |
| <img src="docs/screenshots/light-discover.png" alt="Discover in the light theme" /> | <img src="docs/screenshots/light-chat.png" alt="A chat in the light theme" /> | <img src="docs/screenshots/landing.png" alt="Landing page" /> |

<p align="center">
  <img src="docs/screenshots/mobile-discover.png" alt="Mobile discover" width="240" />
  <img src="docs/screenshots/mobile-chats.png" alt="Mobile chat list" width="240" />
  <img src="docs/screenshots/mobile-chat.png" alt="Mobile conversation" width="240" />
</p>

## Try it in two minutes

You need **Python 3.12+** and **Node 20+**.

```bash
# 1. API (http://localhost:8000, interactive docs at /docs)
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env             # turns on the dev outbox for emails
uvicorn app.main:app --reload
```

```bash
# 2. Web app (http://localhost:5173), in a second terminal
cd frontend
npm install
npm run dev
```

The database is migrated and seeded on first start. Open http://localhost:5173 and click **Try the live demo**.

| Account | Email | Password |
| --- | --- | --- |
| Demo user (also a moderator) | `alex@kindred.app` | `kindred123` |
| Second real user | `maya@kindred.app` | `kindred123` |

**See two people together:** sign in as Alex in one window and as Maya in a private window. They're already matched: open the conversation on both sides and watch messages, typing, reactions and read receipts update instantly, then press the video button to call. `localhost` counts as a secure origin, so the browser will let the call use your camera.

**Emails** (sign-up confirmation, password resets) go to an outbox table instead of a mail server. With the example `.env`, read them at http://localhost:5173/dev/outbox. To start over, run `python -m app.seed --reset`.

### Or with Docker

```bash
docker compose up --build
# open http://localhost:8080
```

Compose runs the API on **Postgres 17** with **Redis** sharing events, presence and rate limits between workers, behind nginx, which serves the built React app and proxies `/api`, `/media` and the `/ws` WebSocket. Uploads live in a named volume.

## Architecture

```mermaid
flowchart LR
    subgraph Browser
        UI[React 19 + Router] --> RQ[TanStack Query cache]
        UI --> WS[RealtimeClient<br/>auto-reconnect, queue]
        WS -- events --> RQ
        UI --> RTC[RTCPeerConnection]
        SW[Service worker<br/>offline shell]
    end
    RTC <-. media, peer to peer .-> RTC2[The other browser]
    RQ -- REST /api --> MW
    WS -- WebSocket /ws<br/>chat + call signalling --> API
    subgraph FastAPI workers
        MW[Request IDs, access log,<br/>metrics] --> API[Routers + rate limits]
        API --> SVC[Services<br/>discovery · chat · calls · dates · verification · questions · …]
        SVC --> DB[(SQLAlchemy 2 async<br/>Postgres / SQLite<br/>Alembic migrations)]
        SVC --> HUB[ConnectionManager<br/>sockets + presence]
        HUB <--> BR[Broker<br/>local or Redis pub/sub]
        HUB --> WS
        JOBS[Scheduler<br/>date reminders] --> SVC
    end
```

**Backend (`backend/app`)**

| Path | Responsibility |
| --- | --- |
| `main.py` | App factory and lifespan: migrate, seed, start the broker and the scheduler, metrics, CORS, static media |
| `models.py` · `migrations/` | 20 tables with the constraints that keep them honest; 33 Alembic revisions applied on startup, and a test that fails if models and migrations drift |
| `schemas.py` | Pydantic v2 validation (18+, known interests, prompts and questions, ranges, aware datetimes) and response shapes |
| `routers/` | `auth`, `email`, `email_change`, `two_factor`, `users`, `account`, `devices`, `travel`, `views`, `saved`, `questions`, `discover`, `matches`, `search`, `dates`, `notifications`, `safety`, `verification`, `admin`, `admin_users`, `announcements`, `ws` |
| `services/discovery.py` · `matching.py` · `agreement.py` | Who can see whom, filters, top picks, the compatibility score, distance and question agreement |
| `services/chat.py` · `chat_settings.py` · `audio.py` | Messages, replies, edits, unsend, reactions, voice notes, read receipts, persona replies; pin, mute and archive |
| `services/calls.py` | Call registry and WebRTC signalling relay: ringing, busy, missed and the call record |
| `services/verification.py` · `audit.py` · `export.py` · `trends.py` | Posed-selfie verification, the moderator audit log, the data export, and moderation trends |
| `services/devices.py` · `useragent.py` | Device sessions: started at sign-in, checked on every request and socket, signed out one at a time |
| `services/digest.py` · `kindness.py` · `quiet.py` | The email digest (who's due, what to say, claimed once across workers); the unkind-message patterns shared with the app; quiet hours in each person's own time zone |
| `services/security_log.py` | The account's recent security activity: sign-ins, wrong passwords, password, email and two-factor changes |
| `totp.py` · `security.py` · `mail.py` | RFC 6238 one-time codes and recovery codes; access and single-purpose tokens; SMTP or outbox email |
| `realtime.py` · `broker.py` | Per-user socket fan-out and shared presence (heartbeats per worker), through an in-process or Redis broker |
| `limits.py` · `ratelimit.py` | Sliding-window limits in memory or in Redis sorted sets, and the FastAPI dependencies that apply them |
| `observability.py` · `scheduler.py` | Request IDs, JSON logs and Prometheus metrics; the background jobs that send date reminders and digests |

**Frontend (`frontend/src`)**

| Path | Responsibility |
| --- | --- |
| `lib/realtime.ts` | Framework-free WebSocket client: backoff with jitter, keep-alive pings, offline queue, 4401 sign-out |
| `lib/calls.ts` | The WebRTC side of calls: peer connection, offer/answer, early ICE candidates, and the call state store |
| `lib/voice.ts` | MediaRecorder recording with a live level meter, and the waveform maths |
| `realtime/RealtimeProvider.tsx` | Folds server events into the React Query cache: messages, edits, reactions, presence, chat settings, calls, notifications |
| `lib/cache.ts` · `quotes.ts` · `search.ts` · `filters.ts` · `shortcuts.ts` · `theme.ts` · … | Pure, unit-tested helpers (`upsertMessage`, `applyEdit`, `applyChatSettings`, `highlightParts`, …) |
| `pages/` | Landing, sign in and up, password reset, Discover, Likes, Chats, Profile, Insights, Settings, Moderation |
| `components/` | `SwipeCard`, `CallScreen`, `VoiceNotes`, `Replies`, `ChatSearch`, `Questions`, `TwoFactor`, `Verification`, … |
| `e2e/` | Playwright tests against the real API and web app |

### Real-time protocol

One socket per tab at `/ws?token=<JWT>` (browsers can't set headers on WebSocket requests, so the token goes in the query string).

| Direction | Event | Payload |
| --- | --- | --- |
| client → server | `message.send` | `match_id`, `body`, `client_id` (echoed back to reconcile the optimistic message), optional `reply_to_id` |
| | `typing` · `read` · `react` | live indicators and reactions |
| | `call.invite` · `call.accept` · `call.signal` · `call.end` | ring someone, answer, relay an offer, answer or ICE candidate, hang up |
| | `ping` | keeps proxies from closing idle sockets |
| server → client | `hello` | which of your matches are online right now |
| | `message.new` · `message.edited` · `message.deleted` | the stored message, its new text, or which one was unsent |
| | `typing` · `read` · `reaction` · `presence` | live indicators |
| | `match.new` · `match.removed` · `match.settings` | new matches, unmatches and blocks, and pin/mute/archive changes from your other tabs |
| | `call.ringing` · `call.incoming` · `call.accepted` · `call.signal` · `call.ended` · `call.failed` | the call as it happens |
| | `date.updated` · `notification.new` | date proposals and the bell |
| | `error` | validation problems or rate limits; the socket stays open |

Bad, revoked or banned tokens are closed with code `4401`, which makes the client sign out instead of retrying.

### Calls

Media never touches the server: the browsers connect peer to peer with WebRTC, using the STUN/TURN servers from `GET /api/matches/{id}/call-config`. The server's part is small and strict. It rings only matches who are online, not already on a call and not demo personas; it only relays signals between the two people in a call (capped in size); it gives up after 45 seconds without an answer; and it hangs up when someone's last tab closes. Each call then leaves a record in the chat ("Video call · 3:12", "Missed audio call"). For callers behind strict NATs, add a TURN server to `KINDRED_ICE_SERVERS`.

### Running several workers

With `KINDRED_REDIS_URL` set:

- **Events** go through Redis pub/sub, so a message sent through one worker reaches sockets held by another.
- **Presence** is shared: each worker announces people coming online and going offline, and repeats its full list every ten seconds as a heartbeat. A worker that misses three heartbeats is forgotten, so a crash can't leave anyone "online" forever.
- **Rate limits** are counted in Redis sorted sets, so the limits hold across workers instead of multiplying.
- **Date reminders** run on every worker, but each one is claimed with a conditional `UPDATE`, so it's sent once.

The call registry is still per worker, so both people in a call need to reach the same one (sticky sessions).

### Matching, explained

The **compatibility score** (`services/matching.py`) is a deliberately simple, explainable formula:

| Signal | Weight | How |
| --- | --- | --- |
| Shared interests | 55 | overlap ÷ the smaller interest list, so a short list that fully matches still scores well |
| Age closeness | 25 | full marks within 2 years, fading to 0 at a 12-year gap |
| Recent activity | 20 | full marks if active today, fading over two weeks |

**Question agreement** (`services/agreement.py`) uses the questions two people have both answered. For each person, it takes the share of their importance-weighted questions (1, 10 or 50 points) where the other's answer is one they'd accept. The agreement is the geometric mean of the two shares, so it's only high when the fit goes both ways. It's shown once three questions are in common.

The SQL query narrows candidates on indexed columns (not swiped, not rejected by them, not blocked, gender, birthdate range, a latitude/longitude bounding box, and the verified and recently-active filters). The JSON checks, exact distance and scoring run in Python, so the same code works on SQLite and Postgres.

### Security notes

- Passwords are hashed with bcrypt. Sessions are JWTs carrying a **token version**, so a password change, a reset, "sign out everywhere" or a ban revokes every token at once.
- Each token also names its **device session**, so one browser can be signed out without the others; that closes its open sockets too. The session's last-seen time is written at most every five minutes, so reads stay reads.
- Emailed links are **single-purpose tokens**, which can't be used as sessions or as each other. Reset links carry the token version, so each one works only once.
- **Two-factor codes** can't be replayed: the last accepted time step is stored. Recovery codes are stored as hashes and work once.
- Uploads are checked by content, not file name: images by decoding them, voice notes by their first bytes.
- "Forgot password" never reveals whether an account exists. The dev outbox (`KINDRED_EXPOSE_OUTBOX`) is off by default because it shows reset links.

## Tests and CI

```bash
cd backend && pytest                       # 325 tests
cd frontend && npm run lint && npm test    # 251 tests
cd frontend && npm run e2e                 # 10 browser tests (starts its own API and web app)
```

- **Backend tests** drive real WebSocket connections through the app: delivery, replies, edits, presence across two workers, a whole video call, missed calls and busy signals, bans closing sockets. They also check TOTP against the RFC's test vectors, run two rate limiters against one fake Redis, and include a migration test that upgrades a database holding a conversation and checks every row survives.
- **End-to-end tests** run the real API (fresh SQLite, demo data) and web app in Chromium with a fake camera. They cover signing up and confirming the email, resetting a password, swiping into a match, two people chatting live, the "Are you sure?" nudge with the server's real patterns, a video call between two browsers, a trip in travel mode, saving someone for later, the Viewed you list and dismissing an announcement.

CI (`.github/workflows/ci.yml`) runs four jobs:

- ruff and pytest on SQLite;
- the whole backend suite again on **Postgres 17**;
- ESLint, the TypeScript check, Vitest and a production build for the web app;
- the **Playwright** suite, which keeps its report when something fails.

## Configuration

All settings are environment variables with a `KINDRED_` prefix (see `backend/.env.example`):

| Variable | Default | Notes |
| --- | --- | --- |
| `KINDRED_SECRET_KEY` | dev value | **Set this in production** (signs sessions and emailed links) |
| `KINDRED_DATABASE_URL` | `sqlite+aiosqlite:///backend/kindred.db` | Any async SQLAlchemy URL, e.g. `postgresql+asyncpg://…` (`pip install ".[postgres]"`) |
| `KINDRED_REDIS_URL` | unset | Share events, presence and rate limits between workers (`pip install ".[redis]"`) |
| `KINDRED_APP_URL` | `http://localhost:5173` | Where links in emails point |
| `KINDRED_MAIL_BACKEND` | `outbox` | `smtp` to send for real, with `KINDRED_SMTP_HOST`, `_PORT`, `_USERNAME`, `_PASSWORD` |
| `KINDRED_EXPOSE_OUTBOX` | `false` | Local development only: read sent emails at `/api/dev/outbox` |
| `KINDRED_ICE_SERVERS` | Google's public STUN | JSON list of `RTCIceServer`s; add TURN for strict networks |
| `KINDRED_LOG_FORMAT` | `text` | `json` for one JSON object per log line |
| `KINDRED_METRICS_TOKEN` | unset | Require `Authorization: Bearer <token>` for `/metrics` |
| `KINDRED_RATE_LIMIT_ENABLED` | `true` | Sliding-window limits |
| `KINDRED_DEMO_MODE` | `true` | Personas like back, reply and accept dates |
| `KINDRED_SEED_ON_STARTUP` | `true` | Seed an empty database on boot |
| `KINDRED_CORS_ORIGINS` | `["http://localhost:5173"]` | JSON list |

Schema changes go through Alembic: edit `models.py`, then run `alembic revision --autogenerate -m "what changed"` in `backend/` and review the generated file.

## What I'd add next

- Web Push, so notifications and calls arrive while the app is closed
- A TURN server in Docker Compose, and a shared call registry so calls work across workers without sticky sessions
- Automated screening of uploaded photos before they reach the moderation queue
- Translations

## Credits

Profile photos are from [Unsplash](https://unsplash.com) and used under the Unsplash License. All names, bios and conversations are fictional.

## License

[MIT](LICENSE)
