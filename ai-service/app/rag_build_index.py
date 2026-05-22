from __future__ import annotations

from .adaptive_rag import AdaptiveRAGEngine


def main() -> None:
    engine = AdaptiveRAGEngine()
    status = engine.rebuild_index()
    print("Adaptive RAG index rebuilt successfully.")
    print(status)


if __name__ == "__main__":
    main()
