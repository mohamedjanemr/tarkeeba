import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.error_utils import (  # noqa: E402
    RateLimitError,
    is_rate_limit_error,
    is_session_limit_message,
)
from spec.phases.spec_phases import SpecPhaseMixin  # noqa: E402


class _UI:
    @staticmethod
    def print_status(*_args, **_kwargs):
        return None


class _SpecPhaseHarness(SpecPhaseMixin):
    def __init__(self, spec_dir: Path, run_agent_fn):
        self.spec_dir = spec_dir
        self.run_agent_fn = run_agent_fn
        self.ui = _UI()
        self.spec_validator = None


def test_claude_session_limit_notice_is_detected():
    message = "You've hit your session limit · resets 1:10am (Asia/Riyadh)"

    assert is_session_limit_message(message)
    assert is_rate_limit_error(RuntimeError(message))


def test_application_rate_limit_discussion_is_not_a_session_notice():
    assert not is_session_limit_message(
        "Add rate limiting to the application's authentication endpoints"
    )


@pytest.mark.asyncio
async def test_spec_writer_does_not_retry_provider_session_limit(tmp_path):
    calls = 0

    async def rate_limited_agent(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise RateLimitError(
            "You've hit your session limit · resets 1:10am (Asia/Riyadh)"
        )

    phase = _SpecPhaseHarness(tmp_path, rate_limited_agent)

    with pytest.raises(RateLimitError):
        await phase.phase_spec_writing()

    assert calls == 1
