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

The `Deploy to Vultr` GitHub Actions workflow deploys each push to `main` to an Ubuntu Vultr VPS running Docker. The VPS must have Docker installed, allow the deploy user to run Docker, and have the application's server variables in `/etc/vastoptiontraders.env` with permissions restricted to that user/root. The app listens on port 3000; put a TLS reverse proxy such as Caddy or Nginx in front of it for a public production domain.

Add these GitHub repository Actions secrets:

- `VULTR_HOST`: VPS IP address or hostname
- `VULTR_USER`: SSH deploy username
- `VULTR_SSH_PRIVATE_KEY`: private key whose public key is authorized on the VPS
- `VULTR_KNOWN_HOSTS`: pinned SSH host-key line for the VPS

Add these Actions variables for the client build:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_MEGAPAY_KES_PER_USD`

On the VPS, set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MEGAPAY_API_KEY`, and `MEGAPAY_EMAIL` in `/etc/vastoptiontraders.env`. Do not commit `.env` or place server secrets in Actions variables. After setup, push to `main` or run the workflow manually from the Actions tab.
