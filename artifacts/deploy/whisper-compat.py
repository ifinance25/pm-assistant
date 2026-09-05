#!/usr/bin/env python3
"""Обёртка: аргументы как у openai-whisper CLI, внутри whisper.cpp."""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import tempfile
from pathlib import Path


def offsets_to_seconds(value: object) -> float:
    try:
        return float(value) / 1000.0
    except (TypeError, ValueError):
        return 0.0


def cpp_json_to_openai(data: dict) -> dict:
    segments = []
    for item in data.get("transcription") or []:
        offsets = item.get("offsets") or {}
        segments.append(
            {
                "start": offsets_to_seconds(offsets.get("from")),
                "end": offsets_to_seconds(offsets.get("to")),
                "text": str(item.get("text") or "").strip(),
            }
        )
    if not segments and data.get("result", {}).get("text"):
        segments.append(
            {
                "start": 0.0,
                "end": None,
                "text": str(data["result"]["text"]).strip(),
            }
        )
    return {"segments": segments}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--output_format", default="json")
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--verbose", default="False")
    parser.add_argument("--language")
    args, _unknown = parser.parse_known_args()

    if args.output_format != "json":
        print("поддерживается только json", file=sys.stderr)
        return 2

    libdir = "/usr/local/lib"
    os.environ["LD_LIBRARY_PATH"] = libdir + os.pathsep + os.environ.get(
        "LD_LIBRARY_PATH", ""
    )

    model = os.environ.get(
        "WHISPER_MODEL", "/var/lib/pm-assistant/models/ggml-tiny.bin"
    )
    cli = os.environ.get("WHISPER_CLI", "/usr/local/bin/whisper-cli")
    audio = Path(args.audio)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not Path(cli).is_file():
        print(f"нет {cli}", file=sys.stderr)
        return 1
    if not Path(model).is_file():
        print(f"нет модели {model}", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="pm-whisper-") as tmp:
        wav = Path(tmp) / "input.wav"
        conv = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(audio),
                "-ar",
                "16000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(wav),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
        )
        if conv.returncode != 0:
            print(conv.stderr[-2000:], file=sys.stderr)
            return conv.returncode

        stem = Path(tmp) / "out"
        cmd = [cli, "-m", model, "-f", str(wav), "-oj", "-of", str(stem), "-pp"]
        if args.language:
            cmd.extend(["-l", args.language])
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        def stop(_signum=None, _frame=None) -> None:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    proc.kill()

        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                sys.stdout.write(line)
                sys.stdout.flush()
            run_code = proc.wait()
        finally:
            stop()
        if run_code != 0:
            return run_code

        raw_path = Path(str(stem) + ".json")
        data = json.loads(raw_path.read_text(encoding="utf-8"))
        openai = cpp_json_to_openai(data)
        dest = out_dir / f"{audio.stem}.json"
        dest.write_text(json.dumps(openai, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
