Status: v21.32. The deploy files and every command that runs on the server were tested locally (see [How this guide was tested](#how-this-guide-was-tested)). The Oracle console steps (1–4) could not be tested and were written from Oracle's pages and the research of 12 October 2026. Menu names change often, so where the console differs, trust the console.

# Run DAB for free on Oracle Cloud (Always Free)

This guide puts DAB on one free Arm virtual machine (VM) in Oracle Cloud's Singapore region. Caddy sits in front for HTTPS, and DAB's data is backed up every night to storage outside Oracle. It is written for one person who is comfortable in a terminal but new to Oracle Cloud.

What you end up with:

```
 users ──HTTPS──► Caddy (ports 80/443) ──► DAB (port 3000, never public)
                                             │
                                             └─ volume "dab-data": app.db (SQLite) + objects/ (uploads)
                                                   │
                     02:30 every night  backup.sh ─┴─► encrypted archive ──► S3 bucket outside Oracle
```

The files used here live in [`deploy/oracle/`](../../deploy/oracle/):

| File | What it is |
|---|---|
| `compose.yml` | DAB and Caddy for Docker Compose: one named volume for DAB's data, DAB not published to the internet |
| `Caddyfile` | HTTPS with automatic Let's Encrypt certificates, compression for the UI, timeouts sized for 25 MB uploads |
| `.env.example` | Every production setting, with comments and the commands that generate the secrets |
| `backup.sh` | The nightly backup: a consistent SQLite copy plus the uploaded files, encrypted with age and copied off Oracle with rclone |
| `restore.sh` | Puts a backup (or a Railway export) back into the volume, moving the old data aside instead of deleting it |
| `dab-backup.service`, `dab-backup.timer` | Run `backup.sh` at 02:30 Bangkok time every night |

**Where the numbers come from.** Oracle's prices, limits and rules below were checked on 12 October 2026 for the research reports *Oracle free tier for DAB* and *Thai region hosting for DAB*. Some come from search-engine extracts of Oracle's documentation, because docs.oracle.com could not be read directly. Oracle changed its free allowance without notice in June 2026, so check each limit in the console (*Governance & Administration → Limits, Quotas and Usage*) before you rely on it.

## Contents

0. [Before you start](#0-before-you-start)
1. [Create the account in Singapore](#1-create-the-account-in-singapore)
2. [Upgrade to Pay As You Go, set a budget alert and quotas](#2-upgrade-to-pay-as-you-go-set-a-budget-alert-and-quotas)
3. [Network: a VCN and its security list](#3-network-a-vcn-and-its-security-list)
4. [Create the VM](#4-create-the-vm)
5. [Set up Ubuntu: updates, swap, firewall, Docker](#5-set-up-ubuntu-updates-swap-firewall-docker)
6. [Point your domain at the VM](#6-point-your-domain-at-the-vm)
7. [Copy the deploy files and find the image](#7-copy-the-deploy-files-and-find-the-image)
8. [Write the .env](#8-write-the-env)
9. [Start DAB](#9-start-dab)
10. [First-boot checks](#10-first-boot-checks)
11. [Move existing data from Railway](#11-move-existing-data-from-railway)
12. [Backups outside Oracle, and a restore drill](#12-backups-outside-oracle-and-a-restore-drill)
13. [Updates and rollback](#13-updates-and-rollback)
14. [Monitoring](#14-monitoring)
15. [Staying free](#15-staying-free)
16. [Troubleshooting](#16-troubleshooting)
17. [What this costs, and when to move to AWS Bangkok](#17-what-this-costs-and-when-to-move-to-aws-bangkok)

## 0. Before you start

You need:

- **A real credit card**, or a debit card that works like one. Oracle rejects prepaid, virtual, single-use and PIN-only debit cards. It places a temporary authorisation hold, which it says is not a charge.
- **A domain name** whose DNS you can edit, for example `dab.example.com`.
- **DAB's image on Docker Hub, with an arm64 build.** CI's Deploy job pushes `<your Docker Hub username>/dab:latest` (and a tag for each commit) once three things are set in GitHub, under *Settings → Secrets and variables → Actions*: the secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`, and the variable `DEPLOY_ENABLED=true`. From v21.32 the tag holds an amd64 and an arm64 image, and Oracle's Ampere A1 VMs are Arm. Check from any machine with Docker:
  ```sh
  docker buildx imagetools inspect YOUR_DOCKERHUB_USERNAME/dab:latest   # must list linux/arm64
  ```
- **An SSH key** on your laptop. If you have none: `ssh-keygen -t ed25519 -C dab-oracle`.
- **Half a day to a day**, plus any wait for Arm capacity (step 4). Afterwards, about 1–2 hours a month. Both figures are the research's estimates.

## 1. Create the account in Singapore

1. Sign up at <https://www.oracle.com/cloud/free/>. Use your real name and address, exactly as they appear on the card, and **turn off any VPN**. Forum reports name VPNs and mismatched details as the common reasons for rejected sign-ups.
2. **Home region: choose Singapore (`ap-singapore-1`).** This is the one choice you cannot undo. Always Free VMs and volumes exist only in the home region, the home region can never be changed, and Oracle allows one free account per person. Oracle has no region in Thailand. Singapore is 25–70 ms away, which is nothing next to the time an upload takes to parse.
3. Turn on multi-factor sign-in when Oracle offers it. `docs/privacy/vendors.md` §2 asks for two-factor sign-in on the hosting account.
4. **During the 30-day trial, create only Always Free resources** (this guide creates nothing else). If your Arm usage is above the Always Free limit when the trial ends, Oracle disables the VMs and deletes them 30 days later unless you have upgraded.

## 2. Upgrade to Pay As You Go, set a budget alert and quotas

### 2.1 Upgrade to Pay As You Go (PAYG)

Console: *Billing & Cost Management → Upgrade and Manage Payment → Upgrade to Pay As You Go*.

Why, when the aim is to pay nothing:

- **Idle reclamation.** Oracle stops Always Free VMs that look idle: over 7 days, 95th-percentile CPU use under 20%, network use under 20%, and, on Arm shapes, memory use under 20%. A low-traffic DAB meets the CPU and network conditions most weeks. A stopped VM takes the site *and* its nightly jobs down, and nothing warns you. 2026 guides say PAYG accounts are exempt. **No Oracle page read for the research says so**, so treat the exemption as likely, not certain.
- PAYG accounts can open support tickets. Free-only accounts get forums only. Either way, Oracle's FAQ says the Free Tier comes with no service-level agreement (SLA).
- PAYG bills only usage *above* the Always Free allowances, with no minimum. The catch is that the card becomes chargeable for a mistake (a third OCPU, a sixth volume backup, a paid shape). The budget alert and the quotas below guard against that. You cannot downgrade back to free-only.

### 2.2 A USD 1 budget alert

Console: *Billing & Cost Management → Budgets → Create Budget*.

- Target: the root compartment (the whole tenancy), monthly, amount **1** (USD).
- Alert rule: *Actual spend*, threshold **1 %** of the budget (USD 0.01), sent to your email.

An alert tells you *after* money is spent, and it can arrive late (one 2026 author saw charges land despite an alarm). The quotas are what *prevent* the spend.

### 2.3 Quotas that cap what can be created

Console: *Governance & Administration → Tenancy Management → Quota Policies → Create Quota Policy*, in the root compartment:

```
zero compute-core quotas in tenancy
set compute-core quota standard-a1-core-count to 2 in tenancy
zero compute-memory quotas in tenancy
set compute-memory quota standard-a1-memory-count to 12 in tenancy
set block-storage quota total-storage-gb to 200 in tenancy
```

These allow Arm (A1) VMs up to 2 OCPUs and 12 GB in total, no other shapes, and at most 200 GB of block storage. Those are the Always Free figures after Oracle's June 2026 cut. The quota names come from Oracle's documentation and were **not tried in a console**. The console checks every statement when you save. If it rejects a name, open *Limits, Quotas and Usage*, pick the service, and copy the exact name it lists.

### 2.4 A compartment

Console: *Identity & Security → Compartments → Create Compartment*, named `dab`. Create everything below inside it, so DAB's resources are easy to find and to tell apart from anything else.

## 3. Network: a VCN and its security list

1. *Networking → Virtual Cloud Networks → Start VCN Wizard → Create VCN with Internet Connectivity*. Name it `dab-vcn`, compartment `dab`, and keep the default address ranges. The wizard creates a public subnet, an internet gateway and routes.
2. Open `dab-vcn` → *Security Lists* → *Default Security List for dab-vcn* → *Ingress Rules*:
   - **SSH:** edit the existing rule for TCP port 22. Change its source from `0.0.0.0/0` to **your own IP address followed by `/32`**. To find your IP, run `curl -4 https://ifconfig.me`. Home broadband in Thailand often changes its IP address. If SSH later times out, update this rule first.
   - **Add** a rule: source `0.0.0.0/0`, protocol TCP, destination port `80`. Caddy needs it for Let's Encrypt and for the redirect to HTTPS.
   - **Add** a rule: source `0.0.0.0/0`, protocol TCP, destination port `443`.
   - Keep the ICMP rules that are already there.

Oracle's documentation says to open a port **twice**: here, *and* in the VM's own firewall (step 5.4, which also explains how that firewall treats Docker). A port missing here makes connections time out. Step 16 says what each other symptom means.

## 4. Create the VM

*Compute → Instances → Create instance*, in compartment `dab`:

| Setting | Value |
|---|---|
| Name | `dab-1` |
| Placement | any availability domain the form offers |
| Shape (choose it first: the image list depends on it) | *Change shape → Virtual machine → Ampere → **VM.Standard.A1.Flex***, **1 OCPU, 4 GB memory** |
| Image | *Change image → Ubuntu → **Canonical Ubuntu 24.04*** (the aarch64 build; not "Minimal") |
| Networking | `dab-vcn`, its public subnet, **assign a public IPv4 address** |
| SSH keys | *Paste public keys*: the contents of `~/.ssh/id_ed25519.pub` from your laptop |
| Boot volume | *Specify a custom boot volume size*: **100 GB**. Leave performance and encryption at their defaults |

Write down the **public IP address** once the VM is running.

**Why 1 OCPU and 4 GB.** The size comes from measuring DAB, not from guessing. The research suggested 2 GB from an estimate, and measurement showed that is too little:

- At rest, DAB's Node process uses about 120 MB and Caddy about 50 MB. Ubuntu, Docker and Oracle's agent add an estimated 0.4–0.6 GB (check with `free -m` once it runs).
- One upload at the 25 MB limit is the worst case. A 25 MB CSV peaked at 0.33 GB when saved and 0.78 GB when analysed. A 24.9 MB `.xlsx` (418,000 rows, 137 MB once unzipped) peaked at **2.05 GB**, because the workbook is unpacked in memory to be parsed.
- Node caps its heap at half the machine's memory, up to 2 GB: about 1 GB on a 2 GB VM, 1.5 GB on 3 GB, and 2 GB from 4 GB up. With a heap of 1.25 GB or less, that max-size `.xlsx` crashed Node with "JavaScript heap out of memory". Docker restarts it within seconds, but the upload fails and so does every request in flight. It passed with a 1.5 GB heap and more. At 4 GB, two of them uploaded at the same moment also passed: Node parsed them one after the other, 76 s for both.
- So 4 GB is the smallest size that gives DAB its full default heap. More memory would sit unused, because Node does not take a bigger heap unless told to.
- 1 OCPU uses half of the free CPU allowance, and 4 GB uses a third of the memory (744 of 1,500 OCPU-hours and 2,976 of 9,000 GB-hours in a 31-day month). If Oracle halves the allowance again, this VM still fits. In June 2026, VMs above the new limit were shut down until their owners resized them. A second OCPU would not speed up a parse either: Node parses on one thread.
- **The trade-off is idle reclamation.** At rest, the whole VM (Ubuntu, Docker, Caddy and DAB) uses an estimated 15–20% of 4 GB, which is under the 20% memory line. That is one more reason for PAYG (step 2.1). If you stay on a free-only account, use **3 GB** instead, which still takes the largest upload. Its use at rest, about 20–25%, sits above the line. That is reasoning from the rule, not a guarantee, because Oracle does not say how it measures memory.

**Why a 100 GB boot volume.** The data itself is small (the research estimates about 3 GB). The disk also holds Docker images and 7 nightly backups, and a backup run briefly needs about twice the data size free. 100 GB leaves the other 100 GB of the 200 GB allowance free for later. On Oracle's default performance level, a bigger volume is also faster (per Oracle's block volume documentation, not measured here). Keep everything on this one volume: the nightly copy outside Oracle is what protects the data, not a second Oracle volume.

**"Out of capacity for shape VM.Standard.A1.Flex".** Oracle has no free Arm capacity in that availability domain right now. Oracle says this can take *several days* to clear. Try another availability domain if the form lists one, and retry a few times a day. Do not pick a paid shape to get past it. Once the VM exists, its capacity is yours, so **avoid stopping it**: a stopped VM may meet the same error when you start it again.

## 5. Set up Ubuntu: updates, swap, firewall, Docker

Log in from your laptop:

```sh
ssh ubuntu@<public-ip>
```

### 5.1 Time zone and updates

```sh
sudo timedatectl set-timezone Asia/Bangkok
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

Log in again after a minute. In Bangkok time, the backup at 02:30 and the reboot window at 04:30 below read as written. DAB's own jobs (retention 03:17, encryption check 03:41) use Bangkok time whatever the server's zone is.

### 5.2 Automatic security updates

```sh
sudo apt install -y unattended-upgrades
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
sudo tee /etc/apt/apt.conf.d/52dab-reboot >/dev/null <<'EOF'
// DAB: reboot at 04:30 (server time) when an update needs it.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
```

Ubuntu's security updates now install every day, and the VM reboots at 04:30 when one needs it. Both containers have `restart: unless-stopped`, so they come back by themselves after a reboot. Docker's own packages come from Docker's repository, which this does not cover. They update with the monthly `apt full-upgrade` (step 13).

### 5.3 Swap

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Oracle's Ubuntu images have no swap. 2 GB of swap is a cushion: if a memory spike (a big upload during `apt upgrade`, say) fills the 4 GB, the server slows down instead of the kernel's out-of-memory killer stopping a process.

### 5.4 Open ports 80 and 443 in the VM's firewall (before installing Docker)

Oracle's Ubuntu images have their own iptables firewall. Its `INPUT` chain ends with a rule that **rejects everything** except SSH. Add an accept rule for 80 and 443 at the top, and save it:

```sh
sudo iptables -I INPUT -p tcp -m state --state NEW -m multiport --dports 80,443 -j ACCEPT
sudo netfilter-persistent save
sudo iptables -L INPUT -n --line-numbers    # the 80,443 ACCEPT must be above the REJECT
```

Two things that are easy to get wrong:

- **Do this before installing Docker.** `netfilter-persistent save` writes *every* rule that exists at that moment into `/etc/iptables/rules.v4`. Once Docker runs, that includes Docker's own rules, which Docker re-creates itself at every start. If you need to change the firewall later, edit `/etc/iptables/rules.v4` by hand and reboot. Do not run `iptables-restore` while Docker runs: it wipes Docker's rules, and containers lose their network until `sudo systemctl restart docker`.
- Strictly, Docker's published ports pass through the `FORWARD` chain, where Docker's rules come before Oracle's REJECT, so Caddy is reachable even without this rule. That was tested (see the last section). Add the rule anyway. Anything listening on the VM itself needs it, and with it the symptoms in step 16 tell the causes apart: "Connection refused" then means Caddy is not running, instead of the same "No route to host" as a firewall block.

Do not install `ufw`. It manages the same iptables rules and conflicts with both Oracle's rules and Docker's.

### 5.5 Docker Engine and the Compose plugin

From Docker's own apt repository. It carries current releases of Docker Engine and the Compose plugin, which Ubuntu's `docker.io` package lags behind:

```sh
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
exit
```

Log in again (the group change applies to new sessions), then check:

```sh
docker run --rm hello-world
docker compose version
```

Membership of the `docker` group is as powerful as root, so keep `ubuntu` the only member.

## 6. Point your domain at the VM

At your DNS provider, create an **A record**: name `dab` (giving `dab.example.com`), value the VM's public IP, TTL 300. Then check from your laptop:

```sh
dig +short dab.example.com     # or: nslookup dab.example.com
```

Wait until it prints the VM's IP before step 9. Caddy asks Let's Encrypt for a certificate as soon as it starts, and repeated failed attempts run into Let's Encrypt's rate limits (an hour's wait).

On Cloudflare, set the record to **DNS only** (grey cloud). Proxied mode decrypts every request at Cloudflare. That puts another company in the path of users' data, which is a PDPA question, and it also gets in the way of Caddy's certificate.

## 7. Copy the deploy files and find the image

From your laptop, in a checkout of this repository (run it once, while `~/dab` does not yet exist on the VM):

```sh
scp -r deploy/oracle ubuntu@<public-ip>:dab
```

On the VM, `ls -A ~/dab` should list `compose.yml Caddyfile .env.example backup.sh restore.sh dab-backup.service dab-backup.timer`.

**The image name.** `compose.yml` runs whatever `DAB_IMAGE` in `.env` names. That is `<DOCKERHUB_USERNAME>/dab:latest`, where `<DOCKERHUB_USERNAME>` is the Docker Hub account CI pushes to: the value of the `DOCKERHUB_USERNAME` secret, the name shown at the top right of hub.docker.com. This guide cannot know it, so `.env.example` says `YOUR_DOCKERHUB_USERNAME/dab:latest` until you replace it.

If the repository on Docker Hub is **private**, log in once on the VM with a *read-only* access token (Docker Hub → *Account settings → Personal access tokens*):

```sh
docker login -u <DOCKERHUB_USERNAME>    # paste the token when asked for the password
```

## 8. Write the .env

```sh
cd ~/dab
cp .env.example .env
chmod 600 .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|; s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=$(openssl rand -hex 32)|; s|^STORAGE_ENCRYPTION_KEY=.*|STORAGE_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
nano .env
```

The `sed` line generates the three secrets in place. They never go through your clipboard, and your shell history keeps only the command, not the values. In `nano`, fill in the rest:

| Setting | What to put | Why |
|---|---|---|
| `DAB_IMAGE` | `<DOCKERHUB_USERNAME>/dab:latest` | the image to run (step 7) |
| `DOMAIN` | `dab.example.com` | the name Caddy gets a certificate for |
| `NODE_ENV=production`, `TRUST_PROXY=1` | leave as they are | `compose.yml` pins both anyway. `TRUST_PROXY=1` means exactly one proxy (Caddy) sits in front, so DAB records the real client IP address in the traffic log (Computer-Related Crime Act s.26) and the login limiter cannot be dodged with a forged header. Tested: a forged `X-Forwarded-For` was ignored |
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com | the AI features |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | filled in by `sed` | production refuses to start without them |
| `STORAGE_ENCRYPTION_KEY` | filled in by `sed` | encrypts every stored upload (AES-256-GCM). **Losing it makes every stored file unreadable**, and changing it does the same to files saved before the change |
| `STORAGE_DRIVER=local`, `AI_DAILY_BUDGET` | leave as they are | files stay in the volume that `backup.sh` copies |
| `LEGAL_OPERATOR_NAME` | your name as the pages should show it | Privacy Notice, Terms, Contact |
| `LEGAL_CONTACT_EMAIL`, `LEGAL_POSTAL_ADDRESS` | a mailbox you read, and a postal address | required by PDPA s.23. Use `"line 1\nline 2"` for several lines |
| `LEGAL_HOSTING_PROVIDER` | `"Oracle Cloud Infrastructure"` | add the Oracle company your account's agreement names if counsel wants it named. The research found an agreement with Oracle America, Inc. |
| `LEGAL_HOSTING_REGION` | `"Singapore (ap-singapore-1)"` | |
| `LEGAL_HOSTING_TRANSFER_BASIS` | **leave empty until counsel answers** | the PDPA s.28 exception or s.29 safeguard for keeping data in Singapore. The research found that Oracle's data processing agreement covers processing, but its transfer annex has no clause for Thailand, Singapore or ASEAN, so whether it serves as a s.29 safeguard is untested. The fallback, a s.28 exception, is a legal judgement too. The DPA also lets Oracle access the data from any country "as necessary" for support and incident work, and the research suggested the notice say so: take that to counsel as well. Until it is set, the pages say "being set up", which is true. Do not write your own wording here |
| `*_RETENTION_DAYS` | leave unset | the defaults are the periods the Privacy Notice states |

Then **save a copy of the finished `.env` in your password manager.** A restore onto a new machine needs the same `STORAGE_ENCRYPTION_KEY`. The nightly backup also includes `.env` (encrypted), but a second copy in your own hands costs nothing.

Also update the records in `docs/privacy/`: the hosting row in `vendors.md` §2 (Oracle, Singapore, its DPA, and the date you downloaded copies of the Cloud Services Agreement, the DPA and the Data Transfer Annex), and the checklist in `docs/privacy/README.md`.

## 9. Start DAB

```sh
cd ~/dab
docker compose pull
docker compose up -d
docker compose ps
```

`up -d` returns once DAB reports healthy. Caddy waits for that before it starts. `ps` should show `dab` as `Up … (healthy)` and `caddy` as `Up`. Caddy then gets the certificate, usually within a minute:

```sh
docker compose logs caddy | grep -i "certificate obtained"
```

`STORAGE_ENCRYPTION_KEY` was set before the first boot, so every file is encrypted from the first upload. If you add the key to a server that already holds files, or you moved data in (step 11), encrypt the older files once and restart:

```sh
docker compose exec dab node src/scripts/storage-encrypt.mjs --dry-run   # counts what it would encrypt
docker compose exec dab node src/scripts/storage-encrypt.mjs
docker compose restart dab
```

The Privacy Notice states what a check of the stored files finds. That check runs at boot and takes a few seconds, so reload `/privacy` a minute after the restart.

## 10. First-boot checks

From your laptop:

```sh
curl -sS https://dab.example.com/api/health
# {"status":"ok","version":"…","db":"sqlite","cache":"memory","maxUploadMb":25,…}
curl -sI http://dab.example.com | head -3
# HTTP/1.1 308 Permanent Redirect   …   Location: https://dab.example.com/
```

In a browser:

1. `https://dab.example.com/privacy`: your name, email and address appear. *Hosting provider* says Oracle Cloud Infrastructure and *Hosting region* says Singapore. *Transfer safeguard* says "being set up" until counsel answers. Section 3 says "Stored files are encrypted at rest (AES-256-GCM)".
2. `/terms` and `/contact` show the same details.
3. Sign up for your own account (tick both boxes), upload `backend/sample-data/thai_shop.csv`, save it, sign out and back in, and open it again.
4. Check that DAB records your real IP address, not a 172.x Docker address:
   ```sh
   docker compose exec dab node --input-type=module -e 'import { createClient } from "@libsql/client"; const db = createClient({ url: "file:/app/backend/data/app.db" }); console.table((await db.execute("select event, ip, created_at from traffic_log order by created_at desc limit 3")).rows)'
   ```
5. Warnings at boot:
   ```sh
   docker compose logs dab | grep '"level":40'
   ```
   Two are expected today. One says *Legal details are not set*, until `LEGAL_HOSTING_TRANSFER_BASIS` is filled in. The other says *Thai PDF font not found*: the image does not include the Thai font that PDF export uses, so Thai text in exported PDFs does not render. That is a known limitation of the image, not of this setup. Fix any other warning.
6. On the VM: `free -m` and `df -h /`. At rest, expect well under 1 GB of memory in use. Write down the figure: it is the real version of the estimate in step 4.

## 11. Move existing data from Railway

Skip this if DAB never ran on Railway, or held nothing worth keeping.

**Get the data out before anything else.** If the Railway trial has expired and the service is stopped, the research suggests paying for one Hobby month (USD 5) to start it again, long enough to copy the data. That route is the research's inference, not a procedure Railway documents.

**Use the same keys.** If Railway's settings had a `STORAGE_ENCRYPTION_KEY`, put *that* key in the VM's `.env` (step 8) instead of a new one, or the files it encrypted cannot be read. Copying Railway's two JWT secrets as well keeps everyone signed in.

On your laptop, with the Railway CLI (v4 or later), open a shell in the running DAB service:

```sh
railway ssh
```

Inside it, make a consistent copy, in the same layout as a backup (`app.db` plus `objects.tar`):

```sh
mkdir -p /tmp/dab-export && cd /app/backend
node --input-type=module -e "import { createClient } from '@libsql/client'; await createClient({ url: 'file:data/app.db' }).execute(\"VACUUM INTO '/tmp/dab-export/app.db'\");"
mkdir -p data/objects && tar -C data -cf /tmp/dab-export/objects.tar objects
tar -C /tmp -czf /tmp/dab-export.tgz dab-export && sha256sum /tmp/dab-export.tgz
exit
```

Then download `/tmp/dab-export.tgz`. One way that survives a terminal is `railway ssh -- base64 /tmp/dab-export.tgz > dab-export.b64`, then `base64 -di dab-export.b64 > dab-export.tgz` on the laptop. **Check that `sha256sum dab-export.tgz` matches** the sum printed on Railway. The Railway CLI part of this step **was not tested** (no Railway account was available). Check `railway ssh --help` for the current syntax. The export commands themselves were tested against a copy of DAB's database.

Copy it to the VM and restore it:

```sh
scp dab-export.tgz ubuntu@<public-ip>:
ssh ubuntu@<public-ip>
mkdir -p ~/railway && tar -xzf ~/dab-export.tgz -C ~/railway
cd ~/dab && ./restore.sh ~/railway/dab-export
docker compose exec dab node src/scripts/storage-encrypt.mjs     # files saved on Railway before a key was set
docker compose restart dab
```

`restore.sh` moves whatever the volume held to `replaced-<time>/` inside it, copies the Railway data in, checks the database, and starts DAB. Then sign in with a Railway account and open a saved dataset.

Two consequences to know about:

- The first boot runs the database migrations, and about a minute later the first retention run. That run deletes saved datasets with no activity for 365 days (CHANGELOG 21.30, *Before deploying*). Keep `dab-export.tgz` until you are satisfied.
- Once DAB runs on Oracle, delete the Railway service and its volume. Record the date in `docs/privacy/vendors.md`, because Railway should then no longer hold users' data.

## 12. Backups outside Oracle, and a restore drill

The VM, its disks, Oracle's volume backups and Oracle Object Storage all sit in **one Oracle account**. Oracle can suspend a free account without explanation (the forums carry such reports), and a suspension takes all of them at once. So the nightly backup goes **outside Oracle**. Do not use Oracle Object Storage for it.

What `backup.sh` does each night, at 02:30 Bangkok time:

1. A consistent copy of the database. It runs `VACUUM INTO` inside the DAB container, through the same SQLite driver the server uses (the image has no `sqlite3` program), and checks the copy with `PRAGMA integrity_check`.
2. A tar of `objects/`, the uploaded files, each already encrypted with `STORAGE_ENCRYPTION_KEY`.
3. The `.env`.
4. All of it as one archive, **encrypted with [age](https://age-encryption.org/) to a public key**, uploaded with rclone. Local copies are kept for 7 days.

### 12.1 Where the backups go

**Recommended: an AWS S3 bucket in Bangkok (`ap-southeast-7`).** It costs USD 0.0225 per GB-month (research, from AWS's price file). The backups stay in Thailand, so they add no new transfer abroad, and the bucket is where DAB would land if it moves to AWS (step 17). Bangkok is an *opt-in* region: enable it in the AWS console first (*Account → AWS Regions*).

Any S3-compatible store works with the same script, such as Cloudflare R2 or Backblaze B2. Either way, **the backup provider is a new recipient of personal data.** The archive is encrypted with a key that provider never sees, but ask counsel whether it still counts as a recipient. Then record the provider in `docs/privacy/vendors.md`, and in the Privacy Notice's list of recipients if counsel says so. Do not change the notice's text yourself.

In the AWS console:

1. **S3 → Create bucket**, region Asia Pacific (Thailand) `ap-southeast-7`, a name such as `dab-backups-<something-unique>`. Keep *Block all public access* on and versioning off.
2. On the bucket: *Management → Create lifecycle rule*, prefix `oracle/`, with two actions: *Expire current versions of objects* after **30 days**, and *Delete expired object delete markers or incomplete multipart uploads* → *Delete incomplete multipart uploads* after **1 day**. Expiry happens here rather than on the server, so the server's key never needs permission to delete (next point). That is also why the second action is needed: rclone sends an archive over 200 MB in parts, and if the upload is cut off, this key cannot abort it. S3 keeps, and bills, the parts already sent until a rule removes them.
3. **IAM → Users → Create user** `dab-backup`, with no console access. Attach this inline policy (put your bucket name in):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::BUCKET" },
       { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"], "Resource": "arn:aws:s3:::BUCKET/oracle*" }
     ]
   }
   ```
   It can list, upload and read back, but **not delete**. Someone who breaks into the VM cannot wipe the backups with it. (`oracle*` rather than `oracle/*`: rclone first checks whether `oracle` itself is a file.)
4. *Security credentials → Create access key* (for "Application running outside AWS"). Keep the two values for step 12.3.

### 12.2 The encryption key pair (on your laptop)

```sh
age-keygen -o dab-backup-key.txt      # prints "Public key: age1…"
```

(`age` is `apt install age` on Ubuntu or WSL, and `brew install age` on a Mac.)

- `dab-backup-key.txt` is the **private key**. Every backup can be opened with it and nothing else. Keep it in your password manager **and** on an offline copy (a USB stick in a drawer). **Never put it on the VM.** If you lose it, every backup is unreadable. If it leaks, so is all the data in every backup, so treat it like the `.env`.
- The `age1…` line is the **public key**. It can only encrypt, so it is safe on the server.

On the VM:

```sh
cd ~/dab
echo 'age1…your public key…' > backup-recipients.txt
```

You can add a second public key on its own line, for example one held by someone you trust. Either private key then opens the backups.

### 12.3 rclone and backup.env (on the VM)

```sh
sudo apt install -y age rclone
read -rp "Access key ID: " AK; read -rsp "Secret access key: " SK; echo
sudo install -d -m 700 /root/.config/rclone
sudo sh -c 'umask 077 && cat > /root/.config/rclone/rclone.conf' <<EOF
[offsite]
type = s3
provider = AWS
access_key_id = $AK
secret_access_key = $SK
region = ap-southeast-7
location_constraint = ap-southeast-7
acl = private
no_check_bucket = true
EOF
unset AK SK
sudo rclone lsf offsite:BUCKET/oracle && echo "rclone can reach the bucket"
```

The keys go into the file through standard input, never on a command line. sudo records every command line it runs, arguments included, in `/var/log/auth.log` and the journal, which the `ubuntu` user can read (it is in the `adm` group). So `sudo rclone config create … secret_access_key=…` would leave the key in the logs for weeks (tested on Ubuntu 24.04). The file is readable by root only, and `dab-backup.service` looks for it there (`sudo rclone config file` prints the path). This replaces any rclone settings root already had, and a new VM has none. `no_check_bucket = true` stops rclone trying to create the bucket, which the key may not do.

```sh
cat > ~/dab/backup.env <<'EOF'
RCLONE_REMOTE=offsite:BUCKET/oracle
# Optional: a dead-man's switch, e.g. a free healthchecks.io check (step 14).
# PING_URL=https://hc-ping.com/your-check-uuid
EOF
chmod 600 ~/dab/backup.env
```

Other settings, with their defaults: `BACKUP_DIR=/var/backups/dab`, `KEEP_LOCAL_DAYS=7`, `INCLUDE_ENV=1`, `REMOTE_KEEP_DAYS=0` (leave it at 0: the lifecycle rule expires old backups, and this key cannot delete). The header of `backup.sh` lists them all.

### 12.4 First run, then every night

```sh
cd ~/dab && sudo ./backup.sh
# backup: copying the database
# backup: copying stored files
# backup: encrypting
# backup: uploading dab-20261012T193000Z.tar.gz.age (…) to offsite
# backup: done: dab-20261012T193000Z.tar.gz.age, …, … s
```

Schedule it (the unit expects the files in `/home/ubuntu/dab`):

```sh
sudo cp ~/dab/dab-backup.service ~/dab/dab-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dab-backup.timer
systemctl list-timers dab-backup.timer       # next run: 02:30 Bangkok
journalctl -u dab-backup.service -n 20       # what the last run printed
```

A night the VM was off is caught up at the next boot. 02:30 stays clear of DAB's retention run (03:17), its encryption check (03:41) and the 04:30 reboot window.

### 12.5 Restore drill (on your laptop, at least every three months)

A backup that has never been restored is a hope, not a backup. You need Docker, age and rclone on the laptop (on Windows, inside WSL2 with Docker Desktop). Download the newest archive from the S3 console (or with an rclone remote of your own), then:

```sh
mkdir dab-drill && cd dab-drill
cp <repo>/deploy/oracle/{compose.yml,Caddyfile,restore.sh} .
age -d -i ~/dab-backup-key.txt ~/Downloads/dab-*.tar.gz.age | tar -xzO ./env > .env    # the production settings
chmod 600 .env
sed -i 's/^DOMAIN=.*/DOMAIN=localhost/' .env      # macOS: sed -i '' …
COMPOSE_PROJECT_NAME=dab-drill ./restore.sh -i ~/dab-backup-key.txt ~/Downloads/dab-*.tar.gz.age
```

Open <https://localhost> (accept the warning about Caddy's local certificate), sign in with your own account, open a saved dataset and download its file. Then remove the drill copy. This deletes the drill's volumes only:

```sh
COMPOSE_PROJECT_NAME=dab-drill docker compose down -v
```

Write the date in `docs/privacy/retention-schedule.md` §7 with your monthly checks. `COMPOSE_PROJECT_NAME=dab-drill` keeps the drill's containers and volumes apart from any other DAB on the same machine. A checkout in a folder named `dab` gives the repo-root `docker-compose.yml` the project name `dab`, the same as `compose.yml`. If the Docker Hub repository is private, run `docker login` on the laptop first.

### 12.6 A real restore on the server

Decrypt on the laptop, which holds the private key, and copy the result over:

```sh
mkdir restore && age -d -i ~/dab-backup-key.txt dab-<time>.tar.gz.age | tar -xz -C restore
scp -r restore ubuntu@<public-ip>:restore-<time>
ssh ubuntu@<public-ip> 'cd ~/dab && ./restore.sh ~/restore-<time>'
```

`restore.sh` checks the archive's checksums and stops DAB. It moves the current data to `replaced-<time>/` inside the volume, so nothing is deleted. Then it copies the backup in, checks the database, and starts DAB. When the restore looks right, remove the plaintext copies (`~/restore-<time>` on the VM, `restore/` on the laptop) and the moved-aside data:

```sh
docker compose exec dab ls /app/backend/data                       # shows replaced-<time>/
docker compose exec dab rm -r /app/backend/data/replaced-<time>
```

On a **new** VM, set up steps 5–8 first, and use the backup's `env` file as `.env`, since the same `STORAGE_ENCRYPTION_KEY` is needed. The restore steps are the same.

### 12.7 Retention, and what the Privacy Notice must say

- Backups live 30 days in the bucket (the lifecycle rule) and 7 days on the VM. An account deleted today is gone from every backup within about a month (S3 runs lifecycle expiry in the background, sometimes a day late). The PDPC's deletion Notification asks for erasure to reach backups within 90 days (`docs/privacy/retention-schedule.md`).
- **The Privacy Notice should state the backup retention period.** How to word it is a question for counsel, listed under *Take to counsel* in `docs/privacy/README.md`. Until counsel answers, record the facts in `retention-schedule.md` §4: the *Backups* row (nightly, encrypted, 30 days, provider and region) and the *Request logs* row (Docker keeps at most 5 × 10 MB of DAB's request log, rotated by `compose.yml`).
- Take two more lines of the notice to counsel with that question. Both assume a host that runs the server for you. The notice says request logs are "kept by our hosting provider for as long as its log retention allows", but here Docker on your VM keeps them, capped by size. It also says HTTPS is "provided by our hosting provider", but here it is Caddy, which you run. Do not change the notice's text yourself.
- Each backup is a full copy, so the bucket holds about 30 × the data size. 266 MB of data made a 238 MB archive in the local test, because uploads are already encrypted and do not compress. At the research's 3 GB estimate, that is about 90 GB, or about USD 2 a month in Bangkok. If that matters, keep fewer days.
- Oracle's own boot volume backups are optional and do not survive a suspended account. Always Free allows **5**. Do not attach Oracle's predefined backup policies (Bronze, Silver, Gold), which keep more than five, and the extra ones are billed.

## 13. Updates and rollback

When CI has pushed a new image:

```sh
cd ~/dab
sudo ./backup.sh                 # first: a new version can migrate the database forward
docker compose images dab        # note what runs now (tag and image ID)
docker compose pull
docker compose up -d
docker image prune -f            # remove the old image layers
```

`docker compose pull` updates Caddy (`caddy:2`) at the same time.

**Rollback.** CI also tags each image with its full commit SHA (`<DOCKERHUB_USERNAME>/dab:<40-character SHA>`; GitHub's commit list shows the SHAs). Point `.env` at the previous commit's tag and recreate the container:

```sh
sed -i 's|^DAB_IMAGE=.*|DAB_IMAGE=YOUR_DOCKERHUB_USERNAME/dab:<previous-commit-sha>|' .env
docker compose up -d
```

To stay on a known version, keep `DAB_IMAGE` pinned to a SHA tag and change it on purpose for each update. If the newer version had already changed the database and the older one fails to start, restore the backup you took before the update (step 12.6).

**Operating system.** Security updates install by themselves (step 5.2). Once a month, during your console login (step 15):

```sh
sudo apt update && sudo apt full-upgrade -y     # includes Docker's packages
[ -f /var/run/reboot-required ] && sudo reboot
```

## 14. Monitoring

- **Is the site up?** Watch it from outside, because a stopped or reclaimed VM cannot report on itself. A free uptime monitor (UptimeRobot, Better Stack and others have free plans) can check `https://dab.example.com/api/health` every 5 minutes for the keyword `"ok"` and email you. Set its timeout to 30 seconds: while a large `.xlsx` is parsed, the health check itself waits up to about 15 s (step 16).
- **Did last night's backup run?** Create a free check at healthchecks.io: period 1 day, grace 2 hours. Put its ping URL in `backup.env` as `PING_URL`. `backup.sh` pings it after a successful run and pings `…/fail` after a failed one. If a night is missed altogether (the VM is down, say), the check alerts you itself.
- **Disk:** `df -h /` and `docker system df`, monthly. Docker's container logs are capped by `compose.yml`, and journald caps its own.
- **Memory:** `free -m` and `docker stats --no-stream`. In `docker compose logs dab`, look for "JavaScript heap out of memory" (step 16).
- **Metrics:** `/api/metrics` answers a monitor that sends `Authorization: Bearer <METRICS_TOKEN>` once `METRICS_TOKEN` is set in `.env`.

## 15. Staying free

| Always Free limit (as of Oct 2026; check in the console) | This setup |
|---|---|
| Arm compute: 1,500 OCPU-hours and 9,000 GB-hours a month, shared by all A1 VMs (2 OCPUs and 12 GB if run all month) | 1 VM, 1 OCPU, 4 GB: 744 OCPU-hours and 2,976 GB-hours |
| Block storage: 200 GB in total, boot volumes included, at most 2 volumes | one 100 GB boot volume |
| Volume backups: 5 | none needed. Keep at most 5 if you make any |
| Object Storage: 20 GB per Oracle's service data, 10 GB per its regions page | not used. Backups go outside Oracle |
| Outbound traffic: 10 TB a month | the research estimates about 10 GB a month |
| Load balancer: 1, at 10 Mbps | not used. Caddy does HTTPS on the VM |
| Region: the home region only | Singapore |

**Do not create:** a second A1 VM that takes the total above 2 OCPUs or 12 GB; any other shape (the AMD micro VM is free but too small for DAB); volumes beyond 200 GB in total; Oracle's predefined backup policies; anything in another region. The quotas from step 2.3 refuse most of these.

**Log in to the console at least once a month.** Oracle's FAQ says accounts idle for 30 days or more may be treated as abandoned (one documentation extract says 60), and it does not define "idle". Make it a monthly calendar reminder, and use the visit to:

- look at *Billing → Cost Analysis* (it should show 0) and confirm the budget alert has not fired;
- check that the VM is running;
- run the OS update from step 13, and `df -h /`;
- every third month, do the restore drill (step 12.5).

## 16. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Creating the VM fails with "Out of capacity" / "Out of host capacity" | no free Arm capacity in that availability domain | Retry later, and in another availability domain if one is listed. It can take days. Do not switch to a paid shape. Once the VM exists, do not stop it without need |
| The browser or `curl` **times out** | the packets never reach the VM: a missing security-list rule (step 3), a DNS record pointing elsewhere, or a stopped VM | Check the ingress rules for 80 and 443, `dig +short dab.example.com`, and the VM's state in the console |
| `curl` says **"No route to host"** | the VM's iptables firewall rejected the connection (Oracle's REJECT rule) | `sudo iptables -L INPUT -n --line-numbers`: the `80,443` ACCEPT must sit above the REJECT (step 5.4). Also check that Caddy runs (`docker compose ps`). With Caddy down and no ACCEPT rule, this is also what you see |
| `curl` says **"Connection refused"** | the VM accepted the port but nothing listens on it | `docker compose ps`. Caddy is not running, so read `docker compose logs caddy` |
| SSH times out, though it worked yesterday | your home IP address changed | Update the port-22 rule in the security list (step 3) to your new IP |
| Certificate warnings, or Caddy's log says the challenge failed, "no such host", or a timeout | Let's Encrypt cannot reach `DOMAIN` on port 80/443: DNS not pointing at the VM yet, a port closed in either firewall, or Cloudflare proxying | Fix those, then `docker compose restart caddy`. After several failures Let's Encrypt makes you wait an hour |
| `docker compose up -d` ends with **"dependency failed to start: container dab-dab-1 is unhealthy"** | DAB cannot start, almost always because of `.env` | `docker compose logs dab --tail 30`. For example, *"FATAL: JWT_SECRET and JWT_REFRESH_SECRET must be set in production"*, or *"STORAGE_ENCRYPTION_KEY must be 32 bytes written as base64 (44 characters) or hex (64 characters)"*. Fix `.env`, then `docker compose up -d` |
| `up -d` says "required variable DAB_IMAGE is missing a value" (or DOMAIN) | `.env` is missing or not next to `compose.yml` | Run compose from `~/dab`, and check `ls -A ~/dab` |
| The pull fails with "no matching manifest for linux/arm64…", or the container exits at once with "exec format error" | that tag holds only an amd64 image (pushed before v21.32) | Use a tag CI pushed from v21.32 on, and check it with `docker buildx imagetools inspect` (step 0) |
| Every page hangs for 10–15 s, then works again | someone is uploading a large `.xlsx`. Node parses it on its one thread, and other requests wait (measured: 8–15 s delays during a 25 MB `.xlsx`, which took 32 s in all) | Expected with today's code. More OCPUs do not help |
| Pages answer **502 Bad Gateway** | Caddy runs but DAB is restarting | `docker compose ps` and `docker compose logs dab` |
| A large upload fails with **504** after 5 minutes | the upload was slower than about 0.7 Mbit/s for 25 MB. Caddy's `read_body` and Node's own 300 s limit stop it | Expected on a very slow line. Try a faster connection |
| A large `.xlsx` upload fails and the site blinks off for a few seconds | Node ran out of heap ("JavaScript heap out of memory" in the logs). The VM has less than about 3 GB | Resize to 4 GB: *Instance → Edit → Shape* (the VM restarts) |
| `/privacy` says "some older files may not be encrypted yet" | files saved before the key was set, or it is just after a restart | Wait a minute and reload. If it stays, run `storage-encrypt` (step 9) and restart |
| The backup failed (`journalctl -u dab-backup.service -n 50`, or a healthchecks.io alert) | `RCLONE_REMOTE` not set, wrong keys, the `dab` container not running, or not enough free disk (a run needs about twice the data size free) | The last lines of the journal name the cause. Run `sudo ./backup.sh` by hand to check the fix |
| The VM is stopped, and you did not stop it | idle reclamation, or a disabled account or shape | Start it in the console (it may hit "Out of capacity", see the first row). Read Oracle's emails. This is the case the off-Oracle backups are for (step 12.6, onto a new VM or another host) |

## 17. What this costs, and when to move to AWS Bangkok

**Cost.** Oracle: THB 0 a month while everything stays inside the Always Free allowances (step 15), with your card on file because of PAYG. The backup bucket: cents a month at today's data size, about USD 2 a month at the research's 3 GB estimate with 30 days kept. Your domain name. And your time: half a day to a day to set up, then 1–2 hours a month (research estimates). Over the first 12 months, the research puts the saving at about THB 2,000–2,800 against Railway Hobby, THB 3,500–3,700 against Hostatom, and THB 4,150–9,800 against AWS Bangkok.

"Free" has its own price: no SLA, Arm capacity shortages that can last days, an allowance Oracle has already halved once without notice, and anecdotal reports of accounts terminated with no explanation. The off-Oracle backup and the restore drill are what make that acceptable.

**When to move to AWS Bangkok** (`ap-southeast-7`, a t4g.small, about THB 692 a month with VAT, per the research). Move when any one of these happens:

- a school or government agency asks where data is stored, or a "stored in Thailand" promise starts to matter;
- DAB starts charging customers who expect it to stay up;
- Oracle cuts or suspends the free allowance again.

The move is the same restore. The arm64 image runs unchanged on AWS's Arm t4g.small. Set up Docker and this compose file there, restore the newest backup from the S3 bucket with `restore.sh`, point DNS at the new address, and update `LEGAL_HOSTING_PROVIDER`, `LEGAL_HOSTING_REGION` and `LEGAL_HOSTING_TRANSFER_BASIS`, plus the records in `docs/privacy/`. Hosting in Thailand removes the transfer abroad for hosting. The transfer to Anthropic in the United States stays whichever host DAB uses. The research reports *Oracle free tier for DAB* and *Thai region hosting for DAB* (12 October 2026) give the full comparison.

## How this guide was tested

Tested locally on 12 October 2026, with Docker 29.3 and Compose 5.1, using the v21.32 images (amd64 natively, arm64 under QEMU emulation):

- `compose.yml`: rendered by `docker compose config` and passed `yamllint`. The stack was run with `DOMAIN=localhost` (Caddy's local CA). Results: `https://localhost/api/health` answered 200, http redirected to https with a 308, `/privacy` showed the `LEGAL_*` values (a two-line postal address included), the helmet headers arrived once each with no `Server` or `Alt-Svc` header, the UI was compressed, the API was not, and DAB was not reachable except through Caddy.
- Sign-up, a saved upload, sign-out and sign-in through Caddy. The traffic log recorded the client's own address, and a forged `X-Forwarded-For` header was ignored.
- `STORAGE_ENCRYPTION_KEY` added after the first upload, then `storage-encrypt` (dry run and real) and a restart. The Privacy Notice went from "not yet encrypted" to "partly" to "encrypted at rest", and the stored file started with DAB's encryption header.
- Data survived `docker compose down` and `up`, and the downloaded file matched the upload byte for byte.
- The same stack on the **arm64** image: health, sign-up, upload, encryption, backup and restore all passed.
- `backup.sh` (shellcheck clean): to a local rclone remote and to an S3 emulator (moto) enforcing the step 12.1 IAM policy. The 238 MB archive went up as a multipart upload. The key could not delete, which was tested. The emulator needed `force_path_style`, `provider=Other`, and `--s3-no-head` (it rejects a request real S3 accepts), so the exact `provider=AWS` setup was not run against AWS itself. Step 12.3's rclone commands were run on Ubuntu 24.04 with its rclone 1.60.1: the file parses, only root can read it, and the key appears in no log under `/var/log`. That rclone version also reached AWS's real Bangkok endpoint (`s3.ap-southeast-7.amazonaws.com` answered "InvalidAccessKeyId" to a made-up key). Also tested: dead-man's-switch pings, local and remote retention, refusal of a private key or a missing remote, a stopped container, cleanup after SIGTERM, a fresh install with no uploads, and no secret in the output.
- `restore.sh`: an encrypted archive into fresh volumes as the drill does it, a Railway-style export over existing data (moved aside, not deleted, then 2,514 legacy files encrypted), and a damaged archive (refused before anything was touched). After each restore, sign-in worked and the restored files matched the uploads.
- Memory sizing (step 4): measured with 25 MB CSV and 19.6 MB and 24.9 MB `.xlsx` uploads, under memory limits standing in for 2, 3, 4 and 6 GB VMs (heaps of 0.7, 1.25, 1.5, 1.75 and 2 GB), one at a time and two at once, and with the health check timed during a parse. The test machine was x86, so parse times on an Ampere A1 core will differ.
- Firewall (steps 5.4 and 16): Oracle's iptables rules were reproduced and tested against a client in a separate network namespace. Results: packets dropped before they reached the VM (standing in for a missing security-list rule) gave a timeout, Oracle's REJECT gave "No route to host", the guide's rule with Caddy stopped gave "Connection refused", and Docker-published ports worked even without the rule. The `iptables` and `netfilter-persistent` commands were run on Ubuntu 24.04 with an approximation of Oracle's `rules.v4`.
- Step 5's apt commands (unattended-upgrades, Docker's repository, Docker CE, the Compose plugin, age, rclone) were run in an **arm64 Ubuntu 24.04** container. `dab-backup.service` and `.timer` passed `systemd-analyze verify`.
- Updates and rollback (step 13), through a local registry holding a two-platform tag.

**Not tested**, because they need the real services: everything in the Oracle console (steps 1–4, the quota statements, the budget, idle reclamation, capacity errors), Oracle's actual Ubuntu image and agent memory use, Let's Encrypt issuing a real certificate, AWS S3 and IAM with a real key, the Railway CLI, and Docker Hub pulls of your image.
