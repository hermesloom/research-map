import { createHandler } from "@/lib/api/mcp";
/** Stateless MCP server (Streamable HTTP). Mount point only; tools live in lib/api/tools.ts. */
const handler = createHandler();
export { handler as GET, handler as POST, handler as DELETE };
