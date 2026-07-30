# Production Deployment Guide: agent-budget-middleware

This guide provides step-by-step instructions for deploying **`agent-budget-middleware`** to a single AWS EC2 instance (t2.micro / t3.micro AWS Free Tier) using Docker Compose and connecting to an external **Neon PostgreSQL** database.

---

## Step 1: Launch EC2 Instance & Configure Security Group

1. Log in to the [AWS Management Console](https://aws.amazon.com/console/) and open the **EC2 Dashboard**.
2. Click **Launch Instance**.
3. **Name**: `agent-budget-middleware-prod`
4. **AMI**: Ubuntu Server 22.04 LTS (HVM), SSD Volume Type.
5. **Instance Type**: `t3.micro` (or `t2.micro` depending on your AWS region free tier availability).
6. **Key Pair**: Select an existing SSH key pair or create a new one (e.g., `agent-middleware-key.pem`).
7. **Network Settings (Security Group)**:
   - Create a new Security Group named `agent-budget-sg`.
   - **Rule 1 (SSH)**: Type `SSH`, Port `22`, Source `My IP` (e.g., `YOUR_OFFICE_IP/32`).
   - **Rule 2 (App Inbound)**: Type `Custom TCP`, Port `8000` (or your `APP_PORT`), Source `Anywhere` (`0.0.0.0/0`).
8. Click **Launch Instance**.

---

## Step 2: SSH into EC2 & Install Docker + Docker Compose

Open your local terminal and SSH into your instance:

```bash
chmod 400 agent-middleware-key.pem
ssh -i "agent-middleware-key.pem" ubuntu@<YOUR_EC2_PUBLIC_IP>
```

Once connected, update packages and install Docker with the Docker Compose V2 plugin:

```bash
# 1. Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# 2. Install prerequisites
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# 3. Add Docker official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# 4. Set up Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 5. Install Docker Engine and Docker Compose Plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 6. Add ubuntu user to docker group (avoids needing sudo for docker commands)
sudo usermod -aG docker ubuntu
newgrp docker

# 7. Verify installations
docker --version
docker compose version
```

---

## Step 3: Clone Repository & Create `.env`

Clone the codebase onto the EC2 instance and create the production `.env` file:

```bash
# 1. Clone your repository
git clone https://github.com/YOUR_GITHUB_USERNAME/agent-budget-middleware.git
cd agent-budget-middleware

# 2. Create the production .env file
nano .env
```

Paste your production environment values into `.env`:

```env
# Groq API Credentials
GROQ_API_KEY=gsk_YOUR_ACTUAL_GROQ_API_KEY
GROQ_PREFERRED_MODEL=llama-3.3-70b-versatile
GROQ_FALLBACK_MODEL=llama-3.1-8b-instant

# PostgreSQL (Neon) - External Pooled Connection String with SSL required
DATABASE_URL=your_db_url
# Internal Docker Compose Redis Connection (Service name: redis)
REDIS_URL=redis://redis:6379/0

# App Settings
LOG_LEVEL=INFO
APP_ENV=production
APP_PORT=8000
WARNING_THRESHOLD_PCT=0.80
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X`).

---

## Step 4: Build and Launch Containers

Build the multi-stage Docker image and start the container stack in detached mode:

```bash
docker compose up -d --build
```

Check the running containers and logs:

```bash
# Check container status
docker compose ps

# View live application logs
docker compose logs -f app
```

---

## Step 5: Verify Health Check Endpoint

From your local machine (or using `curl` on the EC2 instance), query the readiness health check endpoint:

```bash
curl -i http://<YOUR_EC2_PUBLIC_IP>:8000/health
```

**Expected Response (HTTP 200 OK):**

```json
{
  "status": "healthy",
  "redis": "ok",
  "postgres": "ok"
}
```

Verify liveness probe:

```bash
curl -i http://<YOUR_EC2_PUBLIC_IP>:8000/health/live
```

---

## Step 6: Configure AWS Budgets Alert Safeguard

Before sending live LLM traffic, set up an AWS Budget alert to prevent unexpected cloud bill overruns:

1. In the AWS Console, search for **AWS Budgets**.
2. Click **Create Budget**.
3. Select **Cost budget** (Recommended) and click **Next**.
4. **Budget name**: `agent-middleware-ec2-cap`
5. **Period**: Monthly
6. **Budgeted amount**: `$5.00`
7. Under **Alert Thresholds**, add an alert:
   - Threshold: `80%` of budgeted amount ($4.00).
   - Email recipient: Add your email address.
8. Click **Confirm and Create**.

---

## Step 7: Run Remote Concurrency Load Test & Direct DB Verification

Run the concurrency test suite pointing at your EC2 public IP to verify real-network atomic spend caps.

### 1. Execute Remote Stress Test

From your local development machine inside `.venv`:

```bash
# Run pytest targeting the live EC2 host
$env:APP_HOST="http://<YOUR_EC2_PUBLIC_IP>:8000"
pytest -v tests/test_concurrency.py
```

### 2. Verify Spend Audit directly in Neon PostgreSQL

Connect directly to your Neon PostgreSQL database using `psql` or DBeaver:

```sql
-- Query total spend recorded in Neon database
SELECT 
    team_id, 
    agent_id, 
    event_type, 
    COUNT(*) as total_events, 
    SUM(cost_usd) as total_recorded_spend_usd
FROM spend_events
GROUP BY team_id, agent_id, event_type;
```

**Verification Check**:
Confirm that total approved spend recorded in Neon for an agent never exceeds its configured budget by more than one request's worth ($0.10), proving that atomic Redis reservation and compensating rollbacks enforce strict financial limits over real network topology.
