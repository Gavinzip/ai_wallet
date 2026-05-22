import process from "node:process";

import {
  createRenaissHeadlessSession,
  printRenaissHeadlessSession,
} from "../server/renaiss-headless-auth.mjs";

try {
  const result = await createRenaissHeadlessSession();
  console.log(`BSC chain id: ${process.env.RENAISS_CHAIN_ID ?? 56}`);
  console.log(`Token Core wallet: ${result.session.signedWalletAddress}`);
  console.log(`Wallet source: ${result.session.walletSource}`);
  printRenaissHeadlessSession(result);
} catch (error) {
  console.error(error instanceof Error ? error.message : "RENAISS headless login failed.");
  process.exit(1);
}
