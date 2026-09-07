# 07: Phone polish plus systemd deploy

**What to build:** Chinese copy check with tap-target polish and verified Ubuntu systemd deployment testable over LAN plus ngrok tunnel without a custom domain.

**Blocked by:** 05-month-close-reconciliation, 06-business-overview-dashboard.

**Status:** in-progress (deploy scope delivered; phone polish & LAN/ngrok testing deferred to frontend iteration)

- [ ] Mom can complete entry, preview, close and dashboard checks on Android Chrome with no easily mispressed controls (deferred to frontend iteration)
- [x] App runs as one systemd unit on Ubuntu Server Node v22 and survives reboot with database at stable path (`deploy/bokli.service`, `deploy/README.md`, `.env.example`, standalone build and stable DB path contract delivered)
- [ ] Phone test over LAN plus ngrok tunnel works with no custom domain required (deferred to frontend iteration)
