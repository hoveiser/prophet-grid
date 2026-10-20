import { createAccount, createClient, chains, generatePrivateKey } from "genlayer-js";
import { CONTRACT_ADDRESS } from "../config";

const { studionet } = chains;

export type GenLayerClient = ReturnType<typeof createClient>;

export interface WalletHandle {
  client: GenLayerClient;
  address: string;
  account: unknown;
}

export function burnerKey(slot: number): `0x${string}` {
  const storageKey = `pg.burner.${slot}.key`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing && existing.startsWith("0x")) return existing as `0x${string}`;
  const fresh = generatePrivateKey();
  window.localStorage.setItem(storageKey, fresh);
  return fresh;
}

export function walletFromKey(key: `0x${string}`): WalletHandle {
  const account = createAccount(key);
  const client = createClient({ chain: studionet, account });
  return { client, address: account.address, account };
}

export function watchOnly(address: string): WalletHandle {
  const client = createClient({ chain: studionet, account: address as `0x${string}` });
  return { client, address, account: address };
}

export async function readJson<T>(client: GenLayerClient, functionName: string, args: unknown[] = []): Promise<T> {
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
  });
  if (typeof raw === "string") {
    return JSON.parse(raw) as T;
  }
  return raw as unknown as T;
}

export interface TxResult {
  hash: string;
  execution: string | null;
  status: string | null;
}

export class TxReverted extends Error {
  readonly hash: string;
  readonly execution: string;

  constructor(hash: string, execution: string) {
    super(`on-chain execution ${execution}`);
    this.name = "TxReverted";
    this.hash = hash;
    this.execution = execution;
  }
}

export async function writeTx(
  client: GenLayerClient,
  functionName: string,
  args: unknown[] = [],
): Promise<TxResult> {
  const hash = (await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
    value: 0n,
  })) as unknown as Parameters<GenLayerClient["waitForTransactionReceipt"]>[0]["hash"];
  const receipt = (await client.waitForTransactionReceipt({ hash, interval: 2500, retries: 120 })) as unknown as Record<string, unknown>;
  const execution =
    (receipt?.txExecutionResultName as string | undefined) ??
    (receipt?.tx_execution_result_name as string | undefined) ??
    null;
  const status = (receipt?.statusName as string | undefined) ?? (receipt?.status_name as string | undefined) ?? null;
  if (execution && execution.includes("ERROR")) {
    throw new TxReverted(String(hash), execution);
  }
  return { hash: String(hash), execution, status };
}

export function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const expected = text.match(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^"'\n]*/);
  if (expected) return expected[0];
  const revert = text.match(/revert[^"'\n]*/i);
  if (revert) return revert[0];
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
}

export async function connectMetaMask(): Promise<string> {
  if (!window.ethereum) {
    throw new Error("MetaMask is not installed in this browser");
  }
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error("MetaMask returned no account");
  }
  return accounts[0];
}
