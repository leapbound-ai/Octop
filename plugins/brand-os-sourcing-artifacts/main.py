"""Keep sourcing report writes exact, through the host's normal write_file path.

No filesystem access or global report cache. Only consult verified tool messages
in this turn, and only replace content for the exact generated report filename.
Later user edits and all unrelated writes pass through unchanged.
"""

import json

from langchain_core.messages import HumanMessage, ToolMessage
from octop_harness.plugins import AgentMiddleware, PluginContext


class SourcingReportArtifacts(AgentMiddleware):
    def prepare(self, request):
        call = request.tool_call
        if call.get("name") != "write_file":
            return request
        args = call.get("args", {})
        path = str(args.get("file_path", "")).lstrip("/")
        if not path.startswith("outbound/选品报告-") or not path.endswith(".md"):
            return request
        state = request.state
        messages = (
            state.get("messages", [])
            if isinstance(state, dict)
            else getattr(state, "messages", [])
        )
        for message in reversed(messages):
            if isinstance(message, HumanMessage):
                break
            if (
                not isinstance(message, ToolMessage)
                or message.name != "run_breadth_research"
                or message.status == "error"
            ):
                continue
            if not isinstance(message.content, str):
                continue
            try:
                result = json.loads(message.content)
            except ValueError:
                continue
            if not isinstance(result, dict) or result.get("status") != "completed":
                continue
            if result.get("filename") != path or not isinstance(
                result.get("report_markdown"), str
            ):
                continue
            return request.override(
                tool_call={
                    **call,
                    "args": {**args, "content": result["report_markdown"]},
                }
            )
        return request

    def wrap_tool_call(self, request, handler):
        return handler(self.prepare(request))

    async def awrap_tool_call(self, request, handler):
        return await handler(self.prepare(request))


def setup(ctx: PluginContext) -> None:
    ctx.middleware(SourcingReportArtifacts(), priority=100)
