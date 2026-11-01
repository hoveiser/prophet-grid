export const CONTRACT_ADDRESS: `0x${string}` =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  "0x31C53838fF49168128D772625e34d3D2F7e11116";

export const EXPLORER_URL = `https://genlayer-explorer.vercel.app/contracts/${CONTRACT_ADDRESS}`;
export const REPO_URL = "https://github.com/hoveiser/prophet-grid";
export const RPC_URL = "https://studio.genlayer.com/api";
export const NETWORK_LABEL = "STUDIONET";
export const CHAIN_ID = 61999;
export const RELEASE_TAG = "milestone-v1";
export const RUNNER_PIN = "py-genlayer 1jb45aa8 ... 09h6";

export const GRID_STEP_BPS = 250;
export const FULL_SCALE_BPS = 10000;
export const FEE_BPS = 250;
export const REWARD_BPS = 2500;
export const MIN_DEPOSIT_WEI = 10 ** 15;
export const CHALLENGE_BOND_WEI = 10 ** 16;

export const DESK_SLOTS = ["ALPHA", "BRAVO", "CHARLIE"] as const;

export const BAND_LABEL: Record<string, string> = {
  YES_CONFIRMED_FINAL: "YES CONFIRMED",
  NO_CONFIRMED_FINAL: "NO CONFIRMED",
  CONDITIONAL_SCALAR_SPLIT: "SCALAR SPLIT",
  INVALID_OR_AMBIGUOUS_REFUND: "AMBIGUOUS REFUND",
  "": "AWAITING PRINT",
};

export const PHASE_LABEL: Record<string, string> = {
  PRE_CLOSE: "PRECLOSE",
  OPEN_WINDOW: "INTAKE",
  CHALLENGE_WINDOW: "CHALLENGE",
  REAUDIT_PENDING: "RE-AUDIT",
  READY_TO_FINALIZE: "SETTLABLE",
  SETTLED: "SETTLED",
};
