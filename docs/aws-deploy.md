# AWS Hosting Guide (Cheap EC2 + SQLite)

## Target Architecture

- One low-cost EC2 instance for the whole application
- One SQLite database file stored on that instance
- One `node/express` process managed by `systemd`
- One deploy path over SSH and `rsync`
- One separate sync path for moving the SQLite file between AWS and local
  development

SQLite is a single-writer database, so production should stay on one app
instance.

## Recommended Shape

- Prefer an inexpensive burstable instance such as `t4g.nano`
- Use a small general-purpose SSD volume
- Keep the design intentionally simple instead of introducing a separate
  database service

If you need x86 instead of Arm, use the closest low-cost equivalent and keep
the single-instance model.

## Server Prerequisites

Install these tools on the EC2 host before the first deploy:

- `node`
- `npm`
- `sqlite3`
- `rsync`
- `systemd`

Create a writable data directory for the SQLite file:

```bash
sudo mkdir -p /var/lib/colossal-claw-adventure
sudo chown ec2-user:ec2-user /var/lib/colossal-claw-adventure
```

Create the production environment file:

```bash
sudo touch /etc/colossal-claw-adventure.env
sudo chmod 600 /etc/colossal-claw-adventure.env
```

Add the production variables you need, including:

- `SQLITE_DB_PATH=/var/lib/colossal-claw-adventure/colossal-claw-adventure.sqlite`
- session secrets
- email/password auth secrets
- BYOClaw auth secrets

## Deploy

Use the deploy script from the repository root:

```bash
./scripts/deploy.sh ec2-user@YOUR_HOST
```

Optional environment overrides:

- `DEPLOY_PORT`
- `REMOTE_APP_DIR`
- `REMOTE_DATA_DIR`
- `REMOTE_ENV_FILE`
- `REMOTE_SERVICE`

The deploy script:

- syncs the repo to the EC2 host with `rsync`
- ensures the app and data directories exist
- creates or updates a `systemd` service
- runs `npm ci`
- runs the production build
- restarts the app service

## Sync The Database

Use the sync script when you need the SQLite data locally or when you need to
push a local snapshot back to the EC2 instance.

Pull production data down to local development:

```bash
./scripts/sync.sh pull ec2-user@YOUR_HOST
```

Push a local snapshot back to AWS:

```bash
./scripts/sync.sh push ec2-user@YOUR_HOST
```

Optional environment overrides:

- `LOCAL_DB_PATH`
- `REMOTE_DB_PATH`
- `REMOTE_SERVICE`
- `DEPLOY_PORT`

The sync script uses SQLite backups so the transferred database is a clean
copy rather than a raw live file grab.

## Operational Notes

- Keep only one production instance running
- Back up the SQLite file regularly
- Treat `push` syncs as operational changes because they overwrite the remote
  database
- Use the sync script for data movement and keep normal deploys code-only
