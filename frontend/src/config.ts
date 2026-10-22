export const CONTRACT_ADDRESS: `0x${string}` =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  "0x5d7776fc51b76DF271f232A56e2E76F3e2d0fcE8";

export const EXPLORER_URL = `https://genlayer-explorer.vercel.app/contracts/${CONTRACT_ADDRESS}`;
export const REPO_URL = "https://github.com/hoveiser/prophet-grid";
export const NETWORK_LABEL = "Studionet";
export const CHAIN_ID = 61999;
export const RUNNER_PIN = "py-genlayer:1jb45aa8...09h6";
export const EPOCH_SECONDS = 60;
export const CHALLENGE_WINDOW_EPOCHS = 10;
export const RESOLUTION_GRACE_EPOCHS = 24;
export const CHALLENGE_BOND = 50;

export const BURNER_SLOTS = ["Alpha", "Bravo", "Charlie"] as const;
