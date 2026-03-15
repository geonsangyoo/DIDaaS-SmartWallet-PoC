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

// Used to verify the Google ID token before issuing our own JWT
const googleJWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs")
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

await app.listen({ port, host: "0.0.0.0" });
