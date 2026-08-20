"""Deterministic anchoring and canonicalization for the versioned KG document."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import Counter, defaultdict
from statistics import mean
from typing import Any, Iterable

from bs4 import BeautifulSoup

from backend.app.compiler.occurrence_text import annotatable_text, is_annotatable_target
from backend.app.agents.knowledge_graph_models import (
    SCHEMA_VERSION,
    BuildMetadata,
    CanonicalEntity,
    EntityFacet,
    EntitySignals,
    EquationRecord,
    KnowledgeGraphDocument,
    KnowledgeGraphMetrics,
    LEGACY_RELATION_TYPES,
    NotationRecord,
    Relation,
    SemanticExplanation,
    SemanticOccurrence,
    SourceObservation,
    SourceReference,
)


PIPELINE_VERSION = "3.0"
PROMPT_VERSIONS = {"section_observations": "2.0", "equation_analysis": "1.2"}
RELATION_TYPES = {
    "is_a", "part_of", "uses", "depends_on", "applies_to", "produces", "supports",
    "challenges", "compares_with",
}
SEMANTIC_KINDS = {"topic", "claim", "procedure", "artifact", "quantity"}


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
        if key and key not in {"i", "j", "k"} and key not in seen:
            symbols.append({
                "symbol": symbol,
                "meaning": "Meaning not explicitly defined near this equation",
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
            "equation_id": equation_id,
            "latex": latex,
            "summary": f"Displayed equation {equation_id}",
            "scope_id": str(section.get("id")) if section else equation_id,
            "is_display": True,
            "symbols": _extract_scoped_symbols(latex),
        }
        observations.append(SourceObservation(
            id=_observation_id("equation", equation_id or latex, source, payload),
            kind="equation",
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
    for observation in group:
        summary = observation.payload.get("summary") or observation.payload.get("text")
        if summary:
            facets.append(EntityFacet(
                kind=str(observation.payload.get("facet_kind") or kind),
                payload={"text": summary, **dict(observation.payload.get("facet", {}))},
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
        entity_id = stable_identifier(
            representative.kind,
            representative.label,
            scope=paper_id,
        )
        alias_values = []
        for item in group:
            alias_values.extend([item.label, *item.payload.get("aliases", [])])
        aliases = sorted({value for value in alias_values if value != representative.label}, key=str.casefold)
        entity = CanonicalEntity(
            stable_id=entity_id,
            kind=representative.kind,
            label=representative.label,
            aliases=aliases,
            roles=sorted({
                str(role)
                for item in group
                for role in item.payload.get("roles", [])
                if str(role).strip()
            }),
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
            qualifiers = list(observation.payload.get("qualifiers", []))
            if relation_type in LEGACY_RELATION_TYPES:
                relation_type, legacy_qualifier = LEGACY_RELATION_TYPES[relation_type]
                if legacy_qualifier not in qualifiers:
                    qualifiers.append(legacy_qualifier)
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
                qualifiers=sorted(set(qualifiers)),
                evidence_ids=[observation.id],
                confidence=observation.confidence,
            )
            continue
        source_id = observation_to_entity.get(observation.id)
        if not source_id:
            continue
        for candidate in observation.payload.get("relations", []):
            relation_type = candidate.get("type")
            qualifiers = list(candidate.get("qualifiers", []))
            if relation_type in LEGACY_RELATION_TYPES:
                relation_type, legacy_qualifier = LEGACY_RELATION_TYPES[relation_type]
                if legacy_qualifier not in qualifiers:
                    qualifiers.append(legacy_qualifier)
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
                qualifiers=sorted(set(qualifiers)),
                evidence_ids=[observation.id],
                confidence=float(candidate.get("confidence", observation.confidence)),
            )
    return sorted(relations.values(), key=lambda relation: relation.stable_id)


def _equations_and_notation(
    observations: list[SourceObservation],
    entities: list[CanonicalEntity],
) -> tuple[list[EquationRecord], list[NotationRecord]]:
    aliases = {
        _normalize_text(value): entity.stable_id
        for entity in entities
        for value in [entity.label, *entity.aliases]
    }
    observation_entities = {
        observation_id: entity.stable_id
        for entity in entities
        for observation_id in entity.observation_ids
    }
    notation_by_signature: dict[tuple[str, str, str], NotationRecord] = {}
    equation_rows: list[
        tuple[SourceObservation, str, list[str], list[str], str | None]
    ] = []
    for observation in observations:
        if observation.kind != "equation":
            continue
        equation_id = str(
            observation.payload.get("equation_id") or observation.source.equation_id or observation.label
        )
        default_scope = str(
            observation.payload.get("scope_id") or observation.source.section_id or equation_id
        )
        equation_notation_ids = []
        for symbol in observation.payload.get("symbols", []):
            glyph = str(symbol.get("symbol", "")).strip()
            if not glyph:
                continue
            meaning = str(
                symbol.get("meaning") or symbol.get("role") or "Meaning not explicitly defined near this equation"
            ).strip()
            scope_id = str(symbol.get("scope_id") or default_scope)
            signature = (_normalize_math(glyph), _normalize_text(meaning), _normalize_text(scope_id))
            notation_id = stable_identifier(
                "notation", glyph, math_signature=meaning, scope=f"{observation.source.paper_id}|{scope_id}"
            )
            object_ids = sorted({
                aliases[_normalize_text(str(label))]
                for label in symbol.get("object_labels", [])
                if _normalize_text(str(label)) in aliases
            })
            existing = notation_by_signature.get(signature)
            evidence_ids = sorted(set([observation.id, *(existing.evidence_ids if existing else [])]))
            notation_by_signature[signature] = NotationRecord(
                stable_id=notation_id,
                symbol=glyph,
                meaning=meaning,
                scope_id=scope_id,
                units=symbol.get("units"),
                constraints=sorted({str(value) for value in symbol.get("constraints", [])}),
                object_ids=sorted(set(object_ids + (existing.object_ids if existing else []))),
                evidence_ids=evidence_ids,
            )
            equation_notation_ids.append(notation_id)
        object_ids = sorted({
            aliases[_normalize_text(str(label))]
            for label in observation.payload.get("object_labels", [])
            if _normalize_text(str(label)) in aliases
        })
        defined_object_id = observation_entities.get(
            str(observation.payload.get("defined_object_observation_id") or "")
        )
        equation_rows.append((
            observation,
            equation_id,
            sorted(set(equation_notation_ids)),
            object_ids,
            defined_object_id,
        ))

    # The model sees the whole equation batch and is instructed to choose at
    # most one defining equation per object. If it violates that contract, do
    # not turn extraction order into a semantic decision: reject every
    # conflicting attachment and leave the term without a primary formula.
    defining_counts = Counter(
        defined_object_id
        for *_, defined_object_id in equation_rows
        if defined_object_id
    )

    equations = [
        EquationRecord(
            stable_id=stable_identifier("equation", equation_id, math_signature=str(observation.payload.get("latex", ""))),
            equation_id=equation_id,
            latex=str(observation.payload.get("latex", "")).strip(),
            summary=str(observation.payload.get("summary") or f"Displayed equation {equation_id}"),
            notation_ids=notation_ids,
            object_ids=object_ids,
            defined_object_id=(
                defined_object_id
                if defined_object_id and defining_counts[defined_object_id] == 1
                else None
            ),
            evidence_ids=[observation.id],
        )
        for observation, equation_id, notation_ids, object_ids, defined_object_id in equation_rows
        if str(observation.payload.get("latex", "")).strip()
    ]
    return sorted(equations, key=lambda item: item.stable_id), sorted(
        notation_by_signature.values(), key=lambda item: item.stable_id
    )


def _base_explanations(
    entities: list[CanonicalEntity], notation: list[NotationRecord]
) -> list[SemanticExplanation]:
    explanations = []
    for entity in entities:
        content = next(
            (
                str(facet.payload.get("text", "")).strip()
                for facet in entity.facets
                if str(facet.payload.get("text", "")).strip()
            ),
            entity.label,
        )
        explanations.append(SemanticExplanation(
            stable_id=stable_identifier("explanation", entity.stable_id, scope="intermediate"),
            subject_id=entity.stable_id,
            base_content=content,
            expertise="intermediate",
            evidence_ids=entity.observation_ids,
        ))
    for item in notation:
        explanations.append(SemanticExplanation(
            stable_id=stable_identifier("explanation", item.stable_id, scope="intermediate"),
            subject_id=item.stable_id,
            base_content=item.meaning,
            expertise="intermediate",
            evidence_ids=item.evidence_ids,
        ))
    return sorted(explanations, key=lambda item: item.stable_id)


def _candidate_occurrences(
    entities: list[CanonicalEntity],
    sections: list[dict[str, Any]],
) -> list[SemanticOccurrence]:
    candidates: list[tuple[str, int, int, str, str, str]] = []
    for section in sections:
        section_id = str(section.get("id") or "paper")
        soup = BeautifulSoup(str(section.get("content_html") or ""), "html.parser")
        for element in soup.find_all(attrs={"data-id": True}):
            # Every ``data-id`` node is scanned, not only childless ones: LaTeXML
            # gives inline formulas their own ``data-id``, so skipping nodes with
            # annotated descendants silently dropped every paragraph containing
            # math -- most of the prose in a technical paper.
            if not is_annotatable_target(element):
                continue
            dom_node_id = str(element.get("data-id"))
            text = annotatable_text(element)
            for entity in entities:
                for label in sorted({entity.label, *entity.aliases}, key=lambda value: (-len(value), value.casefold())):
                    if len(label.strip()) < 2:
                        continue
                    pattern = re.compile(rf"(?<!\w){re.escape(label)}(?!\w)", re.IGNORECASE)
                    for match in pattern.finditer(text):
                        candidates.append((dom_node_id, match.start(), match.end(), match.group(), section_id, entity.stable_id))

    selected = []
    occupied: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for dom_node_id, start, end, text, scope_id, subject_id in sorted(
        candidates, key=lambda item: (item[0], item[1], -(item[2] - item[1]), item[5])
    ):
        if any(start < used_end and end > used_start for used_start, used_end in occupied[dom_node_id]):
            continue
        occupied[dom_node_id].append((start, end))
        selected.append(SemanticOccurrence(
            stable_id=stable_identifier("occurrence", subject_id, scope=f"{dom_node_id}|{start}|{end}"),
            subject_id=subject_id,
            dom_node_id=dom_node_id,
            start=start,
            end=end,
            text=text,
            scope_id=scope_id,
        ))
    return sorted(selected, key=lambda item: (item.dom_node_id or "", item.start, item.stable_id))


def _fallback_occurrences(
    entities: list[CanonicalEntity], observations: list[SourceObservation]
) -> list[SemanticOccurrence]:
    by_id = {observation.id: observation for observation in observations}
    occurrences = []
    for entity in entities:
        for evidence_id in entity.observation_ids:
            observation = by_id[evidence_id]
            source = observation.source
            if not source.dom_node_id:
                continue
            labels = sorted({entity.label, *entity.aliases}, key=lambda value: (-len(value), value.casefold()))
            match = None
            for label in labels:
                if len(label.strip()) < 2:
                    continue
                match = re.search(
                    rf"(?<!\w){re.escape(label)}(?!\w)", source.quote, re.IGNORECASE
                )
                if match:
                    break
            if not match:
                continue
            base = source.char_start or 0
            start, end = base + match.start(), base + match.end()
            occurrences.append(SemanticOccurrence(
                stable_id=stable_identifier("occurrence", entity.stable_id, scope=f"{source.dom_node_id}|{start}|{end}"),
                subject_id=entity.stable_id,
                dom_node_id=source.dom_node_id,
                start=start,
                end=end,
                text=match.group(),
                scope_id=str(source.section_id or source.dom_node_id),
            ))
    return sorted({item.stable_id: item for item in occurrences}.values(), key=lambda item: item.stable_id)


def _notation_occurrences(
    equations: list[EquationRecord], notation: list[NotationRecord]
) -> list[SemanticOccurrence]:
    notation_by_id = {item.stable_id: item for item in notation}
    occurrences = []
    for equation in equations:
        for notation_id in equation.notation_ids:
            item = notation_by_id[notation_id]
            for match in re.finditer(re.escape(item.symbol), equation.latex):
                occurrences.append(SemanticOccurrence(
                    stable_id=stable_identifier(
                        "occurrence", notation_id, scope=f"{equation.equation_id}|{match.start()}|{match.end()}"
                    ),
                    subject_id=notation_id,
                    equation_id=equation.equation_id,
                    start=match.start(),
                    end=match.end(),
                    text=match.group(),
                    scope_id=item.scope_id,
                ))
    return occurrences


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
    sections: list[dict[str, Any]] | None = None,
) -> KnowledgeGraphDocument:
    """Canonicalize immutable observations into a validated versioned document."""
    parsed = [
        item if isinstance(item, SourceObservation) else SourceObservation.model_validate(item)
        for item in observations
    ]
    parsed.sort(key=lambda item: item.id)
    regular = [item for item in parsed if item.kind in SEMANTIC_KINDS]
    entities, observation_to_entity = _canonical_entities(paper_id, regular)
    entities.sort(key=lambda entity: entity.stable_id)
    relations = _relations(parsed, entities, observation_to_entity)
    equations, notation = _equations_and_notation(parsed, entities)
    explanations = _base_explanations(entities, notation)
    occurrences = _candidate_occurrences(entities, sections or []) if sections else _fallback_occurrences(entities, parsed)
    occurrences.extend(_notation_occurrences(equations, notation))
    occurrences = sorted({item.stable_id: item for item in occurrences}.values(), key=lambda item: item.stable_id)

    diagnostics = {
        "observation_kinds": dict(sorted(Counter(item.kind for item in parsed).items())),
        "equation_count": len(equations),
        "scoped_notation_count": len(notation),
        "explanation_count": len(explanations),
        "occurrence_count": len(occurrences),
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
        objects=entities,
        relations=relations,
        equations=equations,
        notation=notation,
        explanations=explanations,
        occurrences=occurrences,
        metrics=KnowledgeGraphMetrics(
            observation_count=len(parsed),
            object_count=len(entities),
            relation_count=len(relations),
            diagnostics=diagnostics,
        ),
    )