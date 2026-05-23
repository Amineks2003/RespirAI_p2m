from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, Optional

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


class RespirAIMCPClient:
    """Small MCP client wrapper for the RespirAI Multimodal MCP server.

    This client starts the MCP server as a subprocess using stdio transport.
    It is useful for demos, tests, and an external-agent proof of architecture.
    """

    def __init__(
        self,
        ai_service_dir: str | Path,
        python_command: str = "python",
    ) -> None:
        self.ai_service_dir = Path(ai_service_dir)
        self.python_command = python_command

    async def _call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        server_params = StdioServerParameters(
            command=self.python_command,
            args=["-m", "app.mcp_server"],
            cwd=str(self.ai_service_dir),
        )

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(tool_name, arguments=arguments)
                return self._decode_tool_result(result)

    async def list_tools(self) -> Any:
        server_params = StdioServerParameters(
            command=self.python_command,
            args=["-m", "app.mcp_server"],
            cwd=str(self.ai_service_dir),
        )

        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                return await session.list_tools()

    async def health_check(self) -> Dict[str, Any]:
        return await self._call_tool("health_check", {})

    async def list_rag_documents(self) -> Dict[str, Any]:
        return await self._call_tool("list_rag_documents", {})

    async def rebuild_rag_index(self) -> Dict[str, Any]:
        return await self._call_tool("rebuild_rag_index", {})

    async def predict_spo2_csv(
        self,
        csv_base64: str,
        filename: str = "patient_data.csv",
        top_k_guidelines: int = 6,
    ) -> Dict[str, Any]:
        return await self._call_tool(
            "predict_spo2_deterioration_from_csv",
            {
                "csv_base64": csv_base64,
                "filename": filename,
                "top_k_guidelines": top_k_guidelines,
            },
        )

    async def predict_apnea_wfdb(
        self,
        apn_base64: str,
        dat_base64: str,
        hea_base64: str,
        patient_id: str = "unknown",
        apn_filename: str = "record.apn",
        dat_filename: str = "record.dat",
        hea_filename: str = "record.hea",
        top_k_guidelines: int = 6,
    ) -> Dict[str, Any]:
        return await self._call_tool(
            "predict_apnea_from_wfdb_files",
            {
                "apn_base64": apn_base64,
                "dat_base64": dat_base64,
                "hea_base64": hea_base64,
                "patient_id": patient_id,
                "apn_filename": apn_filename,
                "dat_filename": dat_filename,
                "hea_filename": hea_filename,
                "top_k_guidelines": top_k_guidelines,
            },
        )

    async def run_multimodal_analysis(
        self,
        patient_id: str,
        model_key: str,
        csv_base64: Optional[str] = None,
        apn_base64: Optional[str] = None,
        dat_base64: Optional[str] = None,
        hea_base64: Optional[str] = None,
        top_k_guidelines: int = 6,
    ) -> Dict[str, Any]:
        return await self._call_tool(
            "run_multimodal_mcp_analysis",
            {
                "patient_id": patient_id,
                "model_key": model_key,
                "csv_base64": csv_base64,
                "apn_base64": apn_base64,
                "dat_base64": dat_base64,
                "hea_base64": hea_base64,
                "top_k_guidelines": top_k_guidelines,
            },
        )

    def _decode_tool_result(self, result: Any) -> Any:
        """Decode MCP tool result content into Python objects when possible."""
        content = getattr(result, "content", None)

        if not content:
            return result

        # FastMCP often returns text content with JSON serialization.
        first = content[0]
        text = getattr(first, "text", None)

        if text is None:
            return result

        try:
            return json.loads(text)
        except Exception:
            return {"text": text}


def run_async(coro):
    return asyncio.run(coro)
