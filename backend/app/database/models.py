from datetime import datetime, UTC
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
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


class ChatConversation(Base):
    """Named, paper-scoped chat owned by the current user."""
    __tablename__ = "chat_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    paper_id = Column(String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, default=1)
    title = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    paper = relationship("Paper", back_populates="chat_conversations")
    user = relationship("User", back_populates="chat_conversations")
    messages = relationship(
        "ChatMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ChatMessage.id",
    )

    __table_args__ = (
        Index("idx_chat_conversation_paper_user", "paper_id", "user_id"),
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
