#!/usr/bin/env node
// CLI 진입점. 서브커맨드 없이 실행하면 MCP stdio 서버로 동작한다 (Hermes 등 MCP 호스트가
// command+args만으로 바로 띄울 수 있어야 하므로 기본 동작이 서버여야 한다).
// 무거운 모듈(playwright, better-sqlite3)은 각 서브커맨드에서 dynamic import로만 로드한다.

const command = process.argv[2];

const USAGE = `fanding-mcp - fanding.kr MCP server

Usage:
  fanding-mcp              Run the MCP stdio server (default)
  fanding-mcp doctor       Check installation health (paths, browsers, API keys, handshake)
  fanding-mcp config       Print an MCP config snippet for Hermes / Claude Desktop
    --profile <name>       Use Hermes container paths (/opt/data/profiles/<name>/...)
  fanding-mcp help         Show this help
`;

switch (command) {
  case undefined:
  case "serve": {
    const { startServer } = await import("./server.js");
    await startServer();
    break;
  }
  case "doctor": {
    const { runDoctor } = await import("./cli/doctor.js");
    process.exitCode = await runDoctor();
    break;
  }
  case "config": {
    const { printConfig } = await import("./cli/config.js");
    printConfig(process.argv.slice(3));
    break;
  }
  case "help":
  case "--help":
  case "-h":
    console.log(USAGE);
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    console.error(USAGE);
    process.exitCode = 1;
}
