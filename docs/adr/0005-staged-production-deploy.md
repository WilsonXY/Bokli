# Staged production deploy with guarded cutover

The v1.1.1 deploy script checked out the new tag in the live checkout, migrated the live DB and built into the live `.next-prod` before stamping. So any build failure, interruption or reboot left prod with a moved HEAD, erased artifacts and a stamp that `ExecStartPre` rejects. Because it ran from inside the checkout it rewrote, the first run of any fix would still have been the old script. We therefore prepare each release in a disposable staging directory (archive, `npm ci`, migration rehearsal on a DB copy, build, loopback smoke test), and only then do a short, journaled cutover. The cutover stops the service, snapshots the DB, migrates a copy and swaps DB, build and `node_modules` in by rename, switches the checkout and smoke-tests at the live path before starting. The script must run from a separate deployer checkout at `origin/main` with `BOKLI_REPO_DIR` pinned to, and verified against, the systemd unit. Failures before the new service could accept writes roll back automatically and prove it. After that point the DB is never restored automatically.

## Considered Options

- Keep building in place but stamp earlier or back up `.next-prod`: rejected, the checkout and DB still change before the build is known good, and the old in-place script would still run the first hop.
- Blue/green directories switched by a symlink or a second unit/port behind the tunnel: rejected for now, it needs systemd unit and routing changes (fixed `WorkingDirectory`, `ExecStartPre` path and tunnel target), which are out of scope. It is the path to near-zero downtime if ever needed.
- Automatic DB snapshot restore on any cutover failure: rejected, it silently loses writes once the new release has served traffic. That case goes to a human.
