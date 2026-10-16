"""Run after conda activate amazon-tv; probe the installed local MCP over stdio."""
import json
from pathlib import Path
import queue
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parents[1]


def main():
    if Path(sys.prefix).name != "amazon-tv":
        raise RuntimeError("Activate amazon-tv")
    server = ROOT / "tools/amazon-builder/node_modules/@amazon-devices/amazon-devices-buildertools-mcp/dist/startserver"
    proc = subprocess.Popen([str(Path(sys.prefix) / "node.exe"), str(server)],
                            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
    messages = queue.Queue()

    def reader():
        for line in proc.stdout:
            try:
                messages.put(json.loads(line))
            except json.JSONDecodeError:
                pass

    threading.Thread(target=reader, daemon=True).start()

    def send(payload):
        proc.stdin.write(json.dumps({"jsonrpc": "2.0", **payload}) + "\n")
        proc.stdin.flush()

    def response(request_id):
        for _ in range(30):
            message = messages.get(timeout=15)
            if message.get("id") == request_id:
                if "error" in message:
                    raise RuntimeError(message["error"])
                return message["result"]
        raise TimeoutError("MCP response not received")

    try:
        send({"id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "jabtempo-local-setup-probe", "version": "0.1.0"}}})
        initialized = response(1)
        send({"method": "notifications/initialized"})
        send({"id": 2, "method": "tools/list", "params": {}})
        listed = response(2)
        artifact = {"serverInfo": initialized.get("serverInfo"),
                    "protocolVersion": initialized.get("protocolVersion"),
                    "tools": listed.get("tools", []),
                    "scope": "Local stdio handshake; does not verify this chat's MCP connection"}
        target = ROOT / "results/builder_tools_check.json"
        target.write_text(json.dumps(artifact, indent=2), encoding="utf-8")
        print(json.dumps({"server": artifact["serverInfo"],
                          "tools": [t["name"] for t in artifact["tools"]],
                          "artifact": str(target)}))
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


if __name__ == "__main__":
    main()
