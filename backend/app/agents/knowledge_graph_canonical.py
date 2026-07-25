"""Deterministic anchoring and canonicalization for the versioned KG document."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import Counter, defaultdict
from statistics import mean
from typing import Any, Iterable

from backend.app.agents.knowledge_graph_models import (
    SCHEMA_VERSION,
    BuildMetadata,
    CanonicalEntity,
    EntityFacet,
    EntitySignals,
    KnowledgeGraphDocument,
    KnowledgeGraphMetrics,
    Relation,
    SourceObservation,
    SourceReference,
)


PIPELINE_VERSION = "2.0"
PROMPT_VERSIONS = {"section_observations": "1.0"}
RELATION_TYPES = {
    "defines", "uses", "depends_on", "supports", "derives_from", "evaluated_by", "has_formula"
}


def _normalize_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    return " ".join(re.sub(r"[^\w]+", " ", normalized).split())


def _normalize_math(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKC", value or "").strip("$ ").casefold()
    normalized = normalized.replace("\\left", "").replace("\\right", "")
    return re.sub(r"[\s{}]", "", normalized)


def stable_identifier(
    entity_type: str,
    label: str,
    *,
    math_signature: str | None = None,
    scope: str | None = None,
) -> str:
    """Derive a compact stable ID from semantic/math signatures and scope."""
    signature = "|".join(
        (entity_type, _normalize_text(label), _normalize_math(math_signature), _normalize_text(scope))
    )
    digest = hashlib.sha256(signature.encode("utf-8")).hexdigest()[:20]
    return f"{entity_type}:{digest}"


def _observation_id(kind: str, label: str, source: SourceReference, payload: dict[str, Any]) -> str:
    source_signature = source.equation_id or source.dom_node_id or source.section_id or "paper"
    return stable_identifier(
        f"observation-{kind}",
        label,
        math_signature=str(payload.get("latex", "")),
        scope=f"{source.paper_id}|{source_signature}",
    )


def _equation_section(equation_id: str, sections: list[dict[str, Any]]) -> dict[str, Any] | None:
    for section in sections:
        if equation_id and equation_id in section.get("content_html", ""):
            return section
    return None


def _is_significant_equation(equation: dict[str, Any]) -> bool:
    latex = str(equation.get("latex") or "").strip()
    if not equation.get("is_display") or len(latex) < 3:
        return False
    return bool(re.search(r"[=<>]|\\(?:sum|prod|int|mathbb|mathcal|operatorname)", latex))


def _extract_scoped_symbols(latex: str) -> list[dict[str, Any]]:
    """Retain lightweight formula-local symbol signatures without promoting nodes."""
    greek = re.findall(
        r"\\(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|psi|omega)",
        latex,
        flags=re.IGNORECASE,
    )
    simplified = re.sub(
        r"\\(?:mathcal|mathbb|mathrm|mathbf|operatorname)\s*\{([^{}]+)\}", r"\1", latex
    )
    simplified = re.sub(r"\\[A-Za-z]+", " ", simplified)
    latin = re.findall(r"(?<![A-Za-z])[A-Za-z](?:_(?:\{[^{}]+\}|[A-Za-z0-9]+))?", simplified)
    symbols = []
    seen = set()
    for symbol in [*greek, *latin]:
        key = _normalize_math(symbol)
        if key and key not in seen:
            symbols.append({
                "symbol": symbol,
                "role": "formula-local",
                "explicitly_defined": False,
            })
            seen.add(key)
    return symbols


def anchor_equation_observations(
    paper_id: str,
    sections: list[dict[str, Any]],
    equations: list[dict[str, Any]],
) -> list[SourceObservation]:
    """Create source-grounded formula observations from compiler equation records."""
    observations: list[SourceObservation] = []
    for equation in equations:
        if not _is_significant_equation(equation):
            continue
        equation_id = str(equation.get("id") or "")
        latex = str(equation.get("latex") or "").strip()
        section = _equation_section(equation_id, sections)
        source = SourceReference(
            paper_id=paper_id,
            section_id=section.get("id") if section else None,
            section_title=section.get("title") if section else None,
            dom_node_id=equation_id,
            equation_id=equation_id,
            quote=latex,
        )
        payload = {
            "latex": latex,
            "summary": f"Displayed equation {equation_id}",
            "is_display": True,
            "symbols": _extract_scoped_symbols(latex),
        }
        observations.append(SourceObservation(
            id=_observation_id("formula", equation_id or latex, source, payload),
            kind="formula",
            label=equation_id or latex,
            payload=payload,
            confidence=1.0,
            source=source,
        ))
    return observations


def _aliases(observation: SourceObservation) -> set[str]:
    values = {observation.label, *observation.payload.get("aliases", [])}
    return {_normalize_text(str(value)) for value in values if _normalize_text(str(value))}


def _group_observations(observations: list[SourceObservation]) -> list[list[SourceObservation]]:
    groups: list[list[SourceObservation]] = []
    group_aliases: list[set[str]] = []
    for observation in sorted(observations, key=lambda item: item.id):
        aliases = _aliases(observation)
        match_index = next(
            (
                index for index, group in enumerate(groups)
                if group[0].kind == observation.kind and aliases & group_aliases[index]
            ),
            None,
        )
        if match_index is None:
            groups.append([observation])
            group_aliases.append(set(aliases))
        else:
            groups[match_index].append(observation)
            group_aliases[match_index].update(aliases)
    return groups


def _entity_facets(kind: str, group: list[SourceObservation]) -> list[EntityFacet]:
    facets: list[EntityFacet] = []
    if kind == "formula":
        representative = group[0]
        facets.append(EntityFacet(
            kind="formula",
            payload={
                "latex": representative.payload.get("latex", ""),
                "summary": representative.payload.get("summary", ""),
                "equation_id": representative.source.equation_id,
            },
            evidence_ids=[item.id for item in group],
        ))
        symbols = []
        seen_symbols = set()
        for observation in group:
            for symbol in observation.payload.get("symbols", []):
                key = (_normalize_math(str(symbol.get("symbol", ""))), _normalize_text(str(symbol.get("role", ""))))
                if key not in seen_symbols:
                    symbols.append(symbol)
                    seen_symbols.add(key)
        if symbols:
            facets.append(EntityFacet(
                kind="symbols", payload={"items": symbols}, evidence_ids=[item.id for item in group]
            ))
    else:
        for observation in group:
            summary = observation.payload.get("summary") or observation.payload.get("text")
            if summary:
                facets.append(EntityFacet(
                    kind="definition" if kind == "concept" else kind,
                    payload={"text": summary},
                    evidence_ids=[observation.id],
                ))
    return facets


def _entity_signals(group: list[SourceObservation]) -> EntitySignals:
    recurrence = min(1.0, len(group) / 3)
    return EntitySignals(
        contribution=max(float(item.payload.get("contribution", 0.5)) for item in group),
        prominence=max(float(item.payload.get("prominence", 0.5)) for item in group),
        recurrence=recurrence,
        confidence=mean(item.confidence for item in group),
        familiarity=max(float(item.payload.get("familiarity", 0.0)) for item in group),
    )


def _canonical_entities(
    paper_id: str, observations: list[SourceObservation]
) -> tuple[list[CanonicalEntity], dict[str, str]]:
    entities: list[CanonicalEntity] = []
    observation_to_entity: dict[str, str] = {}
    for group in _group_observations(observations):
        representative = group[0]
        math_signature = representative.payload.get("latex") if representative.kind == "formula" else None
        entity_id = stable_identifier(
            representative.kind,
            representative.label,
            math_signature=math_signature,
            scope=paper_id,
        )
        alias_values = []
        for item in group:
            alias_values.extend([item.label, *item.payload.get("aliases", [])])
        aliases = sorted({value for value in alias_values if value != representative.label}, key=str.casefold)
        entity = CanonicalEntity(
            stable_id=entity_id,
            type=representative.kind,
            label=representative.label,
            aliases=aliases,
            observation_ids=[item.id for item in group],
            facets=_entity_facets(representative.kind, group),
            signals=_entity_signals(group),
        )
        entities.append(entity)
        for item in group:
            observation_to_entity[item.id] = entity_id
    return entities, observation_to_entity


def _promoted_symbols(
    paper_id: str,
    formula_observations: list[SourceObservation],
) -> list[CanonicalEntity]:
    symbol_occurrences: dict[str, list[tuple[SourceObservation, dict[str, Any]]]] = defaultdict(list)
    for observation in formula_observations:
        for symbol in observation.payload.get("symbols", []):
            key = _normalize_math(str(symbol.get("symbol", "")))
            if key:
                symbol_occurrences[key].append((observation, symbol))

    promoted = []
    for occurrences in symbol_occurrences.values():
        formula_ids = {observation.id for observation, _ in occurrences}
        should_promote = len(formula_ids) >= 2 or any(
            symbol.get("explicitly_defined") or symbol.get("independently_discussed")
            for _, symbol in occurrences
        )
        if not should_promote:
            continue
        label = str(occurrences[0][1]["symbol"])
        evidence_ids = sorted(formula_ids)
        promoted.append(CanonicalEntity(
            stable_id=stable_identifier("symbol", label, scope=paper_id),
            type="symbol",
            label=label,
            aliases=[],
            observation_ids=evidence_ids,
            facets=[EntityFacet(
                kind="symbol_scope",
                payload={"roles": sorted({str(symbol.get("role", "")) for _, symbol in occurrences if symbol.get("role")})},
                evidence_ids=evidence_ids,
            )],
            signals=EntitySignals(
                recurrence=min(1.0, len(formula_ids) / 3),
                confidence=mean(observation.confidence for observation, _ in occurrences),
            ),
        ))
    return sorted(promoted, key=lambda entity: entity.label.casefold())


def _relations(
    observations: list[SourceObservation],
    entities: list[CanonicalEntity],
    observation_to_entity: dict[str, str],
) -> list[Relation]:
    aliases: dict[str, str] = {}
    for entity in entities:
        for value in [entity.label, *entity.aliases]:
            aliases.setdefault(_normalize_text(value), entity.stable_id)

    relations: dict[str, Relation] = {}
    for observation in observations:
        if observation.kind == "relation":
            relation_type = observation.payload.get("type")
            source_id = aliases.get(_normalize_text(str(observation.payload.get("source", ""))))
            target_id = aliases.get(_normalize_text(str(observation.payload.get("target", ""))))
            if relation_type not in RELATION_TYPES or not source_id or not target_id or source_id == target_id:
                continue
            relation_id = stable_identifier("relation", f"{relation_type}|{source_id}|{target_id}")
            relations[relation_id] = Relation(
                stable_id=relation_id,
                type=relation_type,
                source_id=source_id,
                target_id=target_id,
                evidence_ids=[observation.id],
                confidence=observation.confidence,
            )
            continue
        source_id = observation_to_entity.get(observation.id)
        if not source_id:
            continue
        for candidate in observation.payload.get("relations", []):
            relation_type = candidate.get("type")
            target_id = aliases.get(_normalize_text(str(candidate.get("target", ""))))
            if relation_type not in RELATION_TYPES or not target_id or target_id == source_id:
                continue
            if not str(candidate.get("evidence", observation.source.quote)).strip():
                continue
            relation_id = stable_identifier("relation", f"{relation_type}|{source_id}|{target_id}")
            relations[relation_id] = Relation(
                stable_id=relation_id,
                type=relation_type,
                source_id=source_id,
                target_id=target_id,
                evidence_ids=[observation.id],
                confidence=float(candidate.get("confidence", observation.confidence)),
            )

    concept_entities = [entity for entity in entities if entity.type == "concept"]
    formula_entities = [entity for entity in entities if entity.type == "formula"]
    for concept in concept_entities:
        concept_aliases = {_normalize_text(value) for value in [concept.label, *concept.aliases]}
        for formula in formula_entities:
            if not concept_aliases & {_normalize_text(value) for value in [formula.label, *formula.aliases]}:
                continue
            evidence_ids = sorted(set(concept.observation_ids + formula.observation_ids))
            relation_id = stable_identifier("relation", f"has_formula|{concept.stable_id}|{formula.stable_id}")
            relations[relation_id] = Relation(
                stable_id=relation_id,
                type="has_formula",
                source_id=concept.stable_id,
                target_id=formula.stable_id,
                evidence_ids=evidence_ids,
                confidence=min(concept.signals.confidence, formula.signals.confidence),
            )
    return sorted(relations.values(), key=lambda relation: relation.stable_id)


def _cross_type_label_collisions(entities: list[CanonicalEntity]) -> list[dict[str, Any]]:
    """Surface ambiguous shared names without collapsing distinct semantic kinds."""
    entities_by_label: dict[str, dict[str, CanonicalEntity]] = defaultdict(dict)
    for entity in entities:
        for value in [entity.label, *entity.aliases]:
            normalized = _normalize_text(value)
            if normalized:
                entities_by_label[normalized][entity.stable_id] = entity

    collisions_by_entities: dict[tuple[str, ...], dict[str, Any]] = {}
    for normalized, indexed_entities in sorted(entities_by_label.items()):
        group = sorted(indexed_entities.values(), key=lambda entity: entity.stable_id)
        types = sorted({entity.type for entity in group})
        if len(group) < 2 or len(types) < 2:
            continue
        display_labels = sorted(
            {
                value
                for entity in group
                for value in [entity.label, *entity.aliases]
                if _normalize_text(value) == normalized
            },
            key=lambda value: (len(value), value.casefold()),
        )
        collision = {
            "label": display_labels[0],
            "entity_ids": [entity.stable_id for entity in group],
            "types": types,
        }
        key = tuple(collision["entity_ids"])
        existing = collisions_by_entities.get(key)
        if existing is None or (len(collision["label"]), collision["label"].casefold()) < (
            len(existing["label"]), existing["label"].casefold()
        ):
            collisions_by_entities[key] = collision
    return sorted(
        collisions_by_entities.values(),
        key=lambda collision: (collision["label"].casefold(), collision["entity_ids"]),
    )


def cross_type_label_collisions(entities: list[CanonicalEntity]) -> list[dict[str, Any]]:
    """Return deterministic same-name collisions across semantic entity kinds."""
    return _cross_type_label_collisions(entities)


def canonicalize_observations(
    paper_id: str,
    observations: Iterable[SourceObservation | dict[str, Any]],
    *,
    models: dict[str, str] | None = None,
) -> KnowledgeGraphDocument:
    """Canonicalize immutable observations into a validated versioned document."""
    parsed = [
        item if isinstance(item, SourceObservation) else SourceObservation.model_validate(item)
        for item in observations
    ]
    parsed.sort(key=lambda item: item.id)
    regular = [item for item in parsed if item.kind not in {"symbol", "relation"}]
    entities, observation_to_entity = _canonical_entities(paper_id, regular)
    formula_observations = [item for item in regular if item.kind == "formula"]
    promoted_symbols = _promoted_symbols(paper_id, formula_observations)
    entities.extend(promoted_symbols)
    entities.sort(key=lambda entity: entity.stable_id)
    relations = _relations(parsed, entities, observation_to_entity)

    total_symbols = sum(len(item.payload.get("symbols", [])) for item in formula_observations)
    diagnostics = {
        "observation_kinds": dict(sorted(Counter(item.kind for item in parsed).items())),
        "promoted_symbol_count": len(promoted_symbols),
        "scoped_symbol_count": total_symbols,
        "demoted_symbol_count": max(0, total_symbols - len(promoted_symbols)),
        "cross_type_label_collisions": _cross_type_label_collisions(entities),
    }
    return KnowledgeGraphDocument(
        schema_version=SCHEMA_VERSION,
        build=BuildMetadata(
            pipeline_version=PIPELINE_VERSION,
            prompt_versions=PROMPT_VERSIONS,
            models=models or {},
        ),
        observations=parsed,
        entities=entities,
        relations=relations,
        metrics=KnowledgeGraphMetrics(
            observation_count=len(parsed),
            entity_count=len(entities),
            relation_count=len(relations),
            diagnostics=diagnostics,
        ),
    )