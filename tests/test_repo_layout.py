from pathlib import Path
import re
import tomllib


ROOT = Path(__file__).resolve().parents[1]


def _missing_local_markdown_links(path: Path) -> list[str]:
    markdown = path.read_text(encoding="utf-8")
    relative_links = re.findall(r"\[[^]]+\]\(([^):#]+)\)", markdown)
    return [link for link in relative_links if not (path.parent / link).exists()]


def test_fly_release_command_points_to_database_migrator() -> None:
    config = tomllib.loads((ROOT / "fly.site.toml").read_text(encoding="utf-8"))

    assert config["deploy"]["release_command"] == "python3 /app/scripts/db/migrate.py"
    assert (ROOT / "scripts" / "db" / "migrate.py").is_file()


def test_root_has_no_relocated_operator_helpers() -> None:
    old_paths = (
        "dbcli.py",
        "deploy_fly.ps1",
        "deploy-obs.ps1",
        "deploy-site.ps1",
        "deploy-site.cmd",
        "push-git.ps1",
        "push-git.cmd",
        "DNS_SETUP.md",
    )

    assert not [path for path in old_paths if (ROOT / path).exists()]


def test_onboarding_document_links_resolve() -> None:
    documents = (
        ROOT / "AGENTS.md",
        ROOT / "CLAUDE.md",
        ROOT / "README.md",
        ROOT / "docs" / "README.md",
        ROOT / "scripts" / "README.md",
    )

    missing = {}
    for path in documents:
        broken_links = _missing_local_markdown_links(path)
        if broken_links:
            missing[str(path.relative_to(ROOT))] = broken_links
    assert missing == {}


def test_onboarding_docs_cover_active_runtime_boundaries() -> None:
    onboarding = "\n".join(
        (ROOT / name).read_text(encoding="utf-8")
        for name in ("AGENTS.md", "CLAUDE.md", "README.md")
    )

    for active_path in (
        "src/ai_hedge/",
        "frontend/",
        "frontend-obs/",
        "scripts/nasdaq_worker_server.py",
        "trading_executor/",
    ):
        assert active_path in onboarding
