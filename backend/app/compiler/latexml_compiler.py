"""
LaTeXML Compiler Service

Compiles LaTeX sources to HTML5 + MathML using LaTeXML (via Docker or local installation).
Post-processes HTML to inject stable data-id attributes for tooltip anchoring.
Extracts structured metadata (sections, equations, citations) at compile time.
"""

import contextlib
import hashlib
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, List, Dict, Any
from html.parser import HTMLParser

from bs4 import BeautifulSoup


# =============================================================================
# Compilation Result
# =============================================================================

@dataclass
class CompilationResult:
    """Structured result from LaTeXML compilation."""
    html_content: str                           # Compiled HTML with data-ids
    sections: List[Dict[str, Any]] = field(default_factory=list)    # Section hierarchy
    equations: List[Dict[str, Any]] = field(default_factory=list)   # Equations with LaTeX
    citations: List[Dict[str, Any]] = field(default_factory=list)   # Bibliography entries
    metadata: Optional[Dict[str, Any]] = None   # Title, authors, abstract
    latex_source: Optional[str] = None          # Raw main.tex content


# =============================================================================
# Metadata Extraction Functions
# =============================================================================

def extract_sections(html: str) -> List[Dict[str, Any]]:
    """
    Extract hierarchical section structure from compiled HTML.

    This replaces the frontend parseTOC logic - both TOC and agents
    will use this pre-extracted data.
    """
    soup = BeautifulSoup(html, 'html.parser')
    headings = soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], attrs={'data-id': True})

    sections = []
    stack: List[Dict[str, Any]] = []  # Track parent sections

    # Build a list of all heading positions for content extraction
    heading_positions = []
    for h in headings:
        heading_positions.append(h)

    for i, heading in enumerate(headings):
        level = int(heading.name[1])  # h1 -> 1, h2 -> 2
        data_id = heading.get('data-id')

        # Find parent in stack
        while stack and stack[-1]['level'] >= level:
            stack.pop()

        parent_id = stack[-1]['id'] if stack else None

        # Extract content between this heading and the next heading (anywhere in document)
        # We need to collect siblings, but stop at any element containing a heading
        content_nodes = []

        # Use find_next_siblings() but check if any sibling CONTAINS a heading
        for sibling in heading.find_next_siblings():
            # Skip navigable strings (whitespace, text nodes)
            if not hasattr(sibling, 'name') or sibling.name is None:
                continue

            # Stop if this sibling IS a heading
            if sibling.name in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
                break

            # Stop if this sibling CONTAINS a heading (e.g., div wrapping abstract section)
            if sibling.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
                break

            # Collect block-level elements
            if sibling.name in ['p', 'div', 'section', 'figure', 'table', 'ul', 'ol', 'dl', 'blockquote', 'pre', 'span']:
                content_nodes.append(str(sibling))

        # Get title - preserve MathML but extract text for plain title
        title_text = heading.get_text().strip()

        # Get inner HTML of heading, removing only LaTeX text annotations
        # We need innerHTML (contents only), not outerHTML (with the tag)
        # Keep ltx_tag spans as they contain useful section numbers (e.g., "3.2.3")
        title_clone = BeautifulSoup(str(heading), 'html.parser')
        heading_tag = title_clone.find(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
        if heading_tag:
            # Remove <text> elements (LaTeX annotations in MathML)
            for text_elem in heading_tag.find_all('text'):
                text_elem.decompose()
            # Get inner HTML by joining all children
            title_html = ''.join(str(child) for child in heading_tag.children).strip()
        else:
            title_html = title_text

        section = {
            'id': data_id,
            'title': title_text,
            'title_html': title_html,  # Preserve MathML in titles
            'level': level,
            'parent_id': parent_id,
            'content_html': '\n'.join(content_nodes),
        }

        sections.append(section)
        stack.append({'id': data_id, 'level': level})

    return sections


def extract_equations(html: str) -> List[Dict[str, Any]]:
    """
    Extract all equation blocks with their LaTeX source.

    Useful for agents to analyze equations without re-parsing.
    """
    soup = BeautifulSoup(html, 'html.parser')
    equations = []

    for math_tag in soup.find_all('math', attrs={'data-id': True}):
        math_id = math_tag.get('data-id')

        # Try to extract LaTeX from MathML annotation
        latex = _extract_latex_from_mathml(math_tag)

        # Determine if display or inline
        display_attr = math_tag.get('display', '')
        is_display = display_attr == 'block'

        equations.append({
            'id': math_id,
            'latex': latex,
            'is_display': is_display,
            'mathml': str(math_tag),
        })

    return equations


def _extract_latex_from_mathml(math_tag) -> Optional[str]:
    """Extract LaTeX from MathML annotation if present."""
    # Check for <annotation encoding="application/x-tex">
    annotation = math_tag.find('annotation', {'encoding': 'application/x-tex'})
    if annotation:
        return annotation.get_text()

    # Also check for TeX annotation without full MIME type
    annotation = math_tag.find('annotation', {'encoding': 'TeX'})
    if annotation:
        return annotation.get_text()

    return None


def extract_citations(html: str) -> List[Dict[str, Any]]:
    """
    Extract bibliography entries from compiled HTML.

    Useful for future citation analysis and Semantic Scholar integration.
    """
    soup = BeautifulSoup(html, 'html.parser')
    citations = []

    # LaTeXML typically puts bibliography in a section with class ltx_bibliography
    bib_section = soup.find(['section', 'div'], class_='ltx_bibliography')

    if bib_section:
        for entry in bib_section.find_all('li', class_='ltx_bibitem'):
            cite_key = entry.get('id', '')
            # Clean up key: bib.Author2023 -> Author2023
            if cite_key.startswith('bib.'):
                cite_key = cite_key[4:]

            cite_text = entry.get_text().strip()
            dom_id = entry.get('data-id')

            citations.append({
                'key': cite_key,
                'text': cite_text,
                'dom_node_id': dom_id,
            })

    return citations


def extract_document_metadata(html: str) -> Optional[Dict[str, Any]]:
    """
    Extract paper metadata (title, authors, abstract) if present.

    LaTeXML often includes this in the document header.
    """
    soup = BeautifulSoup(html, 'html.parser')
    metadata: Dict[str, Any] = {}

    # Extract title - LaTeXML uses ltx_title class
    title_tag = soup.find(['h1', 'h2'], class_='ltx_title')
    if title_tag:
        metadata['title'] = title_tag.get_text().strip()

    # Extract authors - LaTeXML uses ltx_creator or ltx_personname
    authors = []
    for author_tag in soup.find_all(['span', 'div'], class_=['ltx_creator', 'ltx_personname']):
        author_text = author_tag.get_text().strip()
        if author_text and author_text not in authors:
            authors.append(author_text)
    if authors:
        metadata['authors'] = authors

    # Extract abstract - LaTeXML uses ltx_abstract class
    abstract_div = soup.find(['div', 'section'], class_='ltx_abstract')
    if abstract_div:
        # Get the content, skipping the "Abstract" heading if present
        abstract_text = abstract_div.get_text().strip()
        # Remove common prefixes
        for prefix in ['Abstract', 'ABSTRACT', 'Abstract.', 'Abstract:']:
            if abstract_text.startswith(prefix):
                abstract_text = abstract_text[len(prefix):].strip()
        metadata['abstract'] = abstract_text

    return metadata if metadata else None


def escape_markup(value: str) -> str:
    """Escape text or attribute content so a re-parse rebuilds the same tree.

    LaTeXML writes TeX sources such as ``y_{&lt;t}`` into ``alttext`` attributes and
    ``<annotation encoding="application/x-tex">`` nodes. HTMLParser hands those values
    over already decoded, so emitting them verbatim would leak a bare ``<`` into the
    markup and truncate the equation on the next parse.
    """
    return (
        value.replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
    )


class DataIdInjector(HTMLParser):
    """
    HTML post-processor that injects stable data-id attributes into content nodes.

    Target elements: p, section, h1-h6, math, span (with specific classes), figure, table
    """

    INJECTABLE_TAGS = {'p', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                       'math', 'figure', 'table', 'li', 'blockquote', 'pre'}

    def __init__(self, paper_id: str):
        # Keep character references intact: they are re-emitted verbatim by
        # handle_entityref/handle_charref instead of being decoded into raw text.
        super().__init__(convert_charrefs=False)
        self.paper_id = paper_id
        self.output: list[str] = []
        self.node_counters: dict[str, int] = {}
        self.path_stack: list[str] = []

    def _generate_data_id(self, tag: str) -> str:
        """Generate a stable, deterministic data-id based on paper_id and node path."""
        # Increment counter for this tag type
        self.node_counters[tag] = self.node_counters.get(tag, 0) + 1
        count = self.node_counters[tag]

        # Create path-based identifier
        path = "/".join(self.path_stack + [f"{tag}[{count}]"])

        # Generate hash
        hash_input = f"{self.paper_id}:{path}"
        return hashlib.sha256(hash_input.encode()).hexdigest()[:16]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]):
        self.path_stack.append(tag)

        attrs_dict = dict(attrs)

        # Inject data-id for injectable tags that don't already have one
        if tag in self.INJECTABLE_TAGS and 'data-id' not in attrs_dict:
            data_id = self._generate_data_id(tag)
            attrs_dict['data-id'] = data_id

        # Reconstruct tag
        attr_str = ''
        for key, value in attrs_dict.items():
            if value is None:
                attr_str += f' {key}'
            else:
                attr_str += f' {key}="{escape_markup(value)}"'

        self.output.append(f'<{tag}{attr_str}>')

    def handle_endtag(self, tag: str):
        if self.path_stack and self.path_stack[-1] == tag:
            self.path_stack.pop()
        self.output.append(f'</{tag}>')

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, Optional[str]]]):
        attrs_dict = dict(attrs)

        if tag in self.INJECTABLE_TAGS and 'data-id' not in attrs_dict:
            data_id = self._generate_data_id(tag)
            attrs_dict['data-id'] = data_id

        attr_str = ''
        for key, value in attrs_dict.items():
            if value is None:
                attr_str += f' {key}'
            else:
                attr_str += f' {key}="{escape_markup(value)}"'

        self.output.append(f'<{tag}{attr_str} />')

    def handle_data(self, data: str):
        self.output.append(data)

    def handle_comment(self, data: str):
        self.output.append(f'<!--{data}-->')

    def handle_decl(self, decl: str):
        self.output.append(f'<!{decl}>')

    def handle_pi(self, data: str):
        self.output.append(f'<?{data}>')

    def handle_entityref(self, name: str):
        self.output.append(f'&{name};')

    def handle_charref(self, name: str):
        self.output.append(f'&#{name};')

    def get_result(self) -> str:
        return ''.join(self.output)


def inject_data_ids(html: str, paper_id: str) -> str:
    """Inject stable data-id attributes into HTML content nodes."""
    injector = DataIdInjector(paper_id)
    injector.feed(html)
    return injector.get_result()


class LaTeXMLCompiler:
    """
    Compiles LaTeX sources to HTML5 using LaTeXML.

    Supports both Docker-based compilation (engrafo) and local latexml installation.
    """

    def __init__(self, use_docker: bool = True, docker_image: str = "latexml/ar5ivist"):
        self.use_docker = use_docker
        self.docker_image = docker_image

    def compile(self, source_path: Path, paper_id: str, assets_dir: Optional[Path] = None) -> CompilationResult:
        """
        Compile LaTeX source to HTML with metadata extraction.

        Args:
            source_path: Path to .tar.gz, .zip, or .tex file
            paper_id: Unique identifier for the paper (used for data-id generation)
            assets_dir: Optional directory to save generated assets (images, CSS, etc.)

        Returns:
            CompilationResult with HTML, sections, equations, citations, and metadata
        """
        with self._work_dir() as work_dir:
            source_dir = work_dir / "source"
            output_dir = work_dir / "output"
            source_dir.mkdir()
            output_dir.mkdir()

            # Extract or copy source
            self._prepare_source(source_path, source_dir)

            # Find main tex file
            main_tex = self._find_main_tex(source_dir)
            if not main_tex:
                raise ValueError("No main .tex file found in source")

            # Read LaTeX source for agent context
            latex_source: Optional[str] = None
            try:
                latex_source = main_tex.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                pass  # Non-critical if source can't be read

            # Compile
            if self.use_docker:
                html = self._compile_with_docker(source_dir, main_tex, output_dir)
            else:
                html = self._compile_locally(source_dir, main_tex, output_dir)

            # Copy generated assets if assets_dir is provided
            if assets_dir:
                assets_dir.mkdir(parents=True, exist_ok=True)
                # Copy both generated assets and source images
                self._copy_assets(output_dir, assets_dir)
                self._copy_source_images(source_dir, assets_dir)
                # Rewrite asset paths in HTML to point to API endpoint
                html = self._rewrite_asset_paths(html, paper_id)

            # Post-process: inject data-id attributes
            html = inject_data_ids(html, paper_id)

            # Extract metadata at compile time
            sections = extract_sections(html)
            equations = extract_equations(html)
            citations = extract_citations(html)
            doc_metadata = extract_document_metadata(html)

            return CompilationResult(
                html_content=html,
                sections=sections,
                equations=equations,
                citations=citations,
                metadata=doc_metadata,
                latex_source=latex_source,
            )

    @contextlib.contextmanager
    def _work_dir(self):
        """
        Provide a temporary working directory for compilation.

        In Docker (LATEXML_WORK_DIR set): creates a UUID subdir inside the named
        volume mount so that docker run can reference it by volume name.
        In dev (no env var): falls back to a regular temp directory.
        """
        work_dir_env = os.environ.get("LATEXML_WORK_DIR") if self.use_docker else None
        if work_dir_env:
            job_dir = Path(work_dir_env) / uuid.uuid4().hex
            job_dir.mkdir(parents=True, exist_ok=True)
            try:
                yield job_dir
            finally:
                shutil.rmtree(job_dir, ignore_errors=True)
        else:
            with tempfile.TemporaryDirectory() as tmpdir:
                yield Path(tmpdir)

    def _prepare_source(self, source_path: Path, dest_dir: Path) -> None:
        """Extract archive or copy single file to destination directory."""
        name = source_path.name.lower()

        if name.endswith('.tar.gz') or name.endswith('.tgz') or name.endswith('.tar'):
            with tarfile.open(source_path, 'r:*') as archive:
                # Safe extraction
                for member in archive.getmembers():
                    target = (dest_dir / member.name).resolve()
                    if not str(target).startswith(str(dest_dir.resolve())):
                        continue
                    archive.extract(member, dest_dir)
        elif name.endswith('.zip'):
            with zipfile.ZipFile(source_path, 'r') as archive:
                for member in archive.infolist():
                    target = (dest_dir / member.filename).resolve()
                    if not str(target).startswith(str(dest_dir.resolve())):
                        continue
                    archive.extract(member, dest_dir)
        elif name.endswith('.tex'):
            shutil.copy(source_path, dest_dir / source_path.name)
        else:
            raise ValueError(f"Unsupported source format: {source_path.suffix}")

    def _find_main_tex(self, source_dir: Path) -> Optional[Path]:
        """Find the main .tex file using heuristics."""
        tex_files = list(source_dir.rglob("*.tex"))
        if not tex_files:
            return None

        if len(tex_files) == 1:
            return tex_files[0]

        def score_tex(path: Path) -> int:
            score = 0
            name = path.name.lower()

            # Prefer common main file names
            if name in {"main.tex", "paper.tex", "ms.tex", "article.tex"}:
                score += 5

            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                return score

            # Must have documentclass
            if "\\documentclass" in text:
                score += 3

            # Must have begin{document}
            if "\\begin{document}" in text:
                score += 3

            # Longer files tend to be the main file
            score += min(len(text) // 5000, 3)

            return score

        return max(tex_files, key=score_tex)

    def _compile_with_docker(self, source_dir: Path, main_tex: Path, output_dir: Path) -> str:
        """Compile using Docker (latexml/ar5ivist with latexmlc)."""
        relative_tex = main_tex.relative_to(source_dir)
        output_html = output_dir / "output.html"

        volume_name = os.environ.get("LATEXML_VOLUME_NAME")
        work_dir_env = os.environ.get("LATEXML_WORK_DIR")

        if volume_name and work_dir_env:
            # Named volume mode: backend and ar5ivist share a Docker named volume.
            # Translate container-local paths to volume-relative paths so the
            # ar5ivist container (launched via the host socket) can resolve them.
            vol_root = Path(work_dir_env)
            source_in_vol = f"/workdir/{source_dir.relative_to(vol_root)}"
            output_in_vol = f"/workdir/{output_dir.relative_to(vol_root)}"
            cmd = [
                "docker", "run", "--rm",
                "-v", f"{volume_name}:/workdir",
                self.docker_image,
                f"{source_in_vol}/{relative_tex}",
                f"--dest={output_in_vol}/output.html",
                "--format=html5",
                "--pmml",  # Presentation MathML
                "--cmml",  # Content MathML
            ]
        else:
            # Bind mount mode (local dev, running directly on host)
            cmd = [
                "docker", "run", "--rm",
                "-v", f"{source_dir}:/source:ro",
                "-v", f"{output_dir}:/output",
                self.docker_image,
                f"/source/{relative_tex}",
                "--dest=/output/output.html",
                "--format=html5",
                "--pmml",  # Presentation MathML
                "--cmml",  # Content MathML
            ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            raise RuntimeError(f"latexmlc failed: {result.stderr}\n{result.stdout}")

        html = output_html.read_text(encoding="utf-8")

        # Extract body content only (LaTeXML outputs full HTML document)
        return self._extract_body(html)

    def _extract_body(self, html: str) -> str:
        """Extract content from <body> tag, stripping document wrapper."""
        import re
        # Match body content (non-greedy)
        match = re.search(r'<body[^>]*>(.*?)</body>', html, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1)
        # Fallback: return as-is if no body tag found
        return html

    def _compile_locally(self, source_dir: Path, main_tex: Path, output_dir: Path) -> str:
        """Compile using local latexml installation."""
        output_xml = output_dir / "output.xml"
        output_html = output_dir / "output.html"

        # Run latexml
        latexml_cmd = [
            "latexml",
            f"--dest={output_xml}",
            str(main_tex)
        ]

        result = subprocess.run(
            latexml_cmd,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=source_dir
        )
        if result.returncode != 0:
            raise RuntimeError(f"latexml failed: {result.stderr}")

        # Run latexmlpost
        latexmlpost_cmd = [
            "latexmlpost",
            f"--dest={output_html}",
            "--format=html5",
            "--mathml",
            str(output_xml)
        ]

        result = subprocess.run(latexmlpost_cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"latexmlpost failed: {result.stderr}")

        html = output_html.read_text(encoding="utf-8")
        return self._extract_body(html)

    def _copy_assets(self, output_dir: Path, assets_dir: Path) -> None:
        """Copy generated assets (images, CSS, etc.) to assets directory."""
        # LaTeXML generates images and other assets alongside the HTML
        # Copy all non-HTML files to the assets directory
        for item in output_dir.iterdir():
            if item.is_file() and item.suffix.lower() not in {'.html', '.xml'}:
                shutil.copy(item, assets_dir / item.name)

    def _copy_source_images(self, source_dir: Path, assets_dir: Path) -> None:
        """Copy image files from source directory to assets directory."""
        # Common image extensions used in LaTeX papers
        image_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.eps'}

        # Recursively find all image files in source directory
        for item in source_dir.rglob('*'):
            if item.is_file() and item.suffix.lower() in image_extensions:
                # Copy to assets directory, preserving only the filename
                # This matches how LaTeX typically references images (without subdirectories in HTML)
                dest_path = assets_dir / item.name
                # Don't overwrite if file already exists (LaTeXML might have generated a converted version)
                if not dest_path.exists():
                    shutil.copy(item, dest_path)

    def _rewrite_asset_paths(self, html: str, paper_id: str) -> str:
        """Rewrite asset paths in HTML to point to API endpoint with absolute URL."""
        # Use environment variable for API base URL, default to localhost:8000
        import os
        api_base = os.getenv('API_BASE_URL', 'http://localhost:8000')

        # Pattern matches src="path/to/file.ext" (with or without subdirectories)
        # We extract just the filename since all assets are flattened into assets_dir
        def replace_src(match):
            full_path = match.group(1)
            # Skip if already rewritten or is an absolute URL
            if full_path.startswith('http://') or full_path.startswith('https://') or '/api/papers/' in full_path:
                return match.group(0)  # Return unchanged
            # Extract just the filename (last component of path)
            filename = full_path.split('/')[-1]
            # Preserve the quote style from original
            quote = '"' if match.group(0).startswith('src="') else "'"
            return f'src={quote}{api_base}/api/papers/{paper_id}/assets/{filename}{quote}'

        # Match src with double or single quotes
        # [^"'] means "not a quote", + means one or more
        pattern = r'src=["\']([^"\']+\.(png|jpg|jpeg|gif|svg|css|js|pdf|eps))["\']'
        html = re.sub(pattern, replace_src, html)

        return html


# Convenience function for API usage
def compile_latex_to_html(
    source_path: Path,
    paper_id: str,
    use_docker: bool = True,
    assets_dir: Optional[Path] = None
) -> CompilationResult:
    """
    Compile LaTeX source to HTML with metadata extraction.

    Args:
        source_path: Path to source archive (.tar.gz, .zip) or .tex file
        paper_id: Unique paper identifier for data-id generation
        use_docker: Whether to use Docker for compilation
        assets_dir: Optional directory to save generated assets

    Returns:
        CompilationResult with HTML and extracted metadata
    """
    compiler = LaTeXMLCompiler(use_docker=use_docker)
    return compiler.compile(source_path, paper_id, assets_dir=assets_dir)
