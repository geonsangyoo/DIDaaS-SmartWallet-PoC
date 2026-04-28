// Diagnose the "admin" error reported on the failing smart account.
// Run: bun scripts/diagnose-session-key.ts

import { createThirdwebClient, getContract } from "thirdweb";
import { sepolia } from "thirdweb/chains";
import { isContractDeployed } from "thirdweb/utils";
import { getAllAdmins } from "thirdweb/extensions/erc4337";
import { getAllActiveSigners } from "thirdweb/extensions/erc4337";

const FAILING_ADDR = "0xF9f6DA51852df8C09B8E4a24a930a3D35EC571d8";
const CLIENT_ID =
  process.env.NEXT_PUBLIC_TEMPLATE_CLIENT_ID ||
  "fe0726da4aa5dbd1c32b628fd159379f";

const client = createThirdwebClient({ clientId: CLIENT_ID });

const contract = getContract({
  client,
  chain: sepolia,
  address: FAILING_ADDR,
});

const deployed = await isContractDeployed(contract);
console.log(`Deployed on Sepolia: ${deployed}`);

if (!deployed) {
  console.log(
    `→ Account is NOT deployed. setPermissionsForSigner reverts on a non-contract.`,
  );
  console.log(
    `   The bundler must lazy-deploy via the factory in the same UserOp.`,
  );
  process.exit(0);
}

try {
  const admins = await getAllAdmins({ contract });
  console.log(`On-chain admins (${admins.length}):`);
  admins.forEach((a) => console.log(`  - ${a}`));
} catch (e) {
  console.log(`getAllAdmins failed:`, (e as Error).message);
}

try {
  const signers = await getAllActiveSigners({ contract });
  console.log(`Active session signers: ${signers.length}`);
  for (const s of signers) {
    console.log(
      `  - ${s.signer}  end=${s.endTimestamp}  startedAt=${s.startTimestamp}`,
    );
  }
} catch (e) {
  console.log(`getAllActiveSigners failed:`, (e as Error).message);
}
