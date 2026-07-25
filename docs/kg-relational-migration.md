# Knowledge Graph Relational Migration Criteria

The current transition architecture persists one validated `KnowledgeGraphDocument` in `Paper.knowledge_graph`. Do not normalize it merely because tables are conventional; migrate when real access patterns require independent indexes or updates.

## Proven Access Patterns

The implemented consumers require:

- a ranked 15–25 entity overview with a hard cap of 30;
- entity search by label, alias, facet text, type, and source section;
- one-hop adjacency lookup from entity IDs or source locations;
- evidence lookup from entities and relations to source observations;
- stable entity/relation IDs across rebuilds;
- offline retrieval evaluation by source ID and query class.

JSONB remains adequate for single-paper builds because documents are replaced atomically and projected in application memory. The projection API prevents canonical document size from affecting browser payload or layout work.

## Migration Triggers

Start relational design when at least one measured requirement is blocked by JSONB:

1. Cross-paper entity linking needs indexed canonical signatures and aliases.
2. Incremental rebuilds must update observations or entities without replacing a paper document.
3. Server search/projection latency on representative large papers misses its target after application-level indexing/caching.
4. Retrieval needs joins across papers, citations, entities, relations, and evidence.
5. Concurrent annotation or adjudication workflows need row-level updates and provenance history.

## Candidate Boundaries

Normalize `kg_builds`, `kg_observations`, `kg_entities`, `kg_entity_observations`, `kg_relations`, and `kg_relation_evidence`. Keep large facet payloads JSONB until their fields have demonstrated query requirements. Preserve the versioned document exporter as a compatibility and debugging contract.

Before migration, benchmark representative queries, define transaction/rebuild semantics, and add a dual-write parity test. Stable canonical IDs—not database surrogate IDs—remain the external API identity.