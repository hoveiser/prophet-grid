"""Print the live state of every recorded market."""

import json
import os
from pathlib import Path

from dotenv import load_dotenv
from genlayer_py import create_account, create_client, studionet

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
key = os.environ["GENLAYER_PRIVATE_KEY"]
if not key.startswith("0x"):
    key = "0x" + key
client = create_client(chain=studionet, account=create_account(key))
checkpoint = json.load(open(ROOT / "evidence" / "_checkpoint.json"))
address = checkpoint["contract_address"]


def read(fn, args=None):
    value = client.read_contract(address=address, function_name=fn, args=args or [])
    return json.loads(value)


print(json.dumps(read("get_platform_stats"), indent=2))
count = int(client.read_contract(address=address, function_name="get_market_count", args=[]))
for market_id in range(1, count + 1):
    state = read("get_market", [market_id])
    print(
        json.dumps(
            {
                "id": state["market_id"],
                "status": state["status"],
                "phase": state["phase"],
                "outcome": state["provisional_outcome"],
                "resolved_at": state["resolved_at_step"],
                "deadline": state["challenge_deadline_step"],
                "clock": state["clock_step"],
                "settlement_ready": state["settlement_ready"],
                "claim_block_reason": state["claim_block_reason"],
                "total_pot": state["total_pot"],
                "question": state["question"][:60],
            }
        )
    )
print(json.dumps(read("check_vault_invariants"), indent=2))
