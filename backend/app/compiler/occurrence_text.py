"""Single definition of the text a semantic occurrence may anchor to.

Occurrence offsets are produced by the knowledge graph builder
(``_candidate_occurrences``) and resolved much later by the HTML injector
(``inject_validated_occurrences``). The two must agree character for character,
so the rule lives here instead of being spelled out twice.
"""

from typing import List

from bs4 import NavigableString, Tag


# LaTeXML keeps the TeX source of a formula in an ``<annotation>`` child and its
# MathML in siblings, so plain-text matching inside ``<math>`` happily finds
# ``KTO`` in ``\mathcal{L}_{KTO}``. An anchor there rewrites the formula source.
MATH_TAGS = {"math", "svg"}
NON_CONTENT_TAGS = {"script", "style"}


def is_annotatable_target(element: Tag) -> bool:
    """Whether a ``data-id`` element may host anchors at all."""
    if element.name in MATH_TAGS:
        return False
    return not any(
        isinstance(parent, Tag) and parent.name in MATH_TAGS
        for parent in element.parents
    )


def annotatable_strings(target: Tag) -> List[NavigableString]:
    """Text nodes of ``target`` that occurrence offsets are measured over.

    Excluded:

    * math and non-content subtrees, for the reason above;
    * descendants carrying their own ``data-id`` -- they are separate anchor
      targets, and counting their text here would let a paragraph and its nested
      node claim the same words twice.

    Text already wrapped in ``span.kg-entity`` deliberately stays in the count:
    anchoring splits one text node into three without changing the
    concatenation, so offsets survive later applies instead of drifting by the
    length of everything anchored earlier in the node.
    """
    return [
        item
        for item in target.descendants
        if isinstance(item, NavigableString)
        and not any(
            isinstance(parent, Tag)
            and (
                parent.name in MATH_TAGS
                or parent.name in NON_CONTENT_TAGS
                or parent.has_attr("data-id")
            )
            for parent in _parents_below(item, target)
        )
    ]


def annotatable_text(target: Tag) -> str:
    """Concatenation that occurrence ``start``/``end`` offsets index into."""
    return "".join(str(item) for item in annotatable_strings(target))


def _parents_below(node: NavigableString, target: Tag) -> List[Tag]:
    """Ancestors of ``node`` strictly inside ``target``.

    ``target`` itself is skipped: it always carries the ``data-id`` the
    occurrence points at, so including it would exclude every text node.
    """
    chain = []
    for parent in node.parents:
        if parent is target:
            break
        chain.append(parent)
    return chain
