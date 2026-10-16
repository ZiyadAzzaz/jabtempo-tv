"""Run the offline lab suite from a fresh checkout."""
import os
from pathlib import Path
import subprocess
import sys

if os.environ.get("CONDA_DEFAULT_ENV") != "amazon-tv":
    raise SystemExit("Activate amazon-tv before running project tests.")

Path(".cache").mkdir(exist_ok=True)
raise SystemExit(subprocess.call([
    sys.executable, "-m", "pytest",
    "scripts/test_eval_motion.py",
    "scripts/test_align_recording.py",
    "scripts/test_eval_voice.py",
    "scripts/test_camera_fixture.py",
    "-q", "-p", "no:cacheprovider", "--basetemp=.cache/pytest-lab",
]))
