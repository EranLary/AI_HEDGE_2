from pathlib import Path
import re
import tomllib


ROOT = Path(__file__).resolve().parents[1]


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


def test_documentation_index_links_resolve() -> None:
    index_path = ROOT / "docs" / "README.md"
    markdown = index_path.read_text(encoding="utf-8")
    relative_links = re.findall(r"\[[^]]+\]\(([^):#]+)\)", markdown)

    missing = [link for link in relative_links if not (index_path.parent / link).exists()]
    assert missing == []
