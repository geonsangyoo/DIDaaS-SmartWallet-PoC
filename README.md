# DIDaaS Smart Wallet PoC

A proof-of-concept for creating **ERC-4337 smart wallets** authenticated via **Google social login** using two thirdweb custom authentication strategies:

- **`jwt` (OIDC)** — frontend exchanges the Google ID token for a custom RS256 JWT; thirdweb verifies it against our JWKS endpoint.
- **`auth_endpoint`** — Google ID token is passed directly as the payload; thirdweb calls our backend to verify it and returns the user identity.

Uses the [thirdweb Growth plan](https://thirdweb.com/pricing).

---

## Features

- **Google Social Login** → thirdweb in-app wallet (EOA managed key)
- **Multi-Sig expense approval flow** — 3-of-3 Gnosis Safe on Sepolia (`/multisig`)
- **Gas sponsorship** — ERC-4337 UserOperations via thirdweb paymaster (no ETH required for execution)

---

## Architecture

### Strategy: `jwt` (OIDC)

```
┌─────────────────────────────────────────────────────────────────┐
│  Auth Flow — strategy: jwt                                      │
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
│   │          inAppWallet.connect({ strategy: "jwt", jwt })     │
│   │          thirdweb fetches /.well-known/jwks.json           │
│   │          thirdweb verifies RS256 JWT                       │
│   │          EOA wallet created (thirdweb managed key)         │
│   │<── EOA wallet address ──────────────────────              │
└─────────────────────────────────────────────────────────────────┘
```

### Strategy: `auth_endpoint` (Generic Auth)

```
┌─────────────────────────────────────────────────────────────────┐
│  Auth Flow — strategy: auth_endpoint                            │
│                                                                 │
│  User                  Frontend   ThirdWeb        Backend       │
│   │                      │           │               │          │
│   │─── Click Google ────>│           │               │          │
│   │<── Google ID token ──│           │               │          │
│   │     inAppWallet.connect({        │               │          │
│   │       strategy: "auth_endpoint", │               │          │
│   │       payload: googleIdToken })  │               │          │
│   │                      │──────────>│               │          │
│   │                      │           │─POST /auth/verify-payload>│
│   │                      │           │  { payload: googleIdToken }│
│   │                      │           │               │ Verify   │
│   │                      │           │               │ Google   │
│   │                      │           │               │ JWKS     │
│   │                      │           │<── { userId, email } ────│
│   │                      │           │               │          │
│   │          EOA wallet created (thirdweb managed key)          │
│   │<── EOA wallet address ────────────────────────────          │
└─────────────────────────────────────────────────────────────────┘
```

**Monorepo structure:**

```
DIDaaS-SmartWallet-PoC/
├── src/                    # Next.js frontend (thirdweb + Google OAuth)
│   └── app/
│       ├── page.tsx        # Google login + smart wallet UI
│       ├── multisig/       # 3-of-3 Gnosis Safe multi-sig PoC
│       │   ├── page.tsx
│       │   ├── useSafe.ts
│       │   ├── safe.ts
│       │   ├── config.ts
│       │   ├── types.ts
│       │   └── components/
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

## Multi-Sig Expense Approval (`/multisig`)

### Overview

A 3-of-3 Gnosis Safe on Sepolia models a company expense reimbursement workflow:

| Role | Japanese | Login method | Responsibility |
|---|---|---|---|
| ① 社員 (Employee) | 経費申請者 | Google (in-app wallet) | Submit expense request |
| ② 上長 (Manager) | 直属上司 | WalletConnect (e.g. Ambire) | First approval signature |
| ③ 経理担当 (Accounting) | 経理部門 | Google (in-app wallet) | Final approval signature |

**Gas sponsorship:** The "⚡ Execute On-Chain" step uses an ERC-4337 UserOperation routed through thirdweb's paymaster — no ETH required in the executor's wallet.

### Multi-Sig Transaction Sequence

```mermaid
sequenceDiagram
    actor Employee as ① 社員 (Employee)<br/>Google in-app wallet
    actor Manager as ② 上長 (Manager)<br/>WalletConnect / Ambire
    actor Accounting as ③ 経理担当 (Accounting)<br/>Google in-app wallet
    participant Safe as Gnosis Safe<br/>(3-of-3, Sepolia)
    participant Factory as SafeProxyFactory<br/>(Sepolia)
    participant TxService as Safe TX Service<br/>(api.safe.global)
    participant Paymaster as ThirdWeb Paymaster<br/>(ERC-4337 Bundler)
    participant Chain as Sepolia Chain

    Note over Employee,Chain: ── Pre-process: Collect EOA addresses (one-time per signer) ──
    Employee->>Employee: inAppWallet().connect({ strategy: "jwt" })
    Employee-->>Employee: EOA address → set NEXT_PUBLIC_EMPLOYEE_ADDRESS
    Manager->>Manager: WalletConnect / Ambire login
    Manager-->>Manager: EOA address → set NEXT_PUBLIC_ADMIN1_ADDRESS
    Accounting->>Accounting: inAppWallet().connect({ strategy: "jwt" })
    Accounting-->>Accounting: EOA address → set NEXT_PUBLIC_ADMIN2_ADDRESS

    Note over Employee,Chain: ── Pre-process: Deploy Gnosis Safe (one-time) ────────────────
    Employee->>Paymaster: handleDeploy()<br/>inAppWallet ERC-4337 UserOperation
    Paymaster->>Factory: createProxyWithNonce(<br/>  owners=[employee,manager,accounting],<br/>  threshold=3, saltNonce=0)
    Factory->>Chain: deploy SafeProxy contract
    Chain-->>Factory: Safe contract address
    Factory-->>Paymaster: tx receipt
    Paymaster-->>Employee: Safe deployed ✓ (gas sponsored)
    Employee->>TxService: Safe address registered automatically

    Note over Employee,Chain: ── Step ① : Propose expense reimbursement ────────────────────
    Employee->>Safe: safeClient.send({ to: employeeEOA, value })
    Safe->>TxService: POST /multisig-transactions (signed proposal)
    TxService-->>Employee: safeTxHash

    Note over Employee,Chain: ── Step ② : Manager approval ─────────────────────────────────
    Manager->>TxService: GET /multisig-transactions/{safeTxHash}
    TxService-->>Manager: pending tx details
    Manager->>Manager: protocolKit.signTransaction(tx) [raw ECDSA, EOA]
    Manager->>TxService: POST confirmTransaction(safeTxHash, signature)
    TxService-->>Manager: 200 OK (1/3 signatures collected)

    Note over Employee,Chain: ── Step ③ : Accounting approval ──────────────────────────────
    Accounting->>TxService: GET /multisig-transactions/{safeTxHash}
    TxService-->>Accounting: pending tx details
    Accounting->>Accounting: protocolKit.signTransaction(tx) [raw ECDSA, EOA]
    Accounting->>TxService: POST confirmTransaction(safeTxHash, signature)
    TxService-->>Accounting: 200 OK (2/3 signatures collected)

    Note over Employee,Chain: ── Step ③b: Employee final approval ──────────────────────────
    Employee->>TxService: GET /multisig-transactions/{safeTxHash}
    TxService-->>Employee: pending tx details
    Employee->>Employee: protocolKit.signTransaction(tx) [raw ECDSA, EOA]
    Employee->>TxService: POST confirmTransaction(safeTxHash, signature)
    TxService-->>Employee: 200 OK (3/3 signatures — threshold met ✓)

    Note over Employee,Chain: ── Execute On-Chain (gas sponsored) ──────────────────────────
    Employee->>Paymaster: inAppWallet ERC-4337 UserOperation<br/>safeClient.confirm({ safeTxHash })
    Paymaster->>Chain: execTransaction(to, value, data, signatures)
    Chain->>Safe: verify 3 owner signatures (ecrecover)
    Safe-->>Chain: ETH transfer to employee EOA
    Chain-->>Paymaster: tx receipt
    Paymaster-->>Employee: ethereumTxHash ✓
```

### Signature vs Execution — why they are separated

| Step | What happens | Gas paid by |
|---|---|---|
| Approve (② ③) | `signTransaction` + `apiKit.confirmTransaction` — signature posted to TX service **off-chain** | **Free** (no on-chain tx) |
| ⚡ Execute On-Chain | `safeClient.confirm()` on a fully-signed tx triggers `execTransaction` via **ERC-4337 UserOperation** | **ThirdWeb paymaster** |

> **Why not auto-execute on last approval?**
> The Safe SDK's `confirm()` must use the signer's EOA wallet client for Safe-compatible signatures (raw ECDSA). If execution is triggered from the same call, it also uses the EOA wallet — bypassing the ERC-4337 paymaster. Separating the steps lets execution go through `inAppWallet({ executionMode: { mode: "EIP4337", sponsorGas: true } })` so thirdweb pays the gas.

### Safe-Compatible Signatures

Gnosis Safe verifies owner signatures with `ecrecover` (raw ECDSA). ERC-4337 smart accounts wrap `signTypedData` in an EIP-1271 format — `ecrecover` would recover the wrong address and the Safe would reject the signature.

Therefore:
- **Signing** always uses `activeWallet` (raw EOA) — never the ERC-4337 smart account
- **Execution** uses `inAppWallet({ executionMode: { mode: "EIP4337", sponsorGas: true } })` via `autoConnect` — the executor does not need to be a Safe owner; only the collected EOA signatures are verified on-chain

### Setup — configure owner addresses

Each of the 3 roles must log in with their Google / WalletConnect account once.
Copy their shown wallet address into `.env.local`:

```env
NEXT_PUBLIC_EMPLOYEE_ADDRESS=0x...   # ① 社員  — Google in-app wallet
NEXT_PUBLIC_ADMIN1_ADDRESS=0x...     # ② 上長  — WalletConnect wallet
NEXT_PUBLIC_ADMIN2_ADDRESS=0x...     # ③ 経理担当 — Google in-app wallet

# Optional: pre-deployed Safe address (skip the Deploy step)
NEXT_PUBLIC_SAFE_ADDRESS=0x...

# Safe TX Service API key (required for POST operations on Sepolia)
NEXT_PUBLIC_SAFE_API_KEY=your-key
```

Get a free Safe API key at [developer.safe.global](https://developer.safe.global).

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

## Step 4 — Configure thirdweb dashboard

### 4a — Custom JWT (strategy: `jwt`)

1. Open [thirdweb Dashboard](https://thirdweb.com/dashboard) → your project → **In-App Wallet**.
2. Go to **Authentication** → enable **Custom JSON Web Token**.
3. Set the following:

| Field | Value |
|---|---|
| **JWKS URI** | `http://localhost:3001/.well-known/jwks.json` (dev) or your deployed backend URL |
| **AUD Value** | `didaas-smartwallet` (must match `JWT_AUDIENCE` in backend) |

4. Save.

### 4b — Auth Endpoint (strategy: `auth_endpoint`)

1. In the same **Authentication** tab, enable **Custom Auth Endpoint**.
2. Set the following:

| Field | Value |
|---|---|
| **Endpoint URL** | `http://localhost:3001/auth/verify-payload` (dev) or your deployed backend URL |

3. Optionally add secret **Headers** that the backend can check to authenticate the request from thirdweb.
4. Save.

> For production, deploy the backend and use its public URL for both endpoints.

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

# Multi-sig owner addresses (copy from /multisig page after first login)
NEXT_PUBLIC_EMPLOYEE_ADDRESS=0x...
NEXT_PUBLIC_ADMIN1_ADDRESS=0x...
NEXT_PUBLIC_ADMIN2_ADDRESS=0x...

# Optional: pre-deployed Safe address
NEXT_PUBLIC_SAFE_ADDRESS=0x...

# Safe TX Service API key
NEXT_PUBLIC_SAFE_API_KEY=your-key
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
| `GET` | `/.well-known/jwks.json` | Public JWKS — thirdweb calls this to verify custom JWTs (`jwt` strategy) |
| `POST` | `/auth/google` | Accepts `{ idToken }`, verifies via Google JWKS, returns `{ jwt }` (`jwt` strategy) |
| `POST` | `/auth/verify-payload` | Accepts `{ payload }` (Google ID token), verifies it, returns `{ userId, email }` (`auth_endpoint` strategy) |

### `jwt` strategy — JWT claims

The custom JWT issued by `/auth/google` contains:

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

### `auth_endpoint` strategy — verification response

`/auth/verify-payload` receives `{ payload: "<google-id-token>" }` posted by thirdweb and returns:

```json
{
  "userId": "<google-user-id>",
  "email": "user@example.com"
}
```

thirdweb uses `userId` (and optionally `email`) to bind the in-app wallet to the user.

### In-app wallet (signing)

- **Type**: plain `inAppWallet()` — thirdweb managed EOA key
- **Network**: Sepolia testnet
- **Address**: same EOA address every login (deterministic from Google `sub`)
- **Signing**: raw ECDSA — compatible with Gnosis Safe `ecrecover`

### Gas sponsorship (execution only)

- **Type**: `inAppWallet({ executionMode: { mode: "EIP4337", smartAccount: { chain, sponsorGas: true } } })`
- Activated via `autoConnect` in `handleExecute` — restores the existing in-app wallet session
- Routes `execTransaction` as a **UserOperation** through thirdweb's bundler + paymaster
- No ETH required in the in-app wallet EOA

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
- [thirdweb Account Abstraction / Gas Sponsorship](https://portal.thirdweb.com/wallets/sponsor-gas)
- [thirdweb TypeScript SDK v5](https://portal.thirdweb.com/typescript/v5)
- [Safe SDK Starter Kit](https://github.com/safe-global/safe-core-sdk/tree/main/packages/sdk-starter-kit)
- [Safe Transaction Service API](https://safe-transaction-sepolia.safe.global)
- [Fastify](https://fastify.dev)
- [jose (JWT library)](https://github.com/panva/jose)
