from __future__ import annotations

import argparse
import asyncio
import base64
import json
from pathlib import Path
from typing import Any, Dict, Optional

from .mcp_client import RespirAIMCPClient


def encode_file_base64(path: str | Path) -> str:
    path = Path(path)
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def print_report(result: Dict[str, Any]) -> None:
    """Human-readable report for the MCP Host demo."""
    if result.get("error"):
        print("\n❌ MCP analysis failed")
        print(result["error"])
        if result.get("traceback"):
            print(result["traceback"])
        return

    patient_id = result.get("patient_id", "unknown")
    risk_score = float(result.get("risk_score") or result.get("combined_risk_score") or 0.0)
    confidence = result.get("confidence")
    rag = result.get("rag") or {}
    summary = rag.get("summary") or result.get("explanation") or "No RAG summary returned."

    print("\n" + "=" * 72)
    print("RespirAI MCP Host Demo Report")
    print("=" * 72)
    print(f"Patient: {patient_id}")
    print(f"Risk score: {risk_score * 100:.1f}%")
    if confidence is not None:
        print(f"Confidence: {float(confidence) * 100:.1f}%")
    print("\nAdaptive RAG summary")
    print("-" * 72)
    print(summary)

    sources = rag.get("sources") or result.get("sources") or []
    if sources:
        print("\nSources used")
        print("-" * 72)
        seen = set()
        for source in sources:
            name = source.get("source") or source.get("title") or source.get("reference") or "Unknown source"
            page = source.get("page")
            key = (name, page)
            if key in seen:
                continue
            seen.add(key)
            page_label = f", p. {page}" if page else ""
            print(f"- {name}{page_label}")


async def main_async() -> None:
    parser = argparse.ArgumentParser(
        description="MCP Host demo for the eHealth multimodal AI system."
    )

    parser.add_argument(
        "--ai-service-dir",
        default=str(Path(__file__).resolve().parents[1]),
        help="Path to ai-service directory.",
    )
    parser.add_argument(
        "--python-command",
        default="python",
        help="Python command used to launch the MCP server.",
    )
    parser.add_argument(
        "--mode",
        choices=["health", "documents", "spo2", "apnea", "all"],
        default="health",
        help="Demo mode.",
    )
    parser.add_argument("--patient-id", default="#P-2287")
    parser.add_argument("--csv", help="CSV file for Model 2.")
    parser.add_argument("--apn", help=".apn file for Model 1.")
    parser.add_argument("--dat", help=".dat file for Model 1.")
    parser.add_argument("--hea", help=".hea file for Model 1.")
    parser.add_argument("--top-k-guidelines", type=int, default=6)
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print raw JSON instead of a readable report.",
    )

    args = parser.parse_args()

    client = RespirAIMCPClient(
        ai_service_dir=args.ai_service_dir,
        python_command=args.python_command,
    )

    if args.mode == "health":
        result = await client.health_check()
        print_json(result)
        return

    if args.mode == "documents":
        result = await client.list_rag_documents()
        print_json(result)
        return

    if args.mode == "spo2":
        if not args.csv:
            raise SystemExit("--csv is required for --mode spo2")

        result = await client.predict_spo2_csv(
            csv_base64=encode_file_base64(args.csv),
            filename=Path(args.csv).name,
            top_k_guidelines=args.top_k_guidelines,
        )

        print_json(result) if args.json else print_report(result)
        return

    if args.mode == "apnea":
        if not (args.apn and args.dat and args.hea):
            raise SystemExit("--apn, --dat and --hea are required for --mode apnea")

        result = await client.predict_apnea_wfdb(
            apn_base64=encode_file_base64(args.apn),
            dat_base64=encode_file_base64(args.dat),
            hea_base64=encode_file_base64(args.hea),
            patient_id=args.patient_id,
            apn_filename=Path(args.apn).name,
            dat_filename=Path(args.dat).name,
            hea_filename=Path(args.hea).name,
            top_k_guidelines=args.top_k_guidelines,
        )

        print_json(result) if args.json else print_report(result)
        return

    if args.mode == "all":
        csv_base64: Optional[str] = encode_file_base64(args.csv) if args.csv else None
        apn_base64: Optional[str] = encode_file_base64(args.apn) if args.apn else None
        dat_base64: Optional[str] = encode_file_base64(args.dat) if args.dat else None
        hea_base64: Optional[str] = encode_file_base64(args.hea) if args.hea else None

        result = await client.run_multimodal_analysis(
            patient_id=args.patient_id,
            model_key="all",
            csv_base64=csv_base64,
            apn_base64=apn_base64,
            dat_base64=dat_base64,
            hea_base64=hea_base64,
            top_k_guidelines=args.top_k_guidelines,
        )

        print_json(result)
        return


def main() -> None:
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
