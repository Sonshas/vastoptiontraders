# Option Market Gateway

create a proffesional trading welcome page for optionmarkettraders.com with pictures and login flow come up with somehow a replica looking almost deriv.com design

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://deriv-lookalike-portal.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c2348e13-61cc-4bb1-8ce0-247b28cf0333).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deploy to Vultr

The `Deploy to Vultr` GitHub Actions workflow deploys each push to `main` to an Ubuntu Vultr VPS running Docker. For this project, the intended hostname is `vastoptionmarkets.com` and the VPS IP is `139.84.240.227`.

One-time setup:

1. In Cloudflare DNS, set the apex A record to `139.84.240.227`; use DNS-only while Caddy obtains its first certificate. After HTTPS works, proxying may be re-enabled with Cloudflare SSL/TLS set to Full (strict). Allow ports 22, 80, and 443 in the Vultr firewall.
2. Rotate any root password exposed outside the Vultr console. In the Vultr web console, download and run the bootstrap as root:

   ```sh
   curl -fsSLo /root/bootstrap-vultr.sh https://raw.githubusercontent.com/Sonshas/vastoptiontraders/main/scripts/bootstrap-vultr.sh
   bash /root/bootstrap-vultr.sh vastoptionmarkets.com
   ```

   It creates the non-root `deploy` user with the dedicated public key, installs Docker and Caddy, configures HTTPS, opens UFW ports 22/80/443, and creates `/etc/vastoptiontraders.env` with mode 640. It disables SSH root/password login; use the web console for this first run.

3. In Supabase SQL Editor, verify the existing application migrations are already applied. The live project was checked and `site_settings` is missing, so apply `drizzle/migrations/0005_site_settings.sql` once. Do not rerun the earlier table-creation migrations.
4. Fill `/etc/vastoptiontraders.env` on Vultr and set its owner/group to `root:docker` and mode to `640`.
5. Add the GitHub Actions secrets and variables listed below. Verify the SSH host fingerprint shown by the Vultr console before adding a `known_hosts` entry.
6. Run `Deploy to Vultr` from the GitHub Actions tab. The workflow tests a candidate container against `/api/health` (a read-only Supabase query), rolls back on failure, and verifies the public HTTPS endpoint.

The application is bound only to `127.0.0.1:3000` behind Caddy. Supabase remains the production Auth/database provider; this deployment does not replace it with MySQL.

Add these GitHub repository Actions secrets:

- `VULTR_HOST`: VPS IP address or hostname
- `VULTR_USER`: SSH deploy username
- `VULTR_SSH_PRIVATE_KEY`: private key whose public key is authorized on the VPS
- `VULTR_KNOWN_HOSTS`: pinned SSH host-key line for the VPS

Add these Actions variables for the client build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_MEGAPAY_KES_PER_USD`
- `VULTR_DOMAIN`: public HTTPS hostname (for example, `vastoptionmarkets.com`)

On the VPS, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MEGAPAY_API_KEY`, and `MEGAPAY_EMAIL` in `/etc/vastoptiontraders.env`, preserving mode 640. Do not commit `.env` or place server secrets in Actions variables. The workflow tests a candidate container against `/api/health` (which performs a read-only Supabase query), rolls back if the new release fails its health check, and verifies the public HTTPS endpoint. Database schema migrations remain a one-time Supabase setup and are not automatically applied by deployment. After setup, run the workflow manually from the Actions tab.
