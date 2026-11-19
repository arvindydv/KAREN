"""Hybrid retrieval (Postgres FTS + pgvector, optional reranking). Not implemented yet.

Future responsibility: apply tenant/user permission filters BEFORE retrieval and reranking,
assemble short scoped context, and record embedding model/version with every vector.
EMBEDDING/RERANKING tiers stay behind KAREN_FEATURE_*_ENABLED until benchmarked.
"""
