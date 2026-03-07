# DIDaaS Smart Wallet PoC

A proof-of-concept for creating **ERC-4337 smart wallets** authenticated via **Google social login + Custom JWT (RS256)** using the [thirdweb Growth plan](https://thirdweb.com/pricing).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Auth Flow                                                      │
│                                                                 │
│  User                  Frontend              Backend            │
│   │                      │                     │               │
│   │─── Click Google ────>│                     │               │
│   │<── Google ID token ──│                     │               │
│   │                      │──POST /auth/google─>│               │
│   │                      │   { idToken }        │               │
│   │                      │                     │ Verify via    │
│   │                      │                     │ Google JWKS   │
│   │                      │<── { jwt } ─────────│               │
│   │                      │                     │               │
│   │          inAppWallet.connect({ jwt })       │               │
│   │          thirdweb fetches /.well-known/jwks.json           │
│   │          thirdweb verifies RS256 JWT                       │
│   │          smartWallet created (ERC-4337, Sepolia)           │
│   │<── Smart wallet address ────────────────────              │
└─────────────────────────────────────────────────────────────────┘
```

**Monorepo structure:**

```
DIDaaS-SmartWallet-PoC/
├── src/                    # Next.js frontend (thirdweb + Google OAuth)
│   └── app/
│       ├── page.tsx        # Google login + smart wallet UI
│       ├── providers.tsx   # GoogleOAuthProvider + ThirdwebProvider
│       ├── layout.tsx
│       └── client.ts       # thirdweb client
├── backend/                # Fastify backend (JWT issuer + JWKS endpoint)
│   ├── src/
│   │   └── index.ts        # Fastify server
│   ├── scripts/
│   │   └── generate-keys.ts
│   └── .env.example
└── package.json
```

---

## Prerequisites

- [Bun](https://bun.sh) v1.0+
- [thirdweb account](https://thirdweb.com) on the **Growth** plan
- [Google Cloud Console](https://console.cloud.google.com) project with OAuth 2.0 credentials

---

## Step 1 — Google OAuth setup

1. Go to [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials**.
2. Create an **OAuth 2.0 Client ID** (Application type: **Web application**).
3. Add `http://localhost:3000` to **Authorized JavaScript origins**.
4. Copy the **Client ID** — you will need it in both frontend and backend env files.

---

## Step 2 — Generate RSA key pair

The backend signs custom JWTs with an RSA-2048 private key. Run the generator once:

```sh
cd backend
bun run generate-keys
```

This prints three values — copy them into `backend/.env`:

```
PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
KEY_ID="<uuid>"
```

---

## Step 3 — Configure backend environment

Copy `backend/.env.example` to `backend/.env` and fill in all values:

```env
# From Step 2
PRIVATE_KEY_PEM="..."
PUBLIC_KEY_PEM="..."
KEY_ID="..."

# From Step 1
GOOGLE_CLIENT_ID="your-id.apps.googleusercontent.com"

# Must match NEXT_PUBLIC_JWT_AUDIENCE in frontend .env.local
# Also set as "AUD Value" in thirdweb dashboard
JWT_AUDIENCE="didaas-smartwallet"

FRONTEND_URL="http://localhost:3000"
PORT=3001
```

---

## Step 4 — Configure thirdweb dashboard (Custom JWT)

1. Open [thirdweb Dashboard](https://thirdweb.com/dashboard) → your project → **In-App Wallet**.
2. Go to **Authentication** → enable **Custom JSON Web Token**.
3. Set the following:

| Field | Value |
|---|---|
| **JWKS URI** | `http://localhost:3001/.well-known/jwks.json` (dev) or your deployed backend URL |
| **AUD Value** | `didaas-smartwallet` (must match `JWT_AUDIENCE` in backend) |

4. Save.

> For production, deploy the backend and use its public URL as the JWKS URI.

---

## Step 5 — Configure frontend environment

Create `.env.local` in the project root:

```env
# thirdweb client ID — https://portal.thirdweb.com/typescript/v5/client
NEXT_PUBLIC_TEMPLATE_CLIENT_ID="your-thirdweb-client-id"

# From Step 1
NEXT_PUBLIC_GOOGLE_CLIENT_ID="your-id.apps.googleusercontent.com"

# Backend URL
NEXT_PUBLIC_BACKEND_URL="http://localhost:3001"
```

---

## Step 6 — Run

Install dependencies for both packages:

```sh
# Frontend
bun install

# Backend
cd backend && bun install
```

Start both services (two terminals):

```sh
# Terminal 1 — backend (port 3001)
cd backend
bun run dev

# Terminal 2 — frontend (port 3000)
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How it works

### Backend endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/.well-known/jwks.json` | Public JWKS — thirdweb calls this to verify JWTs |
| `POST` | `/auth/google` | Accepts `{ idToken }`, verifies via Google, returns `{ jwt }` |

### JWT claims

The custom JWT issued by the backend contains:

```json
{
  "sub": "<google-user-id>",
  "aud": "didaas-smartwallet",
  "email": "user@example.com",
  "name": "User Name",
  "iat": 1700000000,
  "exp": 1700003600
}
```

Signed with **RS256** using your RSA-2048 private key. thirdweb verifies the signature using the public key served at `/.well-known/jwks.json`.

### Smart wallet

- **Type**: ERC-4337 smart account
- **Network**: Sepolia testnet
- **Personal wallet**: `inAppWallet` (thirdweb managed key, identified by JWT `sub`)
- **Gas**: sponsored via thirdweb bundler (`sponsorGas: true`)

---

## Build for production

```sh
# Frontend
bun run build
bun run start

# Backend
cd backend
bun run start
```

Update `FRONTEND_URL` in `backend/.env` and `NEXT_PUBLIC_BACKEND_URL` in `.env.local` to your production URLs. Update the JWKS URI in the thirdweb dashboard to your deployed backend URL.

---

## Resources

- [thirdweb Custom JWT Auth](https://portal.thirdweb.com/connect/in-app-wallet/custom-auth/custom-jwt-provider)
- [thirdweb Smart Wallet](https://portal.thirdweb.com/connect/account-abstraction/overview)
- [thirdweb TypeScript SDK v5](https://portal.thirdweb.com/typescript/v5)
- [Fastify](https://fastify.dev)
- [jose (JWT library)](https://github.com/panva/jose)
