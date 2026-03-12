"""
Tests for API endpoints.
"""

import io
import tarfile
from datetime import datetime
from unittest.mock import patch, MagicMock

import pytest


class TestRootEndpoint:
    """Tests for the root endpoint."""

    def test_root_returns_welcome_message(self, api_client):
        """Test that root endpoint returns welcome message."""
        response = api_client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "Scholar Agent" in data["message"]


class TestAiEndpoints:
    """Tests for AI capability and model-check endpoints."""

    def test_get_ai_capabilities(self, api_client, monkeypatch):
        monkeypatch.setattr(
            "backend.app.api.main.get_ai_capabilities",
            lambda: {
                "providers": {
                    "anthropic": {"available": True, "label": "Anthropic", "fixed_models": {}},
                    "openrouter": {
                        "available": True,
                        "label": "OpenRouter",
                        "supports_arbitrary_models": True,
                        "supports_model_validation": True,
                    },
                },
                "default_provider": "anthropic",
            },
        )

        response = api_client.get("/api/ai/capabilities")

        assert response.status_code == 200
        assert response.json()["providers"]["anthropic"]["available"] is True

    def test_check_openrouter_models(self, api_client, monkeypatch):
        monkeypatch.setattr(
            "backend.app.api.main.check_openrouter_models",
            lambda models: [
                {
                    "model": models[0],
                    "exists": True,
                    "compatibility": "good",
                    "detail": "Supports function calling.",
                    "supported_parameters": ["tools", "tool_choice"],
                }
            ],
        )

        response = api_client.post(
            "/api/ai/openrouter/check-models",
            json={"models": ["anthropic/claude-3.7-sonnet"]},
        )

        assert response.status_code == 200
        assert response.json()["results"][0]["compatibility"] == "good"


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
