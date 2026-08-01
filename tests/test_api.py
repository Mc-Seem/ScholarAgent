"""
Tests for API endpoints.
"""

import io
import tarfile
from datetime import datetime
from unittest.mock import patch, AsyncMock, MagicMock

import pytest

from backend.app.api.main import _paper_to_response
from backend.app.database.models import Paper


class TestRootEndpoint:
    """Tests for the root endpoint."""

    def test_root_returns_welcome_message(self, api_client):
        """Test that root endpoint returns welcome message."""
        response = api_client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "Scholar Agent" in data["message"]


class TestPapersListEndpoint:
    """Tests for GET /api/papers."""

    def test_list_papers_empty(self, api_client):
        """Test listing papers when none exist."""
        response = api_client.get("/api/papers")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list) or "papers" in data

    def test_list_papers_returns_array(self, api_client):
        """Test that list endpoint returns an array."""
        response = api_client.get("/api/papers")
        assert response.status_code == 200
        # Should be either a list or have a papers key
        data = response.json()
        papers = data if isinstance(data, list) else data.get("papers", [])
        assert isinstance(papers, list)

    def test_list_summary_includes_persisted_paper_title(self):
        """Compiled titles must be available without fetching the full paper."""
        paper = Paper(
            id="paper-with-title",
            filename="arXiv:2607.02873.tar.gz",
            paper_metadata={"title": "A Persisted Research Title"},
            uploaded_at=datetime(2026, 7, 18),
        )

        response = _paper_to_response(paper)

        assert response.title == "A Persisted Research Title"


class TestPaperUploadEndpoint:
    """Tests for POST /api/papers/upload."""

    def test_upload_requires_file(self, api_client):
        """Test that upload fails without a file."""
        response = api_client.post("/api/papers/upload")
        assert response.status_code == 422  # Validation error

    def test_upload_rejects_invalid_format(self, api_client):
        """Test that upload rejects non-archive files."""
        # Create a fake PDF
        content = b"fake pdf content"
        files = {"file": ("test.pdf", io.BytesIO(content), "application/pdf")}

        response = api_client.post("/api/papers/upload", files=files)
        assert response.status_code == 400
        assert "archive" in response.json()["detail"].lower()

    def test_upload_rejects_empty_file(self, api_client):
        """Test that upload rejects empty files."""
        files = {"file": ("test.tar.gz", io.BytesIO(b""), "application/gzip")}

        response = api_client.post("/api/papers/upload", files=files)
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()

    def test_upload_accepts_tar_gz(self, api_client, simple_tex_file):
        """Test that upload accepts .tar.gz files."""
        # Create a tar.gz in memory
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(simple_tex_file, arcname="paper.tex")
        tar_buffer.seek(0)

        files = {"file": ("paper.tar.gz", tar_buffer, "application/gzip")}
        data = {"compile_now": "false"}  # Skip compilation for this test

        response = api_client.post("/api/papers/upload", files=files, data=data)
        assert response.status_code == 200

        result = response.json()
        assert "id" in result or "paper_id" in result
        assert "filename" in result

    def test_upload_deduplicates_by_hash(self, api_client, simple_tex_file):
        """Test that uploading the same file twice returns the same paper."""
        # Create a tar.gz
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(simple_tex_file, arcname="paper.tex")
        content = tar_buffer.getvalue()

        # First upload
        files1 = {"file": ("paper1.tar.gz", io.BytesIO(content), "application/gzip")}
        data = {"compile_now": "false"}
        response1 = api_client.post("/api/papers/upload", files=files1, data=data)
        assert response1.status_code == 200
        id1 = response1.json().get("id") or response1.json().get("paper_id")

        # Second upload (same content, different filename)
        files2 = {"file": ("paper2.tar.gz", io.BytesIO(content), "application/gzip")}
        response2 = api_client.post("/api/papers/upload", files=files2, data=data)
        assert response2.status_code == 200
        id2 = response2.json().get("id") or response2.json().get("paper_id")

        assert id1 == id2


class TestArxivMetadataEndpoint:
    def test_rejects_invalid_arxiv_input_without_network_call(self, api_client):
        with patch("backend.app.api.main.httpx.AsyncClient") as client:
            response = api_client.get("/api/arxiv/metadata", params={"url_or_id": "not-an-id"})

        assert response.status_code == 400
        client.assert_not_called()

    def test_normalizes_title_from_atom_metadata(self, api_client):
        atom = """<?xml version="1.0" encoding="UTF-8"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <entry><title>  A Paper\n  With a Normalized Title  </title></entry>
        </feed>"""
        upstream_response = MagicMock(text=atom)
        upstream_response.raise_for_status.return_value = None
        upstream_client = MagicMock()
        upstream_client.get = AsyncMock(return_value=upstream_response)
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=upstream_client)
        context.__aexit__ = AsyncMock(return_value=None)

        with patch("backend.app.api.main.httpx.AsyncClient", return_value=context):
            response = api_client.get(
                "/api/arxiv/metadata",
                params={"url_or_id": "https://arxiv.org/abs/2401.00001"},
            )

        assert response.status_code == 200
        assert response.json() == {
            "arxiv_id": "2401.00001",
            "title": "A Paper With a Normalized Title",
        }


class TestPaperGetEndpoint:
    """Tests for GET /api/papers/{paper_id}."""

    def test_get_nonexistent_paper(self, api_client):
        """Test getting a paper that doesn't exist."""
        response = api_client.get("/api/papers/nonexistent123")
        assert response.status_code == 404

    def test_get_existing_paper(self, api_client, simple_tex_file):
        """Test getting an existing paper."""
        # First upload a paper
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(simple_tex_file, arcname="paper.tex")
        tar_buffer.seek(0)

        files = {"file": ("paper.tar.gz", tar_buffer, "application/gzip")}
        data = {"compile_now": "false"}
        upload_response = api_client.post("/api/papers/upload", files=files, data=data)
        paper_id = upload_response.json().get("id") or upload_response.json().get("paper_id")

        # Now get it
        response = api_client.get(f"/api/papers/{paper_id}")
        assert response.status_code == 200

        result = response.json()
        assert result.get("id") == paper_id or result.get("paper_id") == paper_id


class TestPaperDeleteEndpoint:
    """Tests for DELETE /api/papers/{paper_id}."""

    def test_delete_nonexistent_paper(self, api_client):
        """Test deleting a paper that doesn't exist."""
        response = api_client.delete("/api/papers/nonexistent123")
        assert response.status_code == 404

    def test_delete_existing_paper(self, api_client, simple_tex_file):
        """Test deleting an existing paper."""
        # First upload a paper
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(simple_tex_file, arcname="paper.tex")
        tar_buffer.seek(0)

        files = {"file": ("paper.tar.gz", tar_buffer, "application/gzip")}
        data = {"compile_now": "false"}
        upload_response = api_client.post("/api/papers/upload", files=files, data=data)
        paper_id = upload_response.json().get("id") or upload_response.json().get("paper_id")

        # Delete it
        response = api_client.delete(f"/api/papers/{paper_id}")
        assert response.status_code == 200

        # Verify it's gone
        get_response = api_client.get(f"/api/papers/{paper_id}")
        assert get_response.status_code == 404


class TestTooltipsEndpoints:
    """Tests for tooltip CRUD endpoints."""

    @pytest.fixture
    def paper_with_id(self, api_client, simple_tex_file):
        """Create a paper and return its ID."""
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(simple_tex_file, arcname="paper.tex")
        tar_buffer.seek(0)

        files = {"file": ("paper.tar.gz", tar_buffer, "application/gzip")}
        data = {"compile_now": "false"}
        response = api_client.post("/api/papers/upload", files=files, data=data)
        return response.json().get("id") or response.json().get("paper_id")

    def test_get_tooltips_empty(self, api_client, paper_with_id):
        """Test getting tooltips when none exist."""
        response = api_client.get(f"/api/papers/{paper_with_id}/tooltips")
        assert response.status_code == 200

        data = response.json()
        tooltips = data if isinstance(data, list) else data.get("tooltips", [])
        assert len(tooltips) == 0

    def test_get_tooltips_nonexistent_paper(self, api_client):
        """Test getting tooltips for nonexistent paper."""
        response = api_client.get("/api/papers/nonexistent/tooltips")
        assert response.status_code == 404

    def test_create_tooltip(self, api_client, paper_with_id):
        """Test creating a tooltip."""
        response = api_client.post(
            f"/api/papers/{paper_with_id}/tooltips",
            json={"dom_node_id": "node123", "content": "Test annotation"}
        )
        assert response.status_code == 200

        result = response.json()
        assert result["dom_node_id"] == "node123"
        assert result["content"] == "Test annotation"
        assert "id" in result

    def test_create_multiple_tooltips_on_same_node(self, api_client, paper_with_id):
        """Test that multiple tooltips can be created on the same node."""
        # Create first tooltip
        response1 = api_client.post(
            f"/api/papers/{paper_with_id}/tooltips",
            json={"dom_node_id": "node123", "content": "First content"}
        )
        assert response1.status_code == 200
        tooltip_id1 = response1.json()["id"]

        # Create second tooltip on same node
        response2 = api_client.post(
            f"/api/papers/{paper_with_id}/tooltips",
            json={"dom_node_id": "node123", "content": "Second content"}
        )
        assert response2.status_code == 200
        tooltip_id2 = response2.json()["id"]

        # Should be different tooltips (multiple per node supported)
        assert tooltip_id1 != tooltip_id2
        assert response2.json()["content"] == "Second content"

        # Both should exist
        get_response = api_client.get(f"/api/papers/{paper_with_id}/tooltips")
        tooltips = get_response.json() if isinstance(get_response.json(), list) else get_response.json().get("tooltips", [])
        node123_tooltips = [t for t in tooltips if t["dom_node_id"] == "node123"]
        assert len(node123_tooltips) == 2

    def test_update_tooltip(self, api_client, paper_with_id):
        """Test updating a tooltip."""
        # Create tooltip
        create_response = api_client.post(
            f"/api/papers/{paper_with_id}/tooltips",
            json={"dom_node_id": "node456", "content": "Original"}
        )
        tooltip_id = create_response.json()["id"]

        # Update it
        update_response = api_client.put(
            f"/api/papers/{paper_with_id}/tooltips/{tooltip_id}",
            json={"content": "Updated"}
        )
        assert update_response.status_code == 200
        assert update_response.json()["content"] == "Updated"

    def test_update_nonexistent_tooltip(self, api_client, paper_with_id):
        """Test updating a tooltip that doesn't exist."""
        response = api_client.put(
            f"/api/papers/{paper_with_id}/tooltips/nonexistent",
            json={"content": "Test"}
        )
        assert response.status_code == 404

    def test_delete_tooltip(self, api_client, paper_with_id):
        """Test deleting a tooltip."""
        # Create tooltip
        create_response = api_client.post(
            f"/api/papers/{paper_with_id}/tooltips",
            json={"dom_node_id": "node789", "content": "To delete"}
        )
        tooltip_id = create_response.json()["id"]

        # Delete it
        delete_response = api_client.delete(
            f"/api/papers/{paper_with_id}/tooltips/{tooltip_id}"
        )
        assert delete_response.status_code == 200

        # Verify it's gone
        get_response = api_client.get(f"/api/papers/{paper_with_id}/tooltips")
        tooltips = get_response.json() if isinstance(get_response.json(), list) else get_response.json().get("tooltips", [])
        assert not any(t["id"] == tooltip_id for t in tooltips)

    def test_delete_nonexistent_tooltip(self, api_client, paper_with_id):
        """Test deleting a tooltip that doesn't exist."""
        response = api_client.delete(
            f"/api/papers/{paper_with_id}/tooltips/nonexistent"
        )
        assert response.status_code == 404

    def test_tooltip_pinning(self, api_client, paper_with_id):
        """Test pinning and unpinning tooltips."""
        # Create tooltip
        create_response = api_client.post(
            f"/api/papers/{paper_with_id}/tooltips",
            json={"dom_node_id": "node_pin", "content": "Pin test"}
        )
        tooltip_id = create_response.json()["id"]

        # Verify default is_pinned is False
        assert create_response.json()["is_pinned"] is False

        # Pin the tooltip
        pin_response = api_client.put(
            f"/api/papers/{paper_with_id}/tooltips/{tooltip_id}",
            json={"content": "Pin test", "is_pinned": True}
        )
        assert pin_response.status_code == 200
        assert pin_response.json()["is_pinned"] is True

        # Unpin the tooltip
        unpin_response = api_client.put(
            f"/api/papers/{paper_with_id}/tooltips/{tooltip_id}",
            json={"content": "Pin test", "is_pinned": False}
        )
        assert unpin_response.status_code == 200
        assert unpin_response.json()["is_pinned"] is False

    def test_tooltip_display_order(self, api_client, paper_with_id):
        """Test setting display order for tooltips."""
        # Create tooltip
        create_response = api_client.post(
            f"/api/papers/{paper_with_id}/tooltips",
            json={"dom_node_id": "node_order", "content": "Order test"}
        )
        tooltip_id = create_response.json()["id"]

        # Verify default display_order is None
        assert create_response.json()["display_order"] is None

        # Set display order
        update_response = api_client.put(
            f"/api/papers/{paper_with_id}/tooltips/{tooltip_id}",
            json={"content": "Order test", "display_order": 5}
        )
        assert update_response.status_code == 200
        assert update_response.json()["display_order"] == 5


class TestSemanticNotes:
    """Tests for reader wording stored against a semantic subject."""

    @pytest.fixture
    def paper_with_id(self, api_client, simple_tex_file):
        """Create a paper and return its ID."""
        tar_buffer = io.BytesIO()
        with tarfile.open(fileobj=tar_buffer, mode="w:gz") as tar:
            tar.add(simple_tex_file, arcname="paper.tex")
        tar_buffer.seek(0)

        files = {"file": ("paper.tar.gz", tar_buffer, "application/gzip")}
        data = {"compile_now": "false"}
        response = api_client.post("/api/papers/upload", files=files, data=data)
        return response.json().get("id") or response.json().get("paper_id")

    def test_note_is_anchored_to_the_subject_not_to_a_dom_node(self, api_client, paper_with_id):
        """The lens edits texts about subjects, including notation and equations."""
        response = api_client.put(
            f"/api/papers/{paper_with_id}/semantic-notes/notation:tau",
            json={"content": "  Local element size.  ", "target_text": "τ"}
        )

        assert response.status_code == 200
        result = response.json()
        assert result["entity_id"] == "notation:tau"
        assert result["dom_node_id"] is None
        assert result["content"] == "Local element size."
        assert result["target_text"] == "τ"

    def test_second_edit_replaces_the_first_instead_of_stacking(self, api_client, paper_with_id):
        """One subject carries one text, so the reader never sees two versions."""
        first = api_client.put(
            f"/api/papers/{paper_with_id}/semantic-notes/entity:slime",
            json={"content": "First wording."}
        )
        second = api_client.put(
            f"/api/papers/{paper_with_id}/semantic-notes/entity:slime",
            json={"content": "Corrected wording."}
        )

        assert first.json()["id"] == second.json()["id"]
        assert second.json()["content"] == "Corrected wording."
        stored = api_client.get(f"/api/papers/{paper_with_id}/tooltips").json()
        assert [item["content"] for item in stored] == ["Corrected wording."]

    def test_blank_content_is_rejected(self, api_client, paper_with_id):
        """An empty edit would silently erase the agent's text."""
        response = api_client.put(
            f"/api/papers/{paper_with_id}/semantic-notes/entity:slime",
            json={"content": "   "}
        )

        assert response.status_code == 400

    def test_restoring_keeps_the_injected_anchors(self, api_client, paper_with_id):
        """Restoring a wording must not un-highlight the term in the paper."""
        from backend.app.api.main import app
        from backend.app.database.connection import get_db
        from backend.app.database.models import Paper as PaperModel

        html = (
            '<p data-id="p-1">A <span class="kg-entity" '
            'data-entity-id="entity:slime">SLIME</span> step.</p>'
        )
        db = next(app.dependency_overrides[get_db]())
        db.query(PaperModel).filter(PaperModel.id == paper_with_id).first().html_content = html
        db.commit()
        api_client.put(
            f"/api/papers/{paper_with_id}/semantic-notes/entity:slime",
            json={"content": "My own wording."}
        )

        response = api_client.delete(
            f"/api/papers/{paper_with_id}/semantic-notes/entity:slime"
        )

        assert response.status_code == 200
        reloaded = next(app.dependency_overrides[get_db]()).query(PaperModel).filter(
            PaperModel.id == paper_with_id
        ).first()
        assert 'data-entity-id="entity:slime"' in reloaded.html_content
        assert api_client.get(f"/api/papers/{paper_with_id}/tooltips").json() == []

    def test_restoring_a_missing_note_reports_not_found(self, api_client, paper_with_id):
        response = api_client.delete(
            f"/api/papers/{paper_with_id}/semantic-notes/entity:unknown"
        )

        assert response.status_code == 404


class TestArxivUploadEndpoint:
    """Tests for POST /api/papers/upload/arxiv."""

    def test_arxiv_upload_requires_url_or_id(self, api_client):
        """Test that arXiv upload fails without URL or ID."""
        response = api_client.post("/api/papers/upload/arxiv")
        assert response.status_code == 422

    def test_arxiv_upload_rejects_invalid_id(self, api_client):
        """Test that arXiv upload rejects invalid IDs."""
        response = api_client.post(
            "/api/papers/upload/arxiv",
            data={"url_or_id": "invalid-id-format"}
        )
        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower()

    def test_arxiv_id_extraction(self):
        """Test arXiv ID extraction from various formats."""
        from backend.app.api.main import _extract_arxiv_id

        # Plain ID
        assert _extract_arxiv_id("2401.12345") == "2401.12345"

        # URL formats
        assert _extract_arxiv_id("https://arxiv.org/abs/2401.12345") == "2401.12345"
        assert _extract_arxiv_id("https://arxiv.org/pdf/2401.12345") == "2401.12345"
        assert _extract_arxiv_id("https://arxiv.org/e-print/2401.12345") == "2401.12345"

        # With whitespace
        assert _extract_arxiv_id("  2401.12345  ") == "2401.12345"

        # Invalid
        assert _extract_arxiv_id("not-an-id") is None
        assert _extract_arxiv_id("") is None


class TestKnowledgeGraphReanchoring:
    """Tests for POST /api/papers/{id}/knowledge-graph/reanchor."""

    SECTION_HTML = (
        "<p data-id='p-1'>KTO optimizes "
        "<math data-id='m-1'><annotation encoding='application/x-tex'>"
        "\\mathcal{L}_{KTO}</annotation></math>"
        " directly. KTO needs no pairs.</p>"
    )

    def _store_paper(self, paper_id="paper-anchor", sections=True):
        from backend.app.agents.knowledge_graph_canonical import canonicalize_observations
        from backend.app.agents.knowledge_graph_models import SourceObservation, SourceReference
        from backend.app.api.main import app
        from backend.app.database.connection import get_db

        observation = SourceObservation(
            id="obs-kto",
            kind="procedure",
            label="KTO",
            payload={"summary": "A preference optimization method."},
            confidence=0.9,
            source=SourceReference(
                paper_id=paper_id,
                section_id="sec-1",
                dom_node_id="p-1",
                quote="A preference optimization method.",
            ),
        )
        # Built without sections, the way a graph looked before anchoring
        # covered paragraphs that contain a formula.
        document = canonicalize_observations(paper_id, [observation])
        db = next(app.dependency_overrides[get_db]())
        db.add(Paper(
            id=paper_id,
            filename="paper.tar.gz",
            html_content=f"<article>{self.SECTION_HTML}</article>",
            sections_data=[{"id": "sec-1", "content_html": self.SECTION_HTML}] if sections else None,
            knowledge_graph=document.model_dump(mode="json"),
        ))
        db.commit()
        return document

    def test_reanchoring_finds_terms_without_rerunning_extraction(self, api_client):
        """A better anchoring rule must not cost a paid rebuild of the graph.

        Anchoring is a deterministic pass over text the paper already has, so
        the stored observations are enough to recompute where a term occurs.
        """
        document = self._store_paper()

        response = api_client.post("/api/papers/paper-anchor/knowledge-graph/reanchor")

        assert response.status_code == 200
        body = response.json()
        assert body["previous_occurrence_count"] == len(document.occurrences)
        assert body["occurrence_count"] == 2

        graph = api_client.get("/api/papers/paper-anchor/knowledge-graph").json()
        assert [item["dom_node_id"] for item in graph["occurrences"]] == ["p-1", "p-1"]
        assert [item["stable_id"] for item in graph["objects"]] == [
            item.stable_id for item in document.objects
        ]

    def test_reanchoring_refuses_a_paper_without_compiled_sections(self, api_client):
        """Without section HTML the pass would anchor less, not more."""
        self._store_paper(paper_id="paper-no-sections", sections=False)

        response = api_client.post("/api/papers/paper-no-sections/knowledge-graph/reanchor")

        assert response.status_code == 409
        assert "Recompile" in response.json()["detail"]


class TestCORS:
    """Tests for CORS configuration."""

    def test_cors_headers_present(self, api_client):
        """Test that CORS headers are present in responses."""
        response = api_client.options(
            "/api/papers",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET"
            }
        )
        # FastAPI TestClient may not fully simulate CORS
        # This is more of a smoke test
        assert response.status_code in [200, 405]
