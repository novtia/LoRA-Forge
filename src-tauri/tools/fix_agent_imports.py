from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "src"
TARGETS = [
    ROOT / "ai",
    ROOT / "data",
    ROOT / "media",
    ROOT / "agent_error.rs",
]

for target in TARGETS:
    files = [target] if target.is_file() else target.rglob("*.rs")
    for file in files:
        text = file.read_text(encoding="utf-8")
        updated = text.replace("crate::error", "crate::agent_error")
        if updated != text:
            file.write_text(updated, encoding="utf-8")

paths = ROOT / "data" / "paths.rs"
paths_text = paths.read_text(encoding="utf-8")
paths_text = paths_text.replace('"atelier"', '"lora-agent"').replace(
    '"atelier.db"', '"agent.db"'
)
paths.write_text(paths_text, encoding="utf-8")
print("done")
