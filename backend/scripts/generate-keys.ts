/**
 * One-time script to generate an RSA key pair for JWT signing.
 * Run: bun run generate-keys
 *
 * Copy the output into your backend/.env file.
 */
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
import { randomUUID } from "crypto";

const { privateKey, publicKey } = await generateKeyPair("RS256", {
  modulusLength: 2048,
  extractable: true,
});

const privateKeyPem = await exportPKCS8(privateKey);
const publicKeyPem = await exportSPKI(publicKey);
const keyId = randomUUID();

// Inline the PEM newlines so they fit on a single .env line
const inlinePrivate = privateKeyPem.replace(/\n/g, "\\n");
const inlinePublic = publicKeyPem.replace(/\n/g, "\\n");

console.log("# Copy the following lines into backend/.env\n");
console.log(`PRIVATE_KEY_PEM="${inlinePrivate}"`);
console.log(`PUBLIC_KEY_PEM="${inlinePublic}"`);
console.log(`KEY_ID="${keyId}"`);
