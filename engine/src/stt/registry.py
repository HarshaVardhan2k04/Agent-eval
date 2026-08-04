"""Provider registry — resolve an STTProvider by name at request time.

Swapping the STT engine is a config change (STT_PROVIDER) or a per-request override,
never a code change at the call sites.
"""
from __future__ import annotations

from src import config
from src.stt.base import STTProvider
from src.stt.providers.soniox import SonioxProvider

# name -> provider class. Add new providers here (and a module under providers/).
_PROVIDERS: dict[str, type[STTProvider]] = {
    "soniox": SonioxProvider,
}

_instances: dict[str, STTProvider] = {}


def available() -> list[str]:
    return sorted(_PROVIDERS.keys())


def get_provider(name: str | None = None) -> STTProvider:
    key = (name or config.STT_PROVIDER or "soniox").lower()
    if key not in _PROVIDERS:
        raise ValueError(f"Unknown STT provider '{key}'. Available: {available()}")
    if key not in _instances:
        _instances[key] = _PROVIDERS[key]()
    return _instances[key]
