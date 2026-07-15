from datetime import datetime, UTC
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Index, Boolean, Integer, JSON
from sqlalchemy.orm import DeclarativeBase, relationship


# Helper function for SQLAlchemy default datetime values
def utcnow():
    """Return current UTC time for use as SQLAlchemy default."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Paper(Base):
    __tablename__ = "papers"

    id = Column(String(64), primary_key=True)  # SHA256 hash
    filename = Column(String(255), nullable=False)
    arxiv_id = Column(String(20), nullable=True)
    html_content = Column(Text, nullable=True)  # Compiled HTML from LaTeXML
    uploaded_at = Column(DateTime, default=utcnow)
    compiled_at = Column(DateTime, nullable=True)

    # Extracted metadata (populated at compile time for agent pipeline)
    # Using JSON instead of JSONB for SQLite compatibility in tests
    # PostgreSQL will still use JSON efficiently
    sections_data = Column(JSON, nullable=True)     # Section hierarchy for TOC + agents
    equations_data = Column(JSON, nullable=True)    # Equations with LaTeX source
    citations_data = Column(JSON, nullable=True)    # Bibliography entries
    paper_metadata = Column(JSON, nullable=True)    # Title, authors, abstract
    latex_source = Column(Text, nullable=True)      # Raw main.tex content for agent context

    # Knowledge graph (populated by agent pipeline)
    knowledge_graph = Column(JSON, nullable=True)   # {nodes: [...], edges: [...], metadata: {...}}

    # Cached tooltip suggestions (populated by suggest endpoint, used by apply endpoint)
    # Stored as JSON: {expertise: str, suggestions: [...], generated_at: timestamp}
    tooltip_suggestions_cache = Column(JSON, nullable=True)

    tooltips = relationship("Tooltip", back_populates="paper", cascade="all, delete-orphan")
    tooltip_suggestions = relationship("TooltipSuggestion", back_populates="paper", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Paper(id={self.id[:8]}..., filename={self.filename})>"


class Tooltip(Base):
    __tablename__ = "tooltips"

    id = Column(String(64), primary_key=True)  # UUID or hash
    paper_id = Column(String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)

    # Dual mode: semantic (entity_id) vs. paragraph (dom_node_id)
    # Semantic tooltip: entity_id is set, applies to all occurrences of that entity
    # Paragraph comment: dom_node_id is set, applies to one specific block
    entity_id = Column(String(128), nullable=True)  # NEW: KG entity ID (e.g., "symbol_alpha_t")
    dom_node_id = Column(String(128), nullable=True)  # The data-id attribute from HTML

    user_id = Column(String(64), default="default")  # MVP: single user
    target_text = Column(String(512), nullable=True)  # What symbol/term this annotation explains
    content = Column(Text, nullable=False)
    is_pinned = Column(Boolean, default=False, nullable=False)  # Pin to keep expanded
    display_order = Column(Integer, nullable=True)  # Manual ordering within section
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    paper = relationship("Paper", back_populates="tooltips")

    __table_args__ = (
        Index("idx_paper_node", "paper_id", "dom_node_id"),
        Index("idx_paper_entity", "paper_id", "entity_id"),  # NEW: Index for semantic tooltips
        Index("idx_paper_user", "paper_id", "user_id"),
    )

    def __repr__(self):
        return f"<Tooltip(id={self.id[:8]}..., paper_id={self.paper_id[:8]}...)>"


class TooltipSuggestion(Base):
    """Stores tooltip suggestions (both AI-generated and manual) before they're applied"""
    __tablename__ = "tooltip_suggestions"

    id = Column(String(64), primary_key=True)  # UUID
    paper_id = Column(String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)

    # Suggestion metadata
    entity_id = Column(String(128), nullable=True)  # KG entity ID (for AI suggestions)
    entity_label = Column(String(512), nullable=False)  # The term/symbol to annotate
    entity_type = Column(String(64), nullable=False)  # symbol, definition, theorem, other
    tooltip_content = Column(Text, nullable=False)  # The tooltip text
    is_ai_generated = Column(Boolean, default=False, nullable=False)  # True for AI, False for manual

    # User info
    user_id = Column(String(64), default="default")
    created_at = Column(DateTime, default=utcnow)

    paper = relationship("Paper", back_populates="tooltip_suggestions")

    __table_args__ = (
        Index("idx_suggestion_paper", "paper_id"),
        Index("idx_suggestion_paper_entity", "paper_id", "entity_id"),
    )

    def __repr__(self):
        return f"<TooltipSuggestion(id={self.id[:8]}..., label={self.entity_label})>"


class LLMConfig(Base):
    """Stores LLM provider configuration (provider, API key, models per workflow).

    Only one row should have is_active=True at a time (enforced at the application layer).
    API keys are encrypted at rest using Fernet symmetric encryption.
    """
    __tablename__ = "llm_configs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    provider = Column(String(64), nullable=False)  # "anthropic" | "openai" | "ollama" | "custom"
    base_url = Column(String(512), nullable=True)   # Custom endpoint URL (e.g. Ollama Cloud)
    api_key_enc = Column(Text, nullable=True)       # Fernet-encrypted API key
    # Per-workflow model names: {"kg_extraction": "...", "html_injection": "...", "tooltip_suggestion": "..."}
    models = Column(JSON, nullable=False, default=dict)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    def __repr__(self):
        return f"<LLMConfig(id={self.id}, provider={self.provider}, active={self.is_active})>"
