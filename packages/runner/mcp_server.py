"""MCP v2 stdio adapter: curated fixtures only, no arbitrary shell access."""
from mcp.server import MCPServer
from .core import registered, inspect, validate, run_fixture

mcp = MCPServer("Formal Tools Runner")

@mcp.tool()
def list_formal_tools() -> dict:
    """List supported tools and static validation status."""
    return {"tools": registered(), "static": validate()}

@mcp.tool()
def inspect_formal_tool(tool: str) -> dict:
    """Read a tool's existing version and positive/negative fixture contract."""
    return inspect(tool)

@mcp.tool()
def run_formal_fixture(tool: str, case: str, timeout_s: int = 30) -> dict:
    """Execute one committed test fixture; no arbitrary path or command."""
    return run_fixture(tool, case, timeout_s)

if __name__ == "__main__":
    mcp.run(transport="stdio")
