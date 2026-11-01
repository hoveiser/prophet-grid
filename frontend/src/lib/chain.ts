import { createAccount, createClient, chains, generatePrivateKey } from "genlayer-js";
import { CONTRACT_ADDRESS, RPC_URL } from "../config";

const { studionet } = chains;

export type TerminalClient = ReturnType<typeof createClient>;

export interface DeskHandle {
  client: TerminalClient;
  address: string;
  writable: boolean;
}

const SLOT_KEY = "prophetgrid.desk.slot";
const SLOT_SECRET = "prophetgrid.desk.secret";

export function deskSlot(): number {
  const stored = Number(window.localStorage.getItem(SLOT_KEY) ?? "0");
  return Number.isFinite(stored) ? Math.min(Math.max(0, Math.trunc(stored)), 2) : 0;
}

export function selectDeskSlot(slot: number): `0x${string}` {
  const clamped = Math.min(Math.max(0, Math.trunc(slot)), 2);
  window.localStorage.setItem(SLOT_KEY, String(clamped));
  const storageKey = `${SLOT_SECRET}.${clamped}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing && existing.startsWith("0x") && existing.length === 66) {
    return existing as `0x${string}`;
  }
  const fresh = generatePrivateKey();
  window.localStorage.setItem(storageKey, fresh);
  return fresh;
}

export function deskFromKey(key: `0x${string}`): DeskHandle {
  const account = createAccount(key);
  const client = createClient({ chain: studionet, account });
  return { client, address: account.address, writable: true };
}

export function watchDesk(address: string): DeskHandle {
  const client = createClient({ chain: studionet, account: address as `0x${string}` });
  return { client, address, writable: false };
}

export async function connectMetaMask(): Promise<DeskHandle> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No injected wallet found in this browser");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("The wallet returned no account");
  const client = createClient({ chain: studionet, account: accounts[0] as `0x${string}` });
  return { client, address: accounts[0], writable: true };
}

export async function readContract<T>(
  client: TerminalClient,
  functionName: string,
  args: unknown[] = [],
): Promise<T> {
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
  });
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as unknown as T;
}

export async function readScalar(client: TerminalClient, functionName: string, args: unknown[] = []) {
  return client.readContract({ address: CONTRACT_ADDRESS, functionName, args: args as never[] });
}

export interface TxOutcome {
  hash: string;
  execution: string | null;
  status: string | null;
}

export class TxReverted extends Error {
  readonly hash: string;
  readonly execution: string;

  constructor(hash: string, execution: string) {
    super(`on chain execution reported ${execution}`);
    this.name = "TxReverted";
    this.hash = hash;
    this.execution = execution;
  }
}

type HashArg = Parameters<TerminalClient["waitForTransactionReceipt"]>[0]["hash"];

export async function sendTransaction(
  client: TerminalClient,
  functionName: string,
  args: unknown[] = [],
  valueWei: bigint = 0n,
): Promise<TxOutcome> {
  const hash = (await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never[],
    value: valueWei,
  })) as unknown as HashArg;
  const receipt = (await client.waitForTransactionReceipt({
    hash,
    interval: 2500,
    retries: 140,
  })) as unknown as Record<string, unknown>;
  const execution =
    (receipt?.txExecutionResultName as string | undefined) ??
    (receipt?.tx_execution_result_name as string | undefined) ??
    null;
  const status =
    (receipt?.statusName as string | undefined) ?? (receipt?.status_name as string | undefined) ?? null;
  if (execution && execution.includes("ERROR")) {
    throw new TxReverted(String(hash), execution);
  }
  return { hash: String(hash), execution, status };
}

/** Custody proof: ask the chain node for the native balance of the contract. */
export async function nativeBalanceOfContract(): Promise<bigint | null> {
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [CONTRACT_ADDRESS, "latest"],
      }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { result?: string };
    if (!payload.result) return null;
    return BigInt(payload.result);
  } catch {
    return null;
  }
}

export function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const classified = text.match(/\[(EXPECTED|EXTERNAL|TRANSIENT|LLM_ERROR)\][^"'\n]*/);
  if (classified) return classified[0];
  return text.length > 260 ? `${text.slice(0, 260)}...` : text;
}
