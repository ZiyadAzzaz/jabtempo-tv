"""Summarize real capture-to-render instrumentation; never creates samples.

Rows require measuredSetup, capture, inferenceEnd, send, relay, receipt, render,
tvMinusPhoneMs, tvMinusRelayMs and syncAgeMs. Timestamps are monotonic milliseconds
in their named endpoint domains. Offsets convert each domain into TV time.
"""
import argparse
import json
import math
from pathlib import Path
from statistics import median

SETUPS = {"dev-cam", "phone-P1", "phone-P1-USB", "iphone-P1-LAN", "phone-P2", "emulator", "node-loopback"}


def durations(row):
    if row.get("measuredSetup") not in SETUPS:
        raise ValueError("missing/unsupported measuredSetup")
    keys = ("capture", "inferenceEnd", "send", "relay", "receipt", "render",
            "tvMinusPhoneMs", "tvMinusRelayMs", "syncAgeMs")
    if any(isinstance(row.get(k), bool) or not isinstance(row.get(k), (int, float))
           or not math.isfinite(row[k]) for k in keys):
        raise ValueError("missing/nonfinite timestamps or clock offsets")
    if not 0 <= row["syncAgeMs"] <= 10000:
        raise ValueError("clock sync stale")
    phone_offset, relay_offset = row["tvMinusPhoneMs"], row["tvMinusRelayMs"]
    stamps = [row["capture"] + phone_offset, row["inferenceEnd"] + phone_offset,
              row["send"] + phone_offset, row["relay"] + relay_offset,
              row["receipt"], row["render"]]
    if any(b < a for a, b in zip(stamps, stamps[1:])):
        raise ValueError("stages reverse after clock conversion")
    names = ("inferenceMs", "sendQueueMs", "phoneToRelayMs", "relayToTvMs", "renderQueueMs")
    result = dict(zip(names, (b - a for a, b in zip(stamps, stamps[1:]))))
    result["captureToRenderMs"] = stamps[-1] - stamps[0]
    return result


def summarize(path):
    groups = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
            sample = durations(row)
        except (ValueError, TypeError, KeyError) as error:
            raise ValueError(f"line {line_number}: {error}") from error
        groups.setdefault(row["measuredSetup"], []).append(sample)
    if not groups:
        raise ValueError("no measured rows; no summary generated")
    result = {"clockAssumption": "NTP offsets assume approximately symmetric paths", "setups": {}}
    for setup, samples in groups.items():
        stats = {}
        for key in samples[0]:
            values = sorted(s[key] for s in samples)
            stats[key] = {"median": median(values), "p95": values[math.ceil(len(values) * .95) - 1]}
        result["setups"][setup] = {"count": len(samples), "milliseconds": stats,
                                  "gatePass": False, "note": "Gate review needs real setup and device evidence"}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        output = json.dumps(summarize(args.input), indent=2) + "\n"
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
