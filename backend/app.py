"""RentCheck backend: serves the web app and the Copilot API.

    python -m backend.app            # http://127.0.0.1:8787

    GET  /api/health          what is available: data quarter, MCP tools, language model
    POST /api/chat            Copilot answer as a server-sent event stream (tool | text | done | error)
    POST /api/second-opinion  extra AI-spotted warning signs, quotes verified against the listing

Without an API key (or without the openai-agents / mcp packages) the API reports that the language model is
unavailable and the web app answers from its own grounded, model-free mode over the same data.
"""
from __future__ import annotations

import json
import sys
from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import agent as copilot
from . import config

sys.path.insert(0, str(config.ROOT / "mcp_server"))
import core  # noqa: E402

state = {"server": None, "agent": None, "tools": [], "mcp_error": ""}


@asynccontextmanager
async def lifespan(app):
    ok, why = copilot.available()
    if copilot.SDK_ERROR:
        state["mcp_error"] = "MCP client packages are not installed (pip install -r requirements.txt)."
    else:
        try:
            server = copilot.mcp_server()
            await server.connect()
            state["server"] = server
            state["tools"] = [t.name for t in await server.list_tools()]
            if ok:
                state["agent"] = copilot.build_agent(server)
        except Exception as e:
            state["mcp_error"] = f"Could not start the RentCheck MCP server: {type(e).__name__}: {e}"
    print(f"RentCheck: data {core.qlabel(core.LATEST)} | MCP tools: {state['tools'] or state['mcp_error']} | "
          f"model: {config.MODEL if state['agent'] else 'unavailable (' + (why or state['mcp_error']) + ')'}")
    yield
    if state["server"]:
        try:
            await state["server"].cleanup()
        except Exception:
            pass


async def health(request: Request):
    ok, why = copilot.available()
    return JSONResponse({
        "ai": bool(state["agent"]), "ai_reason": "" if state["agent"] else (why or state["mcp_error"]),
        "model": config.MODEL if state["agent"] else None,
        "mcp": bool(state["server"]), "mcp_tools": state["tools"], "mcp_reason": state["mcp_error"],
        "data": core.data_info(),
    })


class NoCacheStatic(StaticFiles):
    """Static files that always revalidate, so a refreshed data file or script is picked up straight away."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


def sse(event: dict) -> str:
    return "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"


async def chat(request: Request):
    try:
        body = await request.json()
        question = str(body.get("question") or "").strip()
    except Exception:
        return JSONResponse({"error": "Send JSON with a question."}, status_code=400)
    if not question:
        return JSONResponse({"error": "Ask a question."}, status_code=400)
    if not state["agent"]:
        return JSONResponse({"error": "The language model is not available.", "code": "ai_unavailable"}, status_code=503)

    async def gen():
        try:
            async for ev in copilot.stream_answer(state["agent"], question, body.get("history"), body.get("context")):
                yield sse(ev)
        except Exception as e:
            print(f"chat error: {type(e).__name__}: {e}", file=sys.stderr)
            yield sse({"type": "error", "message": "The language model could not answer just now."})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


async def second_opinion(request: Request):
    if not state["agent"]:
        return JSONResponse({"error": "The language model is not available.", "code": "ai_unavailable"}, status_code=503)
    try:
        text = str((await request.json()).get("text") or "")
        return JSONResponse({"flags": await copilot.second_opinion(text)})
    except Exception as e:
        print(f"second-opinion error: {type(e).__name__}: {e}", file=sys.stderr)
        return JSONResponse({"error": "AI second opinion is unavailable right now."}, status_code=502)


app = Starlette(lifespan=lifespan, routes=[
    Route("/api/health", health),
    Route("/api/chat", chat, methods=["POST"]),
    Route("/api/second-opinion", second_opinion, methods=["POST"]),
    Mount("/", app=NoCacheStatic(directory=str(config.WEB_DIR), html=True)),
])

if __name__ == "__main__":
    import uvicorn
    print(f"RentCheck running at http://{config.HOST}:{config.PORT}")
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")
