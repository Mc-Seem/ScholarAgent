"""
Shared Utilities for LangGraph Agents

Common functionality used across knowledge_graph, html_injection, and other agents:
- Retry logic with exponential backoff
- Timeout handling
- HTML text extraction
- Section filtering
"""

import os
import time
from typing import Callable, List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from bs4 import BeautifulSoup


# =============================================================================
# Timeout & Retry Utilities
# =============================================================================

class TimeoutException(Exception):
    """Raised when an operation times out"""
    pass


def run_with_timeout(func: Callable, timeout_seconds: int, *args, **kwargs):
    """
    Run a function with a timeout using ThreadPoolExecutor.

    Thread-safe alternative to signal.alarm() which only works in main thread.
    """
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(func, *args, **kwargs)
        try:
            return future.result(timeout=timeout_seconds)
        except FuturesTimeoutError:
            raise TimeoutException(f"Operation timed out after {timeout_seconds} seconds")


def is_rate_limit_error(exception: Exception) -> bool:
    """Check if an exception is a rate limit error (429)"""
    error_str = str(exception)
    return "429" in error_str or "rate_limit" in error_str.lower()


def is_retryable_error(exception: Exception) -> bool:
    """Check if an exception is worth retrying"""
    error_str = str(exception)
    # Retry on rate limits, timeouts, and transient server errors
    retryable_patterns = [
        "429",  # Rate limit
        "rate_limit",
        "503",  # Service unavailable
        "502",  # Bad gateway
        "500",  # Internal server error (sometimes transient)
        "timeout",
        "connection",
    ]
    return any(pattern in error_str.lower() for pattern in retryable_patterns)


def run_with_retry(
    func: Callable,
    max_retries: int = 3,
    base_delay: float = 2.0,
    timeout_seconds: int = 120,
    func_args: tuple = (),
    func_kwargs: dict = None,
    profile: Optional[Dict[str, Any]] = None,
    profile_stage: Optional[str] = None,
):
    """
    Run a function with exponential backoff retry logic.

    Args:
        func: The function to call
        max_retries: Maximum number of retry attempts (default: 3)
        base_delay: Base delay in seconds for exponential backoff (default: 2.0)
        timeout_seconds: Timeout for each individual attempt (default: 120)
        func_args: Positional arguments to pass to func (as a tuple)
        func_kwargs: Keyword arguments to pass to func (as a dict)

    Returns:
        Result from func

    Raises:
        The last exception if all retries fail
    """
    if func_kwargs is None:
        func_kwargs = {}
    last_exception = None
    total_elapsed_seconds = 0.0

    def _extract_usage_metrics(result: Any) -> Dict[str, int]:
        usage = getattr(result, "usage_metadata", None)
        if usage is None:
            response_metadata = getattr(result, "response_metadata", None)
            if isinstance(response_metadata, dict):
                usage = response_metadata.get("token_usage") or response_metadata.get("usage")
        if not isinstance(usage, dict):
            return {}

        input_tokens = usage.get("input_tokens") or usage.get("prompt_tokens") or 0
        output_tokens = usage.get("output_tokens") or usage.get("completion_tokens") or 0
        total_tokens = usage.get("total_tokens") or (input_tokens + output_tokens)
        return {
            "input_tokens": int(input_tokens),
            "output_tokens": int(output_tokens),
            "total_tokens": int(total_tokens),
        }

    def _record_profile(result: Any, attempts_used: int, retries_used: int) -> None:
        if profile is None or not profile_stage:
            return
        stage_profile = profile.setdefault(profile_stage, {
            "calls": 0,
            "attempts": 0,
            "retries": 0,
            "wall_time_seconds": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "usage_available_calls": 0,
        })
        stage_profile["calls"] += 1
        stage_profile["attempts"] += attempts_used
        stage_profile["retries"] += retries_used
        stage_profile["wall_time_seconds"] += total_elapsed_seconds

        usage_metrics = _extract_usage_metrics(result)
        if usage_metrics:
            stage_profile["usage_available_calls"] += 1
            for key, value in usage_metrics.items():
                stage_profile[key] += value

    for attempt in range(max_retries + 1):  # +1 because first call is attempt 0
        started_at = time.perf_counter()
        try:
            # Run with timeout
            result = run_with_timeout(func, timeout_seconds, *func_args, **func_kwargs)
            total_elapsed_seconds += time.perf_counter() - started_at
            _record_profile(result, attempts_used=attempt + 1, retries_used=attempt)
            return result

        except TimeoutException as e:
            total_elapsed_seconds += time.perf_counter() - started_at
            last_exception = e
            if attempt < max_retries:
                delay = base_delay * (2 ** attempt)  # Exponential backoff
                print(f"\n      Timeout, retrying in {delay:.1f}s... (attempt {attempt + 1}/{max_retries})", end=" ", flush=True)
                time.sleep(delay)
            else:
                raise

        except Exception as e:
            last_exception = e
            total_elapsed_seconds += time.perf_counter() - started_at

            # Check if error is retryable
            if not is_retryable_error(e):
                raise  # Don't retry non-retryable errors

            if attempt < max_retries:
                # Calculate delay with extra time for rate limits
                if is_rate_limit_error(e):
                    delay = base_delay * (3 ** attempt)  # More aggressive backoff for rate limits
                    print(f"\n      Rate limit hit, waiting {delay:.1f}s... (attempt {attempt + 1}/{max_retries})", end=" ", flush=True)
                else:
                    delay = base_delay * (2 ** attempt)
                    print(f"\n      Error ({type(e).__name__}), retrying in {delay:.1f}s... (attempt {attempt + 1}/{max_retries})", end=" ", flush=True)

                time.sleep(delay)
            else:
                raise  # All retries exhausted

    # Should never reach here, but just in case
    if last_exception:
        raise last_exception


# =============================================================================
# HTML Utilities
# =============================================================================

def strip_html_tags(html: str) -> str:
    """
    Remove HTML tags from text for cleaner content.

    This is the canonical function used by all agents for extracting
    plain text from HTML sections.

    Args:
        html: HTML string to process

    Returns:
        Plain text with HTML tags removed
    """
    if not html:
        return ""
    soup = BeautifulSoup(html, 'html.parser')
    return soup.get_text(separator=' ', strip=True)


def filter_processable_sections(
    sections: List[Dict[str, Any]],
    min_text_length: int = 50
) -> List[Dict[str, Any]]:
    """
    Filter sections to only those with meaningful content.

    Used by both knowledge_graph and html_injection agents to determine
    which sections are worth processing.

    Args:
        sections: List of section dicts with 'content_html' field
        min_text_length: Minimum text length (after HTML stripping) to include

    Returns:
        Filtered list of sections with enough content
    """
    return [
        s for s in sections
        if len(strip_html_tags(s.get("content_html", ""))) >= min_text_length
    ]


def get_debug_flag(env_var: str) -> bool:
    """
    Check if debug mode is enabled via environment variable.

    Args:
        env_var: Name of the environment variable to check

    Returns:
        True if debug mode is enabled
    """
    return os.getenv(env_var, "false").lower() == "true"
