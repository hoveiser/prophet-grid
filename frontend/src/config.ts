export const CONTRACT_ADDRESS: `0x${string}` =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  "0xB0aeDBb6E8056c0a2c90E4BD901bB0f3DA6Bb967";

export const EXPLORER_URL = `https://genlayer-explorer.vercel.app/contracts/${CONTRACT_ADDRESS}`;
export const REPO_URL = "https://github.com/hoveiser/prophet-grid";
export const NETWORK_LABEL = "Studionet";
export const CHAIN_ID = 61999;
export const RUNNER_PIN = "py-genlayer:1jb45aa8...09h6";
export const CHALLENGE_WINDOW = 2;
export const CHALLENGE_BOND = 50;

export const BURNER_SLOTS = ["Alpha", "Bravo", "Charlie"] as const;
