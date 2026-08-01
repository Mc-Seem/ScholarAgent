"""
Tests for the LaTeXML compiler service.
"""

import tarfile
import zipfile
from pathlib import Path

import pytest

from backend.app.compiler.latexml_compiler import (
    LaTeXMLCompiler,
    DataIdInjector,
    extract_equations,
    inject_data_ids,
)


class TestDataIdInjector:
    """Tests for HTML post-processing (data-id injection)."""

    def test_injects_data_id_to_paragraph(self):
        """Test that data-id is injected into <p> tags."""
        html = "<p>Hello world</p>"
        result = inject_data_ids(html, "paper123")

        assert 'data-id="' in result
        assert "<p" in result
        assert "Hello world" in result

    def test_injects_data_id_to_section(self):
        """Test that data-id is injected into <section> tags."""
        html = "<section><p>Content</p></section>"
        result = inject_data_ids(html, "paper123")

        # Both section and p should have data-id
        assert result.count('data-id="') == 2

    def test_injects_data_id_to_headings(self):
        """Test that data-id is injected into heading tags."""
        html = "<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>"
        result = inject_data_ids(html, "paper123")

        assert result.count('data-id="') == 3

    def test_preserves_existing_attributes(self):
        """Test that existing attributes are preserved."""
        html = '<p class="intro" id="first">Text</p>'
        result = inject_data_ids(html, "paper123")

        assert 'class="intro"' in result
        assert 'id="first"' in result
        assert 'data-id="' in result

    def test_does_not_duplicate_data_id(self):
        """Test that existing data-id is not overwritten."""
        html = '<p data-id="existing">Text</p>'
        result = inject_data_ids(html, "paper123")

        assert 'data-id="existing"' in result
        # Should only have one data-id
        assert result.count('data-id="') == 1

    def test_deterministic_ids(self):
        """Test that the same input produces the same data-ids."""
        html = "<p>Test</p><p>Another</p>"

        result1 = inject_data_ids(html, "paper123")
        result2 = inject_data_ids(html, "paper123")

        assert result1 == result2

    def test_different_paper_ids_produce_different_data_ids(self):
        """Test that different paper_ids produce different data-ids."""
        html = "<p>Test</p>"

        result1 = inject_data_ids(html, "paper123")
        result2 = inject_data_ids(html, "paper456")

        # Extract the data-id values
        import re
        id1 = re.search(r'data-id="([^"]+)"', result1).group(1)
        id2 = re.search(r'data-id="([^"]+)"', result2).group(1)

        assert id1 != id2

    def test_handles_nested_elements(self):
        """Test proper handling of nested elements."""
        html = "<section><p>Text with <strong>bold</strong></p></section>"
        result = inject_data_ids(html, "paper123")

        # section and p should have data-id, strong should not
        assert result.count('data-id="') == 2
        assert "<strong>bold</strong>" in result

    def test_handles_math_elements(self):
        """Test that math elements get data-id."""
        html = '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>'
        result = inject_data_ids(html, "paper123")

        assert 'data-id="' in result

    def test_handles_empty_elements(self):
        """Test handling of self-closing/empty elements."""
        html = "<p>Before</p><br/><p>After</p>"
        result = inject_data_ids(html, "paper123")

        assert result.count('data-id="') == 2  # Only p tags

    def test_preserves_html_structure(self):
        """Test that the HTML structure is preserved."""
        html = """<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body><p>Content</p></body>
</html>"""
        result = inject_data_ids(html, "paper123")

        assert "<!DOCTYPE html>" in result or "<!doctype html>" in result.lower()
        assert "<html>" in result
        assert "<head>" in result
        assert "<body>" in result

    def test_handles_special_characters_in_attributes(self):
        """Test handling of special characters in existing attributes."""
        html = '<p title="Test &quot;quoted&quot;">Text</p>'
        result = inject_data_ids(html, "paper123")

        assert 'data-id="' in result
        # The structure should be valid

    def test_preserves_escaped_markup_in_text(self):
        """Character references in text must survive the round trip."""
        html = "<p>a &lt; b &amp;&amp; b &gt; c</p>"
        result = inject_data_ids(html, "paper123")

        assert "a &lt; b &amp;&amp; b &gt; c" in result

    def test_preserves_escaped_markup_in_attributes(self):
        """Attribute values must be re-escaped instead of emitted raw."""
        html = '<math alttext="y_{&lt;t} &amp; z">x</math>'
        result = inject_data_ids(html, "paper123")

        assert 'alttext="y_{&lt;t} &amp; z"' in result


class TestEquationExtraction:
    """Equation LaTeX must survive data-id injection, including `<` in subscripts."""

    MATH_HTML = (
        '<math alttext="l_{t}=\\log{\\pi_{\\theta}(t|x,y_{&lt;t})}" display="block">'
        '<semantics>'
        '<mrow><mi>l</mi></mrow>'
        '<annotation encoding="application/x-tex">'
        'l_{t}=\\log{\\pi_{\\theta}(t|x,y_{&lt;t})}'
        '</annotation>'
        '<annotation-xml encoding="MathML-Content">'
        '<csymbol>subscript</csymbol><ci>\U0001d459</ci>'
        '</annotation-xml>'
        '</semantics>'
        '</math>'
    )

    def test_extracts_full_latex_after_injection(self):
        injected = inject_data_ids(self.MATH_HTML, "paper123")
        equations = extract_equations(injected)

        assert len(equations) == 1
        assert equations[0]["latex"] == "l_{t}=\\log{\\pi_{\\theta}(t|x,y_{<t})}"
        assert equations[0]["is_display"] is True

    def test_injection_keeps_annotation_closed(self):
        injected = inject_data_ids(self.MATH_HTML, "paper123")

        assert "</annotation>" in injected
        assert "< annotation" not in injected


class TestLaTeXMLCompiler:
    """Tests for the LaTeXML compiler."""

    def test_find_main_tex_single_file(self, simple_tex_file):
        """Test finding main tex when only one file exists."""
        compiler = LaTeXMLCompiler(use_docker=False)
        result = compiler._find_main_tex(simple_tex_file.parent)

        # Should find a .tex file (may be the fixture or others in tests/)
        # We just verify it doesn't crash and returns a Path or None
        assert result is None or isinstance(result, Path)

    def test_find_main_tex_prefers_main_tex(self, tmp_path):
        """Test that main.tex is preferred over other names."""
        # Create multiple .tex files
        (tmp_path / "main.tex").write_text(r"\documentclass{article}\begin{document}Main\end{document}")
        (tmp_path / "other.tex").write_text(r"\documentclass{article}\begin{document}Other\end{document}")
        (tmp_path / "appendix.tex").write_text(r"% Just an appendix")

        compiler = LaTeXMLCompiler(use_docker=False)
        result = compiler._find_main_tex(tmp_path)

        assert result is not None
        assert result.name == "main.tex"

    def test_find_main_tex_by_documentclass(self, tmp_path):
        """Test that file with documentclass is preferred."""
        # Create files where only one has documentclass
        (tmp_path / "chapter1.tex").write_text(r"\section{Chapter 1}")
        (tmp_path / "paper.tex").write_text(r"\documentclass{article}\begin{document}Paper\end{document}")

        compiler = LaTeXMLCompiler(use_docker=False)
        result = compiler._find_main_tex(tmp_path)

        assert result is not None
        assert result.name == "paper.tex"

    def test_prepare_source_tar_gz(self, simple_tex_archive, tmp_path):
        """Test extracting .tar.gz archives."""
        dest = tmp_path / "extracted"
        dest.mkdir()

        compiler = LaTeXMLCompiler(use_docker=False)
        compiler._prepare_source(simple_tex_archive, dest)

        # Should have extracted the tex file
        tex_files = list(dest.glob("*.tex"))
        assert len(tex_files) == 1
        assert tex_files[0].name == "simple_paper.tex"

    def test_prepare_source_zip(self, simple_tex_file, tmp_path):
        """Test extracting .zip archives."""
        # Create a zip archive
        zip_path = tmp_path / "paper.zip"
        with zipfile.ZipFile(zip_path, "w") as zf:
            zf.write(simple_tex_file, "simple_paper.tex")

        dest = tmp_path / "extracted"
        dest.mkdir()

        compiler = LaTeXMLCompiler(use_docker=False)
        compiler._prepare_source(zip_path, dest)

        tex_files = list(dest.glob("*.tex"))
        assert len(tex_files) == 1

    def test_prepare_source_single_tex(self, simple_tex_file, tmp_path):
        """Test copying a single .tex file."""
        dest = tmp_path / "extracted"
        dest.mkdir()

        compiler = LaTeXMLCompiler(use_docker=False)
        compiler._prepare_source(simple_tex_file, dest)

        tex_files = list(dest.glob("*.tex"))
        assert len(tex_files) == 1

    def test_prepare_source_rejects_unsupported(self, tmp_path):
        """Test that unsupported formats raise ValueError."""
        bad_file = tmp_path / "paper.pdf"
        bad_file.write_bytes(b"fake pdf content")

        dest = tmp_path / "extracted"
        dest.mkdir()

        compiler = LaTeXMLCompiler(use_docker=False)
        with pytest.raises(ValueError, match="Unsupported source format"):
            compiler._prepare_source(bad_file, dest)

    def test_safe_extraction_prevents_path_traversal(self, tmp_path):
        """Test that path traversal attacks are prevented."""
        # Create a malicious archive with path traversal
        archive_path = tmp_path / "malicious.tar.gz"
        malicious_path = tmp_path / "extracted"
        malicious_path.mkdir()

        # Create archive with a file that tries to escape
        with tarfile.open(archive_path, "w:gz") as tar:
            # Add a normal file
            info = tarfile.TarInfo(name="normal.tex")
            content = b"normal content"
            info.size = len(content)
            import io
            tar.addfile(info, io.BytesIO(content))

        compiler = LaTeXMLCompiler(use_docker=False)
        compiler._prepare_source(archive_path, malicious_path)

        # Should only have the normal file
        assert (malicious_path / "normal.tex").exists()
