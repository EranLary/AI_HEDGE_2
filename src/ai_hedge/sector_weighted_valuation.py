from __future__ import annotations

import copy
import math
import statistics
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping, MutableMapping, Sequence


MODEL_NAME = "Sector-Weighted Valuation"
POLICY_VERSION = "sector-weighted-v1"
CONSENSUS_COMPONENT_WEIGHTS = {"mean": 0.30, "median": 0.30, "sector_weighted": 0.40}
NOTIONAL = 100_000.0

FAMILIES = (
    "Scenario DCF",
    "Target Scenario",
    "Earnings Scenario",
    "Revenue Scenario",
    "Composite Scenario",
    "SOTP Scenario",
    "P/B Valuation",
    "Dream Team",
)

SECTOR_WEIGHTS: dict[str, tuple[int, ...]] = {
    "Technology": (20, 10, 15, 20, 20, 5, 0, 10),
    "Financial Services": (5, 10, 20, 0, 5, 10, 40, 10),
    "Industrials": (20, 10, 15, 10, 15, 15, 5, 10),
    "Healthcare": (15, 10, 10, 20, 15, 20, 0, 10),
    "Communication Services": (20, 10, 15, 15, 15, 15, 0, 10),
    "Consumer Cyclical": (15, 10, 20, 10, 25, 10, 0, 10),
    "Energy": (25, 10, 15, 5, 15, 20, 0, 10),
    "Consumer Defensive": (25, 10, 20, 10, 20, 5, 0, 10),
    "Basic Materials": (20, 10, 15, 5, 15, 15, 10, 10),
    "Real Estate": (10, 10, 5, 5, 5, 35, 20, 10),
    "Utilities": (25, 10, 10, 5, 10, 15, 15, 10),
}

PERSONAS = (
    "Warren Buffett",
    "Aswath Damodaran",
    "Charlie Munger",
    "Peter Lynch",
    "Peter Thiel",
    "Howard Marks",
    "Bill Ackman",
    "Cathie Wood",
    "Ray Dalio",
    "Stanley Druckenmiller",
)

DREAM_TEAM_WEIGHTS: dict[str, tuple[int, ...]] = {
    "Technology": (7, 15, 7, 7, 18, 4, 10, 18, 2, 12),
    "Financial Services": (16, 15, 12, 7, 5, 16, 12, 5, 7, 5),
    "Industrials": (10, 15, 10, 12, 12, 8, 8, 10, 4, 11),
    "Healthcare": (4, 16, 5, 10, 12, 4, 7, 20, 2, 20),
    "Communication Services": (6, 15, 6, 8, 19, 4, 12, 15, 2, 13),
    "Consumer Cyclical": (10, 15, 10, 17, 6, 6, 14, 9, 3, 10),
    "Energy": (12, 15, 7, 8, 3, 16, 7, 3, 12, 17),
    "Consumer Defensive": (22, 15, 16, 15, 0, 9, 15, 0, 3, 5),
    "Basic Materials": (7, 15, 7, 10, 2, 18, 5, 0, 13, 23),
    "Real Estate": (8, 15, 8, 8, 0, 20, 20, 0, 9, 12),
    "Utilities": (18, 15, 10, 7, 2, 15, 7, 8, 11, 7),
}

FAMILY_ALIASES: dict[str, tuple[str, ...]] = {
    "Scenario DCF": ("Scenario DCF", "DCF", "Intrinsic DCF"),
    "Target Scenario": ("Target Scenario", "BBB Target"),
    "Earnings Scenario": ("Earnings Scenario", "Net Income & P/E", "BBB NI & P/E", "Earnings Multiple"),
    "Revenue Scenario": ("Revenue Scenario", "Revenue & EV/S", "Revenue Multiple"),
    "Composite Scenario": ("Composite Scenario", "Lary's Logic", "Lary’s Logic", "Composite Logic"),
    "SOTP Scenario": ("SOTP Scenario", "SOTP"),
    "P/B Valuation": ("P/B Valuation", "Price-to-Book", "Price to Book", "P/B"),
    "Dream Team": ("Dream Team",),
}


def _key(value: Any) -> str:
    return " ".join(str(value or "").replace("’", "'").strip().lower().split())


_FAMILY_BY_ALIAS = {_key(alias): family for family, aliases in FAMILY_ALIASES.items() for alias in aliases}
_PERSONA_BY_ALIAS = {_key(persona): persona for persona in PERSONAS}
_SECTOR_BY_KEY = {_key(sector): sector for sector in SECTOR_WEIGHTS}


def canonical_sector(value: Any) -> str | None:
    return _SECTOR_BY_KEY.get(_key(value))


def canonical_family(value: Any) -> str | None:
    return _FAMILY_BY_ALIAS.get(_key(value))


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _positive(value: Any) -> float | None:
    number = _finite(value)
    return number if number is not None and number > 0 else None


def _allocation(value: Any) -> float | None:
    number = _finite(value)
    return number if number is not None and -NOTIONAL <= number <= NOTIONAL else None


def _weighted(values: Mapping[str, float], configured: Mapping[str, float]) -> tuple[float | None, dict[str, float]]:
    eligible = {name: configured[name] for name in values if configured.get(name, 0) > 0}
    denominator = sum(eligible.values())
    if denominator <= 0:
        return None, {}
    effective = {name: weight / denominator for name, weight in eligible.items()}
    return sum(values[name] * effective[name] for name in effective), effective


def validate_policy() -> None:
    if set(SECTOR_WEIGHTS) != set(DREAM_TEAM_WEIGHTS):
        raise ValueError("Sector and Dream Team matrices must cover the same sectors")
    for sector, row in SECTOR_WEIGHTS.items():
        if len(row) != len(FAMILIES) or sum(row) != 100:
            raise ValueError(f"Invalid family weights for {sector}")
        if row[FAMILIES.index("Target Scenario")] != 10 or row[FAMILIES.index("Dream Team")] != 10:
            raise ValueError(f"Fixed family envelopes changed for {sector}")
    for sector, row in DREAM_TEAM_WEIGHTS.items():
        if len(row) != len(PERSONAS) or sum(row) != 100:
            raise ValueError(f"Invalid Dream Team weights for {sector}")


validate_policy()


def compute_sector_weighted(
    *,
    sector: str,
    observations: Sequence[Mapping[str, Any]],
    dream_outputs: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any] | None:
    """Compute a sector view from canonical or legacy model observations.

    Duplicate aliases are averaged inside their canonical family. Missing or
    invalid families are omitted and the remaining configured weights are
    renormalized proportionally.
    """

    normalized_sector = canonical_sector(sector)
    if normalized_sector is None:
        return None
    family_config = dict(zip(FAMILIES, (weight / 100.0 for weight in SECTOR_WEIGHTS[normalized_sector])))
    target_samples: dict[str, list[float]] = {family: [] for family in FAMILIES}
    allocation_samples: dict[str, list[float]] = {family: [] for family in FAMILIES}
    aliases: dict[str, list[str]] = {family: [] for family in FAMILIES}
    for item in observations:
        family = canonical_family(item.get("name"))
        if family is None or family == "Dream Team":
            continue
        target = _positive(item.get("target"))
        if target is None:
            continue
        target_samples[family].append(target)
        alias = str(item.get("name") or "").strip()
        if alias and alias not in aliases[family]:
            aliases[family].append(alias)
        allocation = _allocation(item.get("allocation"))
        if allocation is not None:
            allocation_samples[family].append(allocation)

    persona_config = dict(zip(PERSONAS, (weight / 100.0 for weight in DREAM_TEAM_WEIGHTS[normalized_sector])))
    persona_targets: dict[str, list[float]] = {persona: [] for persona in PERSONAS}
    persona_allocations: dict[str, list[float]] = {persona: [] for persona in PERSONAS}
    for item in dream_outputs:
        persona = _PERSONA_BY_ALIAS.get(_key(item.get("persona")))
        target = _positive(item.get("target"))
        if persona is None or target is None:
            continue
        persona_targets[persona].append(target)
        allocation = _allocation(item.get("allocation"))
        if allocation is not None:
            persona_allocations[persona].append(allocation)

    dream_targets = {name: statistics.fmean(values) for name, values in persona_targets.items() if values}
    dream_target, dream_target_effective = _weighted(dream_targets, persona_config)
    dream_alloc_values = {
        name: statistics.fmean(persona_allocations[name])
        for name in dream_targets
        if persona_allocations[name]
    }
    dream_allocation, dream_allocation_effective = _weighted(dream_alloc_values, persona_config)
    if dream_target is not None:
        target_samples["Dream Team"] = [dream_target]
        aliases["Dream Team"] = ["Dream Team"]
    if dream_allocation is not None:
        allocation_samples["Dream Team"] = [dream_allocation]

    family_targets = {name: statistics.fmean(values) for name, values in target_samples.items() if values}
    target, target_effective = _weighted(family_targets, family_config)
    if target is None:
        return None
    family_allocations = {
        name: statistics.fmean(allocation_samples[name])
        for name in family_targets
        if allocation_samples[name]
    }
    allocation, allocation_effective = _weighted(family_allocations, family_config)

    family_breakdown = []
    for family in FAMILIES:
        family_breakdown.append(
            {
                "family": family,
                "configured_weight": family_config[family],
                "effective_target_weight": target_effective.get(family),
                "effective_allocation_weight": allocation_effective.get(family),
                "target_price": family_targets.get(family),
                "investment_amount": family_allocations.get(family),
                "aliases": aliases[family],
                "status": "included" if family in family_targets and family_config[family] > 0 else "zero_weight" if family_config[family] == 0 else "missing",
            }
        )
    dream_breakdown = [
        {
            "persona": persona,
            "configured_weight": persona_config[persona],
            "effective_target_weight": dream_target_effective.get(persona),
            "effective_allocation_weight": dream_allocation_effective.get(persona),
            "target_price": dream_targets.get(persona),
            "investment_amount": dream_alloc_values.get(persona),
            "status": "included" if persona in dream_targets and persona_config[persona] > 0 else "zero_weight" if persona_config[persona] == 0 else "missing",
        }
        for persona in PERSONAS
    ]
    return {
        "name": MODEL_NAME,
        "policy_version": POLICY_VERSION,
        "sector": normalized_sector,
        "target_price": target,
        "investment_amount": allocation,
        "investment_pct": (allocation / NOTIONAL * 100.0) if allocation is not None else None,
        "family_weights": family_breakdown,
        "dream_team": {
            "target_price": dream_target,
            "investment_amount": dream_allocation,
            "personas": dream_breakdown,
        },
    }


def _component_blend(values: Mapping[str, float | None]) -> tuple[float | None, dict[str, float]]:
    valid = {name: value for name, value in values.items() if _finite(value) is not None}
    return _weighted(valid, CONSENSUS_COMPONENT_WEIGHTS)


def _method_observations(dashboard: Mapping[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    hub = dashboard.get("valuation_hub") if isinstance(dashboard.get("valuation_hub"), Mapping) else {}
    tabs = hub.get("method_tabs") if isinstance(hub.get("method_tabs"), list) else []
    blocks = hub.get("method_blocks") if isinstance(hub.get("method_blocks"), list) else []
    observations: list[dict[str, Any]] = []
    dreams: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    for tab in tabs:
        if not isinstance(tab, Mapping) or _key(tab.get("name")) == _key(MODEL_NAME):
            continue
        name = str(tab.get("name") or "")
        seen_names.add(_key(name))
        observations.append({"name": name, "target": tab.get("target_price"), "allocation": tab.get("investment_amount")})
        if canonical_family(name) == "Dream Team":
            for output in tab.get("outputs") if isinstance(tab.get("outputs"), list) else []:
                if isinstance(output, Mapping):
                    dreams.append({"persona": output.get("persona"), "target": output.get("target_price"), "allocation": output.get("investment_amount")})
    for block in blocks:
        if not isinstance(block, Mapping) or _key(block.get("name")) in seen_names or _key(block.get("name")) == _key(MODEL_NAME):
            continue
        observations.append({"name": block.get("name"), "target": block.get("target_price"), "allocation": block.get("investment_amount")})
    return observations, dreams


def _median_original_targets(observations: Iterable[Mapping[str, Any]]) -> float | None:
    values = [_positive(item.get("target")) for item in observations if canonical_family(item.get("name"))]
    valid = [value for value in values if value is not None]
    return statistics.median(valid) if len(valid) >= 2 else None


def _original_allocations(observations: Iterable[Mapping[str, Any]]) -> list[float]:
    values = [
        _allocation(item.get("allocation"))
        for item in observations
        if canonical_family(item.get("name")) and _positive(item.get("target")) is not None
    ]
    return [value for value in values if value is not None]


def apply_to_dashboard(
    dashboard: Mapping[str, Any],
    *,
    sector: str,
    sector_source: str,
    provenance: str,
    computed_at: str | None = None,
) -> dict[str, Any]:
    """Return a dashboard copy with the derived model and 30/30/40 consensus."""

    result = copy.deepcopy(dict(dashboard))
    observations, dreams = _method_observations(result)
    weighted = compute_sector_weighted(sector=sector, observations=observations, dream_outputs=dreams)
    if weighted is None:
        return result
    now = computed_at or datetime.now(timezone.utc).isoformat()
    previous_hub = result.get("valuation_hub") if isinstance(result.get("valuation_hub"), Mapping) else {}
    previous_weighted = previous_hub.get("sector_weighted_valuation") if isinstance(previous_hub.get("sector_weighted_valuation"), Mapping) else {}
    previous_consensus = previous_hub.get("consensus") if isinstance(previous_hub.get("consensus"), Mapping) else {}
    previous_card = result.get("score_card") if isinstance(result.get("score_card"), Mapping) else {}
    weighted.update({"sector_source": sector_source, "provenance": provenance, "computed_at": now})
    if provenance == "backfill":
        weighted["backfill_metadata"] = {
            "policy_version": POLICY_VERSION,
            "applied_at": now,
            "original_snapshot": copy.deepcopy(
                (previous_weighted.get("backfill_metadata") or {}).get("original_snapshot")
                if isinstance(previous_weighted.get("backfill_metadata"), Mapping)
                else None
            )
            or {
                "decision_target_price": previous_consensus.get("decision_target_price"),
                "consensus_basis": previous_consensus.get("consensus_basis"),
                "position_size_pct_of_notional": previous_card.get("position_size_pct_of_notional"),
                "adjusted_score": previous_card.get("adjusted_score"),
            },
        }
    hub = result.setdefault("valuation_hub", {})
    consensus = hub.setdefault("consensus", {})
    current = _positive(consensus.get("current_price")) or _positive((result.get("header") or {}).get("current_price"))
    mean = _positive(consensus.get("mean_target_price"))
    median = _positive(consensus.get("median_target_price"))
    if median is None:
        median = _median_original_targets(observations)
        consensus["median_target_price"] = median
    sector_target = weighted["target_price"]
    decision_target, target_component_weights = _component_blend(
        {"mean": mean, "median": median, "sector_weighted": sector_target}
    )

    card = result.setdefault("score_card", {})
    mean_allocation = _allocation(card.get("mean_investment_amount_raw"))
    if mean_allocation is None:
        mean_allocation = _allocation(card.get("mean_investment_amount"))
    median_allocation = _allocation(card.get("median_investment_amount"))
    original_allocations = _original_allocations(observations)
    if mean_allocation is None and original_allocations:
        mean_allocation = statistics.fmean(original_allocations)
    if median_allocation is None and len(original_allocations) >= 2:
        median_allocation = statistics.median(original_allocations)
    sector_allocation = _allocation(weighted.get("investment_amount"))
    decision_allocation, allocation_component_weights = _component_blend(
        {"mean": mean_allocation, "median": median_allocation, "sector_weighted": sector_allocation}
    )

    def score(target: float | None, allocation: float | None) -> float | None:
        if target is None or allocation is None:
            return None
        target_return = ((target - current) / current * 100.0) if target is not None and current else None
        allocation_pct = (allocation / NOTIONAL * 100.0) if allocation is not None else None
        if target_return is None and allocation_pct is None:
            return None
        return 0.6 * (target_return or 0.0) + 0.4 * (allocation_pct or 0.0)

    scores = {
        "mean": score(mean, mean_allocation),
        "median": score(median, median_allocation),
        "sector_weighted": score(sector_target, sector_allocation),
    }
    combined_score, score_component_weights = _component_blend(scores)
    confidence_factor = _finite(card.get("confidence_factor"))
    if confidence_factor is None:
        confidence_factor = 1.0
    basis_parts = [name for name in ("mean", "median", "sector_weighted") if target_component_weights.get(name) is not None]
    basis = "_".join(basis_parts) if basis_parts else "sector_weighted_only"

    block = {
        "name": MODEL_NAME,
        "target_price": sector_target,
        "upside_pct": ((sector_target - current) / current * 100.0) if current else None,
        "investment_amount": sector_allocation,
        "investment_pct": weighted.get("investment_pct"),
        "key_metric_means": {},
        "sample_rationale": f"Sector-specific {POLICY_VERSION} weighting for {weighted['sector']}.",
    }
    tab = {
        "name": MODEL_NAME,
        "target_price": sector_target,
        "investment_amount": sector_allocation,
        "key_metric_means": {},
        "outputs": [],
        "weight_breakdown": weighted["family_weights"],
        "policy_version": POLICY_VERSION,
        "sector": weighted["sector"],
    }
    hub["method_blocks"] = [item for item in hub.get("method_blocks", []) if isinstance(item, Mapping) and _key(item.get("name")) != _key(MODEL_NAME)] + [block]
    hub["method_tabs"] = [item for item in hub.get("method_tabs", []) if isinstance(item, Mapping) and _key(item.get("name")) != _key(MODEL_NAME)] + [tab]
    hub["sector_weighted_valuation"] = weighted
    consensus.update(
        {
            "sector_weighted_target_price": sector_target,
            "decision_target_price": decision_target,
            "component_weights": target_component_weights,
            "configured_component_weights": CONSENSUS_COMPONENT_WEIGHTS.copy(),
            "consensus_basis": basis,
        }
    )
    sector_return = ((sector_target - current) / current * 100.0) if current else None
    card.update(
        {
            "position_size_pct_of_notional": (decision_allocation / NOTIONAL * 100.0) if decision_allocation is not None else 0.0,
            "decision_investment_amount": decision_allocation,
            "mean_investment_amount": decision_allocation,
            "mean_investment_amount_raw": mean_allocation,
            "median_investment_amount": median_allocation,
            "sector_weighted_investment_amount": sector_allocation,
            "sector_weighted_target_return_pct": sector_return,
            "sector_weighted_score": scores["sector_weighted"],
            "target_return_pct": ((decision_target - current) / current * 100.0) if decision_target is not None and current else None,
            "combined_score": combined_score,
            "adjusted_score": (combined_score * confidence_factor) if combined_score is not None else None,
            "component_weights": score_component_weights,
            "allocation_component_weights": allocation_component_weights,
            "configured_component_weights": CONSENSUS_COMPONENT_WEIGHTS.copy(),
            "consensus_basis": basis,
            "rationale": "Mean, Median, and Sector-Weighted scores blend 40% allocation with 60% target return, then use 30%/30%/40% consensus weights and the existing disagreement confidence factor.",
        }
    )
    return result


def augment_runtime_outputs(
    *,
    final_dict: MutableMapping[str, Any],
    explain_payload: MutableMapping[str, Any],
    sector: str,
) -> dict[str, Any] | None:
    observations = [
        {"name": name, "target": target, "allocation": (explain_payload.get("aggregate_investments") or {}).get(name)}
        for name, target in (explain_payload.get("aggregate_targets") or {}).items()
        if name != MODEL_NAME
    ]
    dreams = []
    for item in (explain_payload.get("methods") or {}).get("Dream Team", []):
        if isinstance(item, Mapping):
            dreams.append({"persona": item.get("persona"), "target": item.get("target_price"), "allocation": item.get("investment_amount")})
    weighted = compute_sector_weighted(sector=sector, observations=observations, dream_outputs=dreams)
    if weighted is None:
        return None
    target = float(weighted["target_price"])
    allocation = _allocation(weighted.get("investment_amount"))
    explain_payload.setdefault("aggregate_targets", {})[MODEL_NAME] = target
    explain_payload.setdefault("aggregate_investments", {})[MODEL_NAME] = allocation
    explain_payload.setdefault("aggregate_investment_percents", {})[MODEL_NAME] = weighted.get("investment_pct")
    explain_payload["sector_weighted_valuation"] = weighted
    prices = final_dict.setdefault("Prices", {})
    price_scale = 1.0
    for observation in observations:
        raw_target = _positive(observation.get("target"))
        displayed = prices.get(str(observation.get("name") or ""))
        displayed_target = _positive(displayed[0]) if isinstance(displayed, (list, tuple)) and displayed else None
        if raw_target is not None and displayed_target is not None:
            price_scale = displayed_target / raw_target
            break
    displayed_target = target * price_scale
    prices[MODEL_NAME] = [displayed_target, displayed_target, displayed_target]
    prices.setdefault("Investment Percents", {})[MODEL_NAME] = weighted.get("investment_pct")
    return weighted
