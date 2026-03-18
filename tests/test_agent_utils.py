from backend.app.agents.utils import run_with_retry


class _FakeUsageResult:
    def __init__(self):
        self.usage_metadata = {
            "input_tokens": 11,
            "output_tokens": 7,
            "total_tokens": 18,
        }


def test_run_with_retry_records_profile_metrics():
    profile = {}

    result = run_with_retry(
        func=lambda: _FakeUsageResult(),
        max_retries=0,
        timeout_seconds=5,
        profile=profile,
        profile_stage="kg.test_stage",
    )

    assert isinstance(result, _FakeUsageResult)
    assert profile["kg.test_stage"]["calls"] == 1
    assert profile["kg.test_stage"]["attempts"] == 1
    assert profile["kg.test_stage"]["retries"] == 0
    assert profile["kg.test_stage"]["usage_available_calls"] == 1
    assert profile["kg.test_stage"]["input_tokens"] == 11
    assert profile["kg.test_stage"]["output_tokens"] == 7
    assert profile["kg.test_stage"]["total_tokens"] == 18
    assert profile["kg.test_stage"]["wall_time_seconds"] >= 0.0
