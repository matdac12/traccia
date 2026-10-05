# One service layer; MCP is stateless Streamable HTTP on Hono

REST handlers and MCP tools are thin adapters over the same service functions, and no business rules live in either. MCP uses `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport` mounted on a Hono `app.all("/mcp")`, stateless, with a fresh server per request. That avoids raw Node request and response objects. Auth runs in Hono before the transport, GET and DELETE return 405, and the body cap is raised for base64 uploads.
