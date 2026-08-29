from datetime import datetime, UTC
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship


# Helper function for SQLAlchemy default datetime values
def utcnow():
    """Return current UTC time for use as SQLAlchemy default."""
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class User(Base):
    """Minimal user record for the current single-user application model."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=False)

    chat_conversations = relationship(
        "ChatConversation",
        back_populates="user",
        cascade="all, delete-orphan",
    )


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

    # Versioned semantic document (objects, relations, equations, notation, occurrences)
    knowledge_graph = Column(JSON, nullable=True)

    tooltips = relationship("Tooltip", back_populates="paper", cascade="all, delete-orphan")
    tooltip_suggestions = relationship("TooltipSuggestion", back_populates="paper", cascade="all, delete-orphan")
    chat_conversations = relationship(
        "ChatConversation",
        back_populates="paper",
        cascade="all, delete-orphan",
    )
    reading_set_memberships = relationship(
        "ReadingSetPaper",
        back_populates="paper",
        cascade="all, delete-orphan",
    )

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
    # Applied AI drafts annotate/highlight an entity, but only text saved from
    # Semantic Lens is allowed to replace the graph's current explanation.
    is_user_override = Column(Boolean, default=False, nullable=False)
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
    # Per-workflow model names, including extraction, injection, tooltip, and chat.
    models = Column(JSON, nullable=False, default=dict)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    def __repr__(self):
        return f"<LLMConfig(id={self.id}, provider={self.provider}, active={self.is_active})>"


class ReadingSet(Base):
    """Explicit named group of papers read together (multi-paper features scope)."""
    __tablename__ = "reading_sets"

    id = Column(String(36), primary_key=True)  # UUID
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    memberships = relationship(
        "ReadingSetPaper",
        back_populates="reading_set",
        cascade="all, delete-orphan",
        order_by="ReadingSetPaper.added_at",
    )
    alignments = relationship(
        "EntityAlignment",
        back_populates="reading_set",
        cascade="all, delete-orphan",
    )
    chat_conversations = relationship(
        "ChatConversation",
        back_populates="reading_set",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<ReadingSet(id={self.id[:8]}..., name={self.name})>"


class ReadingSetPaper(Base):
    """Membership of a paper in a reading set."""
    __tablename__ = "reading_set_papers"

    reading_set_id = Column(
        String(36),
        ForeignKey("reading_sets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    paper_id = Column(
        String(64),
        ForeignKey("papers.id", ondelete="CASCADE"),
        primary_key=True,
    )
    added_at = Column(DateTime, default=utcnow, nullable=False)

    reading_set = relationship("ReadingSet", back_populates="memberships")
    paper = relationship("Paper", back_populates="reading_set_memberships")

    __table_args__ = (
        Index("idx_reading_set_paper_paper", "paper_id"),
    )

    def __repr__(self):
        return f"<ReadingSetPaper(reading_set_id={self.reading_set_id[:8]}..., paper_id={self.paper_id[:8]}...)>"


class EntityAlignment(Base):
    """Cross-paper term correspondence inside one reading set.

    The paper pair is stored in canonical orientation (paper_a_id < paper_b_id)
    so a pair of subjects has exactly one row per reading set. Labels are
    denormalized so the link can be shown without parsing the other paper's
    knowledge graph.
    """
    __tablename__ = "entity_alignments"

    id = Column(String(36), primary_key=True)  # UUID
    reading_set_id = Column(
        String(36),
        ForeignKey("reading_sets.id", ondelete="CASCADE"),
        nullable=False,
    )
    paper_a_id = Column(String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    subject_a_id = Column(String(128), nullable=False)
    label_a = Column(String(512), nullable=False)
    paper_b_id = Column(String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    subject_b_id = Column(String(128), nullable=False)
    label_b = Column(String(512), nullable=False)
    method = Column(String(16), nullable=False)  # deterministic | llm
    score = Column(Float, nullable=False, default=0.0)
    confidence = Column(String(8), nullable=False)  # high | medium | low
    status = Column(String(16), nullable=False, default="auto")
    rationale = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    reading_set = relationship("ReadingSet", back_populates="alignments")

    __table_args__ = (
        CheckConstraint("method IN ('deterministic', 'llm')", name="ck_entity_alignment_method"),
        CheckConstraint(
            "confidence IN ('high', 'medium', 'low')",
            name="ck_entity_alignment_confidence",
        ),
        CheckConstraint(
            "status IN ('auto', 'confirmed', 'rejected', 'stale')",
            name="ck_entity_alignment_status",
        ),
        UniqueConstraint(
            "reading_set_id",
            "paper_a_id",
            "subject_a_id",
            "paper_b_id",
            "subject_b_id",
            name="uq_entity_alignment_pair",
        ),
        Index("idx_entity_alignment_set_paper_a", "reading_set_id", "paper_a_id"),
        Index("idx_entity_alignment_set_paper_b", "reading_set_id", "paper_b_id"),
    )

    def __repr__(self):
        return (
            f"<EntityAlignment(id={self.id[:8]}..., "
            f"{self.paper_a_id[:8]}.../{self.subject_a_id} ~ "
            f"{self.paper_b_id[:8]}.../{self.subject_b_id})>"
        )


class CitationLink(Base):
    """Cached resolution of one bibliography citation onto a library paper.

    A row records where a `[N]` citation in paper A points inside paper B
    (a section, a specific passage, or nothing locatable). The resolution is
    produced lazily by a single LLM call and is only valid for the HTML
    version of B it was computed against; a recompile of B invalidates it.
    """
    __tablename__ = "citation_links"

    id = Column(String(36), primary_key=True)  # UUID
    paper_id = Column(String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    cite_key = Column(String(255), nullable=False)
    target_paper_id = Column(
        String(64),
        ForeignKey("papers.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_kind = Column(String(16), nullable=False)  # section | passage | none
    target_section_id = Column(String(128), nullable=True)
    target_dom_node_id = Column(String(128), nullable=True)
    quote = Column(Text, nullable=True)  # exact substring for flash-highlight
    confidence = Column(String(8), nullable=False)  # high | medium | low
    target_html_version = Column(String(64), nullable=True)
    resolved_at = Column(DateTime, default=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "target_kind IN ('section', 'passage', 'none')",
            name="ck_citation_link_target_kind",
        ),
        CheckConstraint(
            "confidence IN ('high', 'medium', 'low')",
            name="ck_citation_link_confidence",
        ),
        UniqueConstraint(
            "paper_id",
            "cite_key",
            "target_paper_id",
            name="uq_citation_link_pair",
        ),
        Index("idx_citation_link_paper_key", "paper_id", "cite_key"),
    )

    def __repr__(self):
        return (
            f"<CitationLink(id={self.id[:8]}..., "
            f"{self.paper_id[:8]}.../{self.cite_key} -> "
            f"{self.target_paper_id[:8]}.../{self.target_kind})>"
        )


class ChatConversation(Base):
    """Named chat owned by the current user, scoped to one paper or one reading set."""
    __tablename__ = "chat_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paper_id = Column(String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=True)
    reading_set_id = Column(
        String(36),
        ForeignKey("reading_sets.id", ondelete="CASCADE"),
        nullable=True,
    )
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    paper = relationship("Paper", back_populates="chat_conversations")
    reading_set = relationship("ReadingSet", back_populates="chat_conversations")
    user = relationship("User", back_populates="chat_conversations")
    messages = relationship(
        "ChatMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ChatMessage.id",
    )

    __table_args__ = (
        CheckConstraint(
            "(paper_id IS NULL) != (reading_set_id IS NULL)",
            name="ck_chat_conversation_scope",
        ),
        Index("idx_chat_conversation_paper_user", "paper_id", "user_id"),
        Index("idx_chat_conversation_reading_set_user", "reading_set_id", "user_id"),
    )


class ChatMessage(Base):
    """Persisted user or assistant message with immutable context evidence."""
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(
        Integer,
        ForeignKey("chat_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    role = Column(String(16), nullable=False)
    content = Column(Text, nullable=False)
    context_snapshot = Column(JSON, nullable=True)
    citations = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime, default=utcnow, nullable=False)

    conversation = relationship("ChatConversation", back_populates="messages")
    action = relationship(
        "ChatAction",
        back_populates="source_message",
        cascade="all, delete-orphan",
        uselist=False,
    )

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_chat_message_role"),
        Index("idx_chat_message_conversation_id", "conversation_id", "id"),
    )


class ChatAction(Base):
    """Two-phase semantic definition proposal attached to an assistant message."""
    __tablename__ = "chat_actions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_message_id = Column(
        Integer,
        ForeignKey("chat_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    subject_id = Column(String(128), nullable=False)
    base_definition = Column(Text, nullable=True)
    proposed_definition = Column(Text, nullable=False)
    knowledge_graph_version = Column(String(64), nullable=True)
    status = Column(String(16), nullable=False, default="pending")
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    source_message = relationship("ChatMessage", back_populates="action")

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'confirmed', 'rejected', 'stale')",
            name="ck_chat_action_status",
        ),
        UniqueConstraint("source_message_id", name="uq_chat_action_source_message"),
    )
