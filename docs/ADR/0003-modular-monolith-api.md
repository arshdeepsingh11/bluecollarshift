# ADR 0003 — Node.js modular monolith on DigitalOcean
Status: accepted
**Decision:** One Fastify process (REST + Socket.IO + in-process jobs with advisory locks), Docker, DigitalOcean droplet.
**Why:** Measured 170–11,000 req/s on 2 vCPU at ~10k employees; cheapest to run; easy to reason about.
**Revisit when:** CPU > 70% sustained, p99 > 200 ms, or >1 instance needed (then add Socket.IO adapter + load balancer).
