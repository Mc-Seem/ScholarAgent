"""Offline passage-only versus budgeted canonical-graph retrieval evaluation."""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from backend.app.agents.knowledge_graph_models import (
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


STOP_WORDS = {
    "a", "an", "and", "by", "does", "for", "how", "in", "is", "of", "on", "the", "this",
    "through", "to", "what", "where", "which", "with",
}


@dataclass(frozen=True)
class RetrievalResult:
    source_ids: list[str]
    contexts: list[str]
    token_count: int
    latency_ms: float
    linked_entity_count: int = 0
    expansion_depth: int = 0


def _tokens(value: str) -> list[str]:
    return [
        token for token in re.findall(r"[a-z0-9]+", value.casefold())
        if token not in STOP_WORDS
    ]


def _source_scores(question: str, corpus: list[dict[str, Any]]) -> dict[str, float]:
    query_tokens = _tokens(question)
    document_tokens = {source["id"]: _tokens(source["text"]) for source in corpus}
    document_frequency = Counter(
        token
        for tokens in document_tokens.values()
        for token in set(tokens)
    )
    scores = {}
    for source in corpus:
        counts = Counter(document_tokens[source["id"]])
        score = sum(
            counts[token] * (math.log((len(corpus) + 1) / (document_frequency[token] + 1)) + 1)
            for token in query_tokens
        )
        normalized_question = " ".join(query_tokens)
        if normalized_question and normalized_question in " ".join(document_tokens[source["id"]]):
            score += 1.5
        scores[source["id"]] = score
    return scores


def _result_from_scores(
    corpus: list[dict[str, Any]],
    scores: dict[str, float],
    *,
    limit: int,
    started_at: float,
    linked_entity_count: int = 0,
    expansion_depth: int = 0,
) -> RetrievalResult:
    corpus_order = {source["id"]: index for index, source in enumerate(corpus)}
    source_by_id = {source["id"]: source for source in corpus}
    ranked_ids = sorted(scores, key=lambda source_id: (-scores[source_id], corpus_order[source_id]))[:limit]
    contexts = [source_by_id[source_id]["text"] for source_id in ranked_ids]
    return RetrievalResult(
        source_ids=ranked_ids,
        contexts=contexts,
        token_count=sum(len(_tokens(context)) for context in contexts),
        latency_ms=(time.perf_counter() - started_at) * 1000,
        linked_entity_count=linked_entity_count,
        expansion_depth=expansion_depth,
    )


def passage_retrieve(
    question: str,
    corpus: list[dict[str, Any]],
    *,
    limit: int = 2,
) -> RetrievalResult:
    started_at = time.perf_counter()
    return _result_from_scores(
        corpus,
        _source_scores(question, corpus),
        limit=limit,
        started_at=started_at,
    )


def _entity_link_scores(question: str, document: KnowledgeGraphDocument) -> list[tuple[str, float]]:
    normalized_question = " ".join(_tokens(question))
    question_tokens = set(_tokens(question))
    linked = []
    for entity in document.entities:
        best = 0.0
        for label in [entity.label, *entity.aliases]:
            normalized_label = " ".join(_tokens(label))
            label_tokens = set(_tokens(label))
            if not normalized_label:
                continue
            if normalized_label == normalized_question or normalized_label in normalized_question:
                score = 2.0
            else:
                overlap = len(question_tokens & label_tokens)
                score = overlap / max(1, len(label_tokens))
            best = max(best, score)
        if best > 0:
            linked.append((entity.stable_id, best))
    return sorted(linked, key=lambda item: (-item[1], item[0]))


def hybrid_retrieve(
    question: str,
    corpus: list[dict[str, Any]],
    document: KnowledgeGraphDocument,
    *,
    source_limit: int = 3,
    entity_budget: int = 6,
) -> RetrievalResult:
    started_at = time.perf_counter()
    source_scores = _source_scores(question, corpus)
    observation_by_id = {observation.id: observation for observation in document.observations}
    entity_by_id = {entity.stable_id: entity for entity in document.entities}
    linked = _entity_link_scores(question, document)[:min(3, entity_budget)]
    selected_ids = [entity_id for entity_id, _ in linked]
    linked_scores = dict(linked)

    neighbor_scores: dict[str, float] = defaultdict(float)
    traversed_relations = []
    for relation in document.relations:
        if relation.source_id in selected_ids and relation.target_id not in selected_ids:
            neighbor_scores[relation.target_id] = max(
                neighbor_scores[relation.target_id], linked_scores[relation.source_id]
            )
            traversed_relations.append(relation)
        elif relation.target_id in selected_ids and relation.source_id not in selected_ids:
            neighbor_scores[relation.source_id] = max(
                neighbor_scores[relation.source_id], linked_scores[relation.target_id]
            )
            traversed_relations.append(relation)
        elif relation.source_id in selected_ids and relation.target_id in selected_ids:
            traversed_relations.append(relation)
    for entity_id, _score in sorted(neighbor_scores.items(), key=lambda item: (-item[1], item[0])):
        if len(selected_ids) >= entity_budget:
            break
        selected_ids.append(entity_id)

    for entity_id in selected_ids:
        entity = entity_by_id[entity_id]
        is_seed = entity_id in linked_scores
        boost = 3.0 + (linked_scores.get(entity_id, 0.0) if is_seed else 2.0)
        for observation_id in entity.observation_ids:
            source_id = observation_by_id[observation_id].source.dom_node_id
            if source_id in source_scores:
                source_scores[source_id] += boost
    selected_set = set(selected_ids)
    for relation in traversed_relations:
        if relation.source_id not in selected_set or relation.target_id not in selected_set:
            continue
        for observation_id in relation.evidence_ids:
            source_id = observation_by_id[observation_id].source.dom_node_id
            if source_id in source_scores:
                source_scores[source_id] += 4.0

    return _result_from_scores(
        corpus,
        source_scores,
        limit=source_limit,
        started_at=started_at,
        linked_entity_count=len(selected_ids),
        expansion_depth=1 if linked else 0,
    )


def _metric(result: RetrievalResult, expected_source_ids: Iterable[str]) -> dict[str, float]:
    expected = set(expected_source_ids)
    returned = set(result.source_ids)
    return {
        "evidence_recall": len(expected & returned) / len(expected) if expected else 1.0,
        "citation_faithfulness": len(expected & returned) / len(returned) if returned else 1.0,
        "latency_ms": result.latency_ms,
        "token_count": float(result.token_count),
    }


def _aggregate(metrics: list[dict[str, float]]) -> dict[str, float]:
    return {
        key: statistics.mean(metric[key] for metric in metrics)
        for key in ("evidence_recall", "citation_faithfulness", "latency_ms", "token_count")
    }


def _promotion_decision(passage: dict[str, float], hybrid: dict[str, float]) -> str:
    latency_limit = max(passage["latency_ms"] * 1.5, passage["latency_ms"] + 0.05)
    token_limit = max(passage["token_count"] * 1.25, passage["token_count"])
    if (
        hybrid["evidence_recall"] - passage["evidence_recall"] >= 0.05
        and hybrid["citation_faithfulness"] >= passage["citation_faithfulness"]
        and hybrid["latency_ms"] <= latency_limit
        and hybrid["token_count"] <= token_limit
    ):
        return "hybrid"
    return "passage_only"


def evaluate_retrieval(fixture: dict[str, Any], *, repetitions: int = 20) -> dict[str, Any]:
    corpus = fixture["retrieval_corpus"]
    document = build_fixture_document(fixture)
    by_class: dict[str, dict[str, list[dict[str, float]]]] = defaultdict(
        lambda: {"passage": [], "hybrid": []}
    )
    for question in fixture["retrieval_questions"]:
        passage_runs = []
        hybrid_runs = []
        for _ in range(max(1, repetitions)):
            passage_runs.append(passage_retrieve(question["question"], corpus, limit=2))
            hybrid_runs.append(hybrid_retrieve(
                question["question"], corpus, document, source_limit=3, entity_budget=6
            ))
        passage_metric = _metric(passage_runs[0], question["expected_source_ids"])
        hybrid_metric = _metric(hybrid_runs[0], question["expected_source_ids"])
        passage_metric["latency_ms"] = statistics.median(run.latency_ms for run in passage_runs)
        hybrid_metric["latency_ms"] = statistics.median(run.latency_ms for run in hybrid_runs)
        by_class[question["class"]]["passage"].append(passage_metric)
        by_class[question["class"]]["hybrid"].append(hybrid_metric)

    query_classes = {}
    for query_class, paths in sorted(by_class.items()):
        passage = _aggregate(paths["passage"])
        hybrid = _aggregate(paths["hybrid"])
        query_classes[query_class] = {
            "passage": passage,
            "hybrid": hybrid,
            "decision": _promotion_decision(passage, hybrid),
        }
    promoted = [
        query_class for query_class, metrics in query_classes.items()
        if metrics["decision"] == "hybrid"
    ]
    return {
        "fixture": fixture.get("name", "knowledge-graph-retrieval"),
        "repetitions": max(1, repetitions),
        "query_classes": query_classes,
        "promoted_classes": promoted,
        "default": "passage_only",
    }


def build_fixture_document(fixture: dict[str, Any]) -> KnowledgeGraphDocument:
    corpus_by_id = {source["id"]: source for source in fixture["retrieval_corpus"]}
    observations = []
    entities = []
    observations_by_source: dict[str, list[str]] = defaultdict(list)
    for compact_entity in fixture["retrieval_graph"]["entities"]:
        entity_observation_ids = []
        for source_id in compact_entity["source_ids"]:
            source = corpus_by_id[source_id]
            observation_id = f"obs:{compact_entity['id']}:{source_id}"
            observations.append(SourceObservation(
                id=observation_id,
                kind=compact_entity["type"],
                label=compact_entity["label"],
                payload={"aliases": compact_entity.get("aliases", [])},
                confidence=1.0,
                source=SourceReference(
                    paper_id="fixture-paper",
                    section_id=source["section_id"],
                    dom_node_id=source_id,
                    equation_id=source_id if source["kind"] == "equation" else None,
                    quote=source["text"],
                ),
            ))
            entity_observation_ids.append(observation_id)
            observations_by_source[source_id].append(observation_id)
        entities.append(CanonicalEntity(
            stable_id=compact_entity["id"],
            type=compact_entity["type"],
            label=compact_entity["label"],
            aliases=compact_entity.get("aliases", []),
            observation_ids=entity_observation_ids,
            facets=[EntityFacet(
                kind=compact_entity["type"],
                payload={"text": corpus_by_id[compact_entity["source_ids"][0]]["text"]},
                evidence_ids=entity_observation_ids,
            )],
            signals=EntitySignals(contribution=0.8, prominence=0.8, recurrence=0.5, confidence=1.0),
        ))
    relations = []
    for compact_relation in fixture["retrieval_graph"]["relations"]:
        evidence_ids = []
        for source_id in compact_relation["evidence_source_ids"]:
            evidence_ids.extend(observations_by_source[source_id][:1])
        relations.append(Relation(
            stable_id=compact_relation["id"],
            type=compact_relation["type"],
            source_id=compact_relation["source_id"],
            target_id=compact_relation["target_id"],
            evidence_ids=list(dict.fromkeys(evidence_ids)),
            confidence=1.0,
        ))
    return KnowledgeGraphDocument(
        schema_version="3.0",
        build=BuildMetadata(
            pipeline_version="retrieval-fixture-3",
            created_at=datetime(2026, 7, 25, tzinfo=UTC),
        ),
        observations=observations,
        objects=entities,
        relations=relations,
        metrics=KnowledgeGraphMetrics(
            observation_count=len(observations),
            object_count=len(entities),
            relation_count=len(relations),
            diagnostics={"fixture": True},
        ),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path)
    parser.add_argument("--repetitions", type=int, default=20)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    rendered = json.dumps(
        evaluate_retrieval(fixture, repetitions=args.repetitions), indent=2, sort_keys=True
    ) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")


if __name__ == "__main__":
    main()