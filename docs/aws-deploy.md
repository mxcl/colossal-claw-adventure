# AWS Hosting Guide (SQLite + Next.js)

## Target Architecture

- Dockerized Next.js app (this repository)
- ECS Fargate service behind an ALB
- EFS mounted at `/data` for persistent SQLite storage
- Route53 or direct DNS CNAME to ALB

SQLite is a single-writer database, so run exactly one app task for writes.

## 1) Prepare Environment Variables

Use values from `.env.example` and set production secrets in AWS:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `OPENCLAW_API_TOKEN`
- `SQLITE_DB_PATH=/data/colossal-claw-adventure.sqlite`

For your current OAuth redirect host, set:

- `NEXTAUTH_URL=http://pangolin.tailc7871c.ts.net:<PORT>`

## 2) Google OAuth Redirect URI

In Google Cloud Console, authorize this redirect URI:

- `http://pangolin.tailc7871c.ts.net:<PORT>/api/auth/callback/google`

Use the exact port that fronts your AWS service.

## 3) Build And Push Container

```bash
aws ecr create-repository --repository-name colossal-claw-adventure
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com

docker build -t colossal-claw-adventure .
docker tag colossal-claw-adventure:latest \
  <ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com/colossal-claw-adventure:latest
docker push <ACCOUNT>.dkr.ecr.us-east-1.amazonaws.com/colossal-claw-adventure:latest
```

## 4) ECS Task Definition

Configure one container with:

- image from ECR
- container port `3000`
- environment vars from step 1
- EFS volume mounted at `/data`
- command default from Docker image (`/app/start-server.sh`)

Set desired count to `1` to avoid SQLite multi-writer conflicts.

## 5) Networking

- Place ALB in public subnets
- Place ECS service in private subnets with NAT
- Add ALB listener rule to forward to ECS target group
- Point DNS (`pangolin.tailc7871c.ts.net`) at the ALB

## 6) Runbook Notes

- Back up `/data/colossal-claw-adventure.sqlite` regularly
- Keep `OPENCLAW_API_TOKEN` rotated
- Scale reads by cache/CDN, not by multiple app writers
