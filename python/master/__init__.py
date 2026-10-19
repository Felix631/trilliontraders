"""Master — the autonomous, self-learning market engine behind the Master tab.

The engine studies the volatility and jump indices, keeps a memory of what it
has read and how those reads settled, and emits the findings the frontend
renders. It is deliberately stdlib-only so the same code runs in the sandbox,
on a developer laptop and in the hosting builder.
"""

from .engine import ENGINE_VERSION, build_report, run_study  # noqa: F401
from .memory import Memory  # noqa: F401

__all__ = ["ENGINE_VERSION", "Memory", "build_report", "run_study"]
