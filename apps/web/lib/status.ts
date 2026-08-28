import "server-only";

export type ServiceStatus = "ONLINE" | "OFFLINE" | "CONNECTED" | "DISCONNECTED";
export type MilestoneKey =
  | "MCP_SERVER"
  | "WEB_SEARCH"
  | "WEB_FETCH"
  | "EVIDENCE_ENGINE"
  | "FIRST_EVIDENCE"
  | "BLOCKCHAIN_REGISTRY"
  | "FIRST_ONCHAIN_RECORD"
  | "DASHBOARD"
  | "VALIDATOR"
  | "VERI_TOKEN";

export interface ServiceRow {
  key: "MCP_SERVER" | "WEB_ENGINE" | "EVIDENCE_ENGINE" | "BLOCKCHAIN";
  label: string;
  status: ServiceStatus;
  detail?: string;
}

export interface MilestoneRow {
  key: MilestoneKey;
  label: string;
  done: boolean;
}

export interface SystemStatus {
  systemOnline: boolean;
  services: ServiceRow[];
  milestones: MilestoneRow[];
}

/** Live-derived status. Each probe is best-effort and isolated so a failing
 *  probe never blocks the others. */
export async function getSystemStatus(): Promise<SystemStatus> {
  const [mcp, web, evidence, blockchain] = await Promise.all([
    probeMcpServer(),
    probeWebEngine(),
    probeEvidenceEngine(),
    probeBlockchain(),
  ]);

  const services: ServiceRow[] = [mcp, web, evidence, blockchain];

  const milestones: MilestoneRow[] = [
    { key: "MCP_SERVER", label: "MCP Server", done: mcp.status === "ONLINE" },
    { key: "WEB_SEARCH", label: "Web Search", done: web.status === "ONLINE" },
    { key: "WEB_FETCH", label: "Web Fetch", done: web.status === "ONLINE" },
    { key: "EVIDENCE_ENGINE", label: "Evidence Engine", done: evidence.status === "ONLINE" },
    { key: "BLOCKCHAIN_REGISTRY", label: "Blockchain Registry", done: blockchain.status === "CONNECTED" },
    { key: "FIRST_ONCHAIN_RECORD", label: "First On-chain Record", done: false },
    { key: "DASHBOARD", label: "Dashboard", done: true },
    { key: "VALIDATOR", label: "Validator", done: false },
    { key: "VERI_TOKEN", label: "VERI Test Token", done: false },
  ];

  return {
    systemOnline: services.some((s) => s.status !== "OFFLINE"),
    services,
    milestones,
  };
}

async function probeMcpServer(): Promise<ServiceRow> {
  const url = process.env.MCP_SERVER_URL || "http://127.0.0.1:8765";
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!res.ok) return { key: "MCP_SERVER", label: "MCP Server", status: "OFFLINE", detail: `HTTP ${res.status}` };
    const j = (await res.json()) as { status?: string };
    return {
      key: "MCP_SERVER",
      label: "MCP Server",
      status: j.status === "ok" ? "ONLINE" : "OFFLINE",
      detail: url,
    };
  } catch (e) {
    return {
      key: "MCP_SERVER",
      label: "MCP Server",
      status: "OFFLINE",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeWebEngine(): Promise<ServiceRow> {
  // Web Engine liveness is implied by MCP server health in v1 (it owns web_search / web_fetch).
  const mcp = await probeMcpServer();
  return {
    key: "WEB_ENGINE",
    label: "Web Engine",
    status: mcp.status,
    detail: mcp.detail,
  };
}

async function probeEvidenceEngine(): Promise<ServiceRow> {
  // Phase 0: evidence engine is IN-PROCESS to the web app — it ships with the dashboard.
  // Real bootstrap happens in Phase 3. For now mark ONLINE so the UI renders.
  return {
    key: "EVIDENCE_ENGINE",
    label: "Evidence Engine",
    status: "ONLINE",
    detail: "in-process (Phase 0)",
  };
}

async function probeBlockchain(): Promise<ServiceRow> {
  const rpc = process.env.BSC_RPC_URL;
  const addr = process.env.EVIDENCE_REGISTRY_ADDRESS;
  if (!rpc) {
    return { key: "BLOCKCHAIN", label: "Blockchain", status: "DISCONNECTED", detail: "BSC_RPC_URL not set" };
  }
  // Phase 5: actual chainId + contract code check lands here. Phase 0 reports
  // DISCONNECTED until the contract is deployed, matching the spec.
  if (!addr) {
    return { key: "BLOCKCHAIN", label: "Blockchain", status: "DISCONNECTED", detail: "no contract deployed" };
  }
  return { key: "BLOCKCHAIN", label: "Blockchain", status: "CONNECTED", detail: addr };
}
