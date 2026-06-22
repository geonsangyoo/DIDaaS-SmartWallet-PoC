import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  SignJWT,
  importPKCS8,
  exportJWK,
  importSPKI,
  createRemoteJWKSet,
  jwtVerify,
} from "jose";
import { getRemoteSignerAddress, getAssetOwnerAddress, fundKernel, executeViaRemoteSigner, type TransferCall } from "./zerodev-client";

const app = Fastify({ logger: true });

await app.register(cors, {
  // TODO: in production, set this to your actual frontend URL and not "*"
  origin: "*",
});

const privateKeyPem = process.env.PRIVATE_KEY_PEM;
const publicKeyPem = process.env.PUBLIC_KEY_PEM;
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const jwtAudience = process.env.JWT_AUDIENCE || "didaas-smartwallet";
const keyId = process.env.KEY_ID || "key-1";
const port = parseInt(process.env.PORT || "3001");

if (!privateKeyPem || !publicKeyPem) {
  throw new Error("PRIVATE_KEY_PEM and PUBLIC_KEY_PEM are required. Run: bun run generate-keys");
}
if (!googleClientId) {
  throw new Error("GOOGLE_CLIENT_ID is required");
}

// Load your RSA key pair
const privateKey = await importPKCS8(privateKeyPem.replace(/\\n/g, "\n"), "RS256");
const publicKey = await importSPKI(publicKeyPem.replace(/\\n/g, "\n"), "RS256", { extractable: true });
const publicKeyJwk = await exportJWK(publicKey);

// Used to verify the Google ID token before issuing our own JWT.
// timeoutDuration: 30 s (default 5 s is too short on slow connections).
// cacheMaxAge: 1 h  — Google rotates certs every few days, so 1 h is safe
//              and avoids a network round-trip on every auth request.
const googleJWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  { timeoutDuration: 30_000, cacheMaxAge: 3_600_000 }
);

// ── JWKS endpoint ─────────────────────────────────────────────────────────────
// thirdweb fetches this to verify the custom JWT we issue below.
// Configure in thirdweb dashboard → In-App Wallet → Custom JWT:
//   JWKS URI : http://localhost:3001/.well-known/jwks.json
//   AUD value: didaas-smartwallet  (must match JWT_AUDIENCE env var)
app.get("/.well-known/jwks.json", async (_req, reply) => {
  reply.header("Cache-Control", "public, max-age=3600");
  return {
    keys: [{ ...publicKeyJwk, kid: keyId, use: "sig", alg: "RS256" }],
  };
});

// ── Auth endpoint ─────────────────────────────────────────────────────────────
// 1. Receives the Google ID token from the frontend
// 2. Verifies it against Google's JWKS (proves the user is who they say)
// 3. Issues a NEW JWT signed with OUR private key
//    → thirdweb verifies this JWT against our JWKS above
app.post<{ Body: { idToken: string } }>(
  "/auth/google",
  {
    schema: {
      body: {
        type: "object",
        required: ["idToken"],
        properties: { idToken: { type: "string" } },
      },
    },
  },
  async (req, reply) => {
    const { idToken } = req.body;

    // Step 1: verify the Google ID token
    let googlePayload: { sub?: string; email?: string; name?: string; picture?: string };
    try {
      const { payload } = await jwtVerify(idToken, googleJWKS, {
        audience: googleClientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });
      googlePayload = payload as typeof googlePayload;
    } catch (err) {
      app.log.warn({ err }, "Google ID token verification failed");
      return reply.status(401).send({ error: "Invalid Google ID token" });
    }

    if (!googlePayload.sub) {
      return reply.status(401).send({ error: "Missing sub in Google token" });
    }

    // Step 2: issue a custom JWT signed with OUR private key
    //         thirdweb will verify this against our /.well-known/jwks.json
    const jwt = await new SignJWT({
      email: googlePayload.email,
      name: googlePayload.name,
      picture: googlePayload.picture,
    })
      .setProtectedHeader({ alg: "RS256", kid: keyId })
      .setSubject(googlePayload.sub)        // wallet identity = Google user ID
      .setAudience(jwtAudience)             // must match AUD Value in thirdweb dashboard
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    return { jwt };
  }
);

// ── Auth-endpoint verification ────────────────────────────────────────────────
// ThirdWeb calls this endpoint (strategy: "auth_endpoint") to verify the payload
// that the frontend passes via wallet.connect({ payload: "<google-id-token>" }).
//
// Configure in thirdweb dashboard → In-App Wallet → Custom Auth Endpoint:
//   Endpoint URL : http://localhost:3001/auth/verify-payload
//
// Request body : { payload: string }  — the raw Google ID token from the client
// Response body: { userId, email?, exp? }
app.post<{ Body: { payload: string } }>(
  "/auth/verify-payload",
  {
    schema: {
      body: {
        type: "object",
        required: ["payload"],
        properties: { payload: { type: "string" } },
      },
    },
  },
  async (req, reply) => {
    const { payload } = req.body;

    // The payload is the Google ID token sent directly from the client
    let googlePayload: { sub?: string; email?: string };
    try {
      const { payload: gPayload } = await jwtVerify(payload, googleJWKS, {
        audience: googleClientId,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });
      googlePayload = gPayload as typeof googlePayload;
    } catch (err) {
      app.log.warn({ err }, "auth_endpoint payload verification failed");
      return reply.status(401).send({ error: "Invalid payload" });
    }

    if (!googlePayload.sub) {
      return reply.status(401).send({ error: "Missing sub in token" });
    }

    // Return the userId (and optional email) that thirdweb uses to bind the wallet
    return {
      userId: googlePayload.sub,
      email: googlePayload.email,
    };
  }
);

// ── Session key store (in-memory for PoC) ─────────────────────────────────────
// Keyed by kernelAddress so AI agent can look up by target wallet.
type SessionKeyEntry = {
  serializedSessionKey: string;
  thirdwebSCWAddress?: string; // EOA address holding tokens (for transferFrom)
};
const sessionKeyStore = new Map<string, SessionKeyEntry>();

// ── Remote Signer: address endpoint ──────────────────────────────────────────
// Frontend fetches this so the Owner can grant a session key to the server EOA.
app.get("/remote-signer/address", async (_req, reply) => {
  try {
    const address = getRemoteSignerAddress();
    return { address };
  } catch (err) {
    app.log.warn({ err }, "remote signer not configured");
    return reply.status(503).send({ error: "REMOTE_SIGNER_PRIVATE_KEY not configured" });
  }
});

// ── Asset Owner: address endpoint ─────────────────────────────────────────────
// Exposes the ThirdWeb ERC-4337 smart wallet address for the asset owner (A).
app.get("/asset-owner/address", async (_req, reply) => {
  try {
    const address = await getAssetOwnerAddress();
    return { address };
  } catch (err) {
    app.log.warn({ err }, "asset owner not configured");
    return reply.status(503).send({ error: "ASSET_OWNER_PRIVATE_KEY or THIRDWEB_SECRET_KEY not configured" });
  }
});

// ── Session key registration ──────────────────────────────────────────────────
// Owner calls this after granting a session key to the remote signer.
// Body: { kernelAddress, serializedSessionKey, thirdwebSCWAddress? }
app.post<{
  Body: { kernelAddress: string; serializedSessionKey: string; thirdwebSCWAddress?: string };
}>(
  "/session-key/register",
  {
    schema: {
      body: {
        type: "object",
        required: ["kernelAddress", "serializedSessionKey"],
        properties: {
          kernelAddress: { type: "string" },
          serializedSessionKey: { type: "string" },
          thirdwebSCWAddress: { type: "string" },
        },
      },
    },
  },
  async (req, reply) => {
    const { kernelAddress, serializedSessionKey, thirdwebSCWAddress } = req.body;
    sessionKeyStore.set(kernelAddress.toLowerCase(), { serializedSessionKey, thirdwebSCWAddress });
    app.log.info({ kernelAddress }, "session key registered");
    return { ok: true };
  },
);

// ── AI Agent execute (Phase 2) ────────────────────────────────────────────────
// Single call that does both:
//   Step 1: A → B  — ASSET_OWNER_PRIVATE_KEY sends JPYC to the Kernel SCW
//   Step 2: B → C  — Remote signer executes transfer via session key UserOp
// Body: { kernelAddress, recipient, tokenAddress, amount, decimals? }
app.post<{
  Body: {
    kernelAddress: string;
    recipient: string;
    tokenAddress: string;
    amount: string;
    decimals?: number;
  };
}>(
  "/agent/execute",
  {
    schema: {
      body: {
        type: "object",
        required: ["kernelAddress", "recipient", "tokenAddress", "amount"],
        properties: {
          kernelAddress: { type: "string" },
          recipient: { type: "string" },
          tokenAddress: { type: "string" },
          amount: { type: "string" },
          decimals: { type: "number" },
        },
      },
    },
  },
  async (req, reply) => {
    const { kernelAddress, recipient, tokenAddress, amount, decimals = 18 } = req.body;

    const entry = sessionKeyStore.get(kernelAddress.toLowerCase());
    if (!entry) {
      return reply.status(404).send({ error: "Session key not registered for this kernel address" });
    }

    try {
      // Step 1: Fund kernel — A → B
      app.log.info({ kernelAddress, amount, tokenAddress }, "phase2 step1: funding kernel...");
      const fundTxHash = await fundKernel(
        kernelAddress as `0x${string}`,
        tokenAddress as `0x${string}`,
        amount,
        decimals,
      );
      app.log.info({ fundTxHash }, "phase2 step1: kernel funded");

      // Step 2: Session key transfer — B → C
      app.log.info({ kernelAddress, recipient }, "phase2 step2: executing transfer via session key...");
      const transferTxHash = await executeViaRemoteSigner(entry.serializedSessionKey, {
        kind: "erc20",
        tokenAddress: tokenAddress as `0x${string}`,
        recipient: recipient as `0x${string}`,
        amount,
        decimals,
      });
      app.log.info({ transferTxHash }, "phase2 step2: transfer complete");

      return { fundTxHash, transferTxHash };
    } catch (err) {
      app.log.error({ err, kernelAddress }, "agent execute failed");
      const msg = err instanceof Error ? err.message : "Execute failed";
      return reply.status(500).send({ error: msg });
    }
  },
);

// ── AI Agent transfer (legacy) ────────────────────────────────────────────────
// AI agent calls this to trigger a transfer via the stored session key.
// Body: { kernelAddress, recipient, tokenAddress?, amount, decimals?, source? }
//   tokenAddress: null/omitted = ETH native transfer
//   source: if set, uses transferFrom(source, recipient, amount) instead of transfer
app.post<{
  Body: {
    kernelAddress: string;
    recipient: string;
    tokenAddress?: string | null;
    amount: string;
    decimals?: number;
    source?: string | null;
  };
}>(
  "/agent/transfer",
  {
    schema: {
      body: {
        type: "object",
        required: ["kernelAddress", "recipient", "amount"],
        properties: {
          kernelAddress: { type: "string" },
          recipient: { type: "string" },
          tokenAddress: { type: "string", nullable: true },
          amount: { type: "string" },
          decimals: { type: "number" },
          source: { type: "string", nullable: true },
        },
      },
    },
  },
  async (req, reply) => {
    const { kernelAddress, recipient, tokenAddress, amount, decimals = 18, source } = req.body;

    const entry = sessionKeyStore.get(kernelAddress.toLowerCase());
    if (!entry) {
      return reply.status(404).send({ error: "Session key not registered for this kernel address" });
    }

    let transfer: TransferCall;
    const resolvedSource = source ?? entry.thirdwebSCWAddress;

    if (!tokenAddress) {
      transfer = { kind: "native", recipient: recipient as `0x${string}`, amount };
    } else if (resolvedSource) {
      transfer = {
        kind: "transferFrom",
        tokenAddress: tokenAddress as `0x${string}`,
        source: resolvedSource as `0x${string}`,
        recipient: recipient as `0x${string}`,
        amount,
        decimals,
      };
    } else {
      transfer = {
        kind: "erc20",
        tokenAddress: tokenAddress as `0x${string}`,
        recipient: recipient as `0x${string}`,
        amount,
        decimals,
      };
    }

    try {
      const txHash = await executeViaRemoteSigner(entry.serializedSessionKey, transfer);
      app.log.info({ kernelAddress, txHash }, "agent transfer executed");
      return { txHash };
    } catch (err) {
      app.log.error({ err, kernelAddress }, "agent transfer failed");
      const msg = err instanceof Error ? err.message : "Transfer failed";
      return reply.status(500).send({ error: msg });
    }
  },
);

// Initialize signers on startup
try {
  const addr = getRemoteSignerAddress();
  app.log.info({ address: addr }, "remote signer (D) ready");
} catch (err) {
  app.log.warn({ err }, "remote signer not configured");
}
try {
  const addr = await getAssetOwnerAddress();
  app.log.info({ address: addr }, "asset owner smart wallet (A) ready");
} catch (err) {
  app.log.warn({ err }, "asset owner not configured — check ASSET_OWNER_PRIVATE_KEY and THIRDWEB_SECRET_KEY");
}

await app.listen({ port, host: "0.0.0.0" });
