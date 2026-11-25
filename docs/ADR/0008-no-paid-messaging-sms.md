# ADR 0008 — Own messaging, no paid chat/SMS
Status: accepted
**Decision:** Messages stored in Postgres, delivered by Socket.IO, push via Expo (free), email via Resend free tier. Text only in v1; `attachments` column reserved.
