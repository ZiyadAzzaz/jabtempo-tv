"""Run after: conda activate amazon-tv. Download the verified official G0 installer."""
import hashlib
from pathlib import Path
import sys
import time
import urllib.request

URL = "https://edgedl.me.gvt1.com/android/studio/install/2026.2.1.8/android-studio-rabbit1-windows.exe"
SHA256 = "4c26f92e0e78adb1381c9a76597dbd5f6bce13d2ff2bf88cd2b57d425d685f3d"
ROOT = Path(__file__).resolve().parents[1]


def main():
    if Path(sys.prefix).name != "amazon-tv":
        raise RuntimeError("Activate amazon-tv before downloading project tooling")
    target = ROOT / ".cache" / "installers" / "android-studio-2026.2.1.8.exe"
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".partial")
    if target.exists():
        with target.open('rb') as existing:
            if hashlib.file_digest(existing, 'sha256').hexdigest() == SHA256:
                print(f"Already verified: {target}", flush=True)
                return
    start = time.monotonic()
    size = partial.stat().st_size if partial.exists() else 0
    headers = {"Range": f"bytes={size}-"} if size else {}
    last_report = start
    request = urllib.request.Request(URL, headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        if size and response.status == 206:
            if not response.headers.get('Content-Range', '').startswith(f'bytes {size}-'):
                raise ValueError('Unexpected resume range; no partial file modified')
        elif size:
            size = 0  # Server ignored Range; safely restart the partial download.
        expected_size = size + int(response.headers.get("Content-Length", 0))
        print(f"Official Google installer: {expected_size} bytes; resume at {size}", flush=True)
        with partial.open("ab" if size else "wb") as out:
            while chunk := response.read(1024 * 1024):
                if time.monotonic() - start > 300:
                    print('Five-minute download budget reached. Rerun to resume; nothing executed.', flush=True)
                    return
                out.write(chunk)
                size += len(chunk)
                if time.monotonic() - last_report >= 15:
                    print(f"Downloaded {size // (1024 * 1024)} MiB", flush=True)
                    last_report = time.monotonic()
    if expected_size and size != expected_size:
        raise ValueError("Installer length mismatch")
    with partial.open('rb') as downloaded:
        if hashlib.file_digest(downloaded, 'sha256').hexdigest() != SHA256:
            raise ValueError("Installer checksum mismatch; do not execute")
    partial.replace(target)
    print(f"SHA256 verified: {target}", flush=True)


if __name__ == "__main__":
    main()
