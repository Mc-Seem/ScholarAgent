"""
HTML Span Utilities for Semantic Tooltips

Provides utility functions for managing tooltip spans in compiled HTML:
- remove_tooltip_spans: Remove spans for a specific entity
- remove_single_tooltip_span: Remove a specific span occurrence by dom_node_id
- validate_html_integrity: Validate HTML structure after modification

Note: Span injection is handled by ai_html_injection.inject_validated_occurrences,
which anchors the occurrences stored in the paper's semantic document. The LLM path
in that module is legacy and unused by the reader API. One occurrence may become
several adjacent spans when inline markup splits the term, so removal unwraps every
span carrying the entity id rather than assuming a single one.
"""

from typing import Tuple
from bs4 import BeautifulSoup


def remove_tooltip_spans(html: str, entity_id: str) -> str:
    """
    Remove all <span class="kg-entity"> tags for a specific entity.

    This unwraps the spans while preserving the text content, effectively
    reverting the HTML to its pre-injection state for this entity.

    Args:
        html: The HTML containing tooltip spans
        entity_id: The entity ID to remove (matches data-entity-id attribute)

    Returns:
        Modified HTML with spans removed
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Find all kg-entity spans with matching entity_id
    spans = soup.find_all('span', class_='kg-entity', attrs={'data-entity-id': entity_id})

    for span in spans:
        try:
            # Replace span with its text content
            span.unwrap()
        except Exception as e:
            print(f"Warning: Failed to unwrap span for entity {entity_id}: {e}")
            # If unwrap fails, try to at least remove the span and keep its text
            if span.parent:
                span.replace_with(span.get_text())

    return soup.decode(formatter='html')


def remove_single_tooltip_span(html: str, entity_id: str, dom_node_id: str) -> str:
    """
    Remove a single <span class="kg-entity"> tag with specific entity_id and dom_node_id.

    This unwraps only the span that matches both the entity_id and is within the
    specified DOM node, leaving other occurrences intact.

    Args:
        html: The HTML containing tooltip spans
        entity_id: The entity ID to remove (matches data-entity-id attribute)
        dom_node_id: The parent node ID containing the span to remove

    Returns:
        Modified HTML with the specific span removed
    """
    soup = BeautifulSoup(html, 'html.parser')

    # Find the parent node with the specified data-id
    parent_node = soup.find(attrs={'data-id': dom_node_id})

    if not parent_node:
        print(f"Warning: Could not find parent node with data-id={dom_node_id}")
        return html

    # Find kg-entity spans with matching entity_id within this parent
    spans = parent_node.find_all('span', class_='kg-entity', attrs={'data-entity-id': entity_id})

    for span in spans:
        try:
            # Replace span with its text content
            span.unwrap()
        except Exception as e:
            print(f"Warning: Failed to unwrap span for entity {entity_id} in node {dom_node_id}: {e}")
            # If unwrap fails, try to at least remove the span and keep its text
            if span.parent:
                span.replace_with(span.get_text())

    return soup.decode(formatter='html')


def validate_html_integrity(original_html: str, modified_html: str) -> Tuple[bool, str]:
    """
    Validate that HTML modification didn't break structure.

    Checks:
    - HTML is still parseable
    - No major structure changes (same number of sections, paragraphs)
    - Math tags preserved

    Args:
        original_html: The original HTML before modification
        modified_html: The HTML after modification

    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        original_soup = BeautifulSoup(original_html, 'html.parser')
        modified_soup = BeautifulSoup(modified_html, 'html.parser')

        # Check: Same number of major structural elements
        original_sections = len(original_soup.find_all(['section', 'div', 'article']))
        modified_sections = len(modified_soup.find_all(['section', 'div', 'article']))

        if abs(original_sections - modified_sections) > 5:  # Allow small variance
            return False, f"Section count mismatch: {original_sections} vs {modified_sections}"

        original_paras = len(original_soup.find_all('p'))
        modified_paras = len(modified_soup.find_all('p'))

        if abs(original_paras - modified_paras) > 5:
            return False, f"Paragraph count mismatch: {original_paras} vs {modified_paras}"

        # Check: Math tags preserved
        original_math = len(original_soup.find_all('math'))
        modified_math = len(modified_soup.find_all('math'))

        if original_math != modified_math:
            return False, f"Math tag count mismatch: {original_math} vs {modified_math}"

        return True, ""

    except Exception as e:
        return False, f"Validation failed: {e}"
