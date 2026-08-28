import { describe, expect, it } from "vitest";
import { GreenfieldPublisher } from "../src/greenfield";

const cfg = {
  rpcUrl: "https://gnfd-testnet-fullnode-tendermint-ap.bnbchain.org",
  chainId: "5600",
  bucket: "free-web-mcp-evidence",
  privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const,
  accountAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const,
  spEndpoint: "https://gnfd-testnet-sp1.bnbchain.org",
};

describe("GreenfieldPublisher (pure parts)", () => {
  const p = new GreenfieldPublisher(cfg);

  it("derives a content-addressed sha256 for the payload", () => {
    const json = '{"a":1}';
    const h = p.contentHashOf(json);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(p.contentHashOf(json)).toBe(h); // deterministic
    expect(p.contentHashOf(json + " ")).not.toBe(h); // content-sensitive
  });

  it("builds the public view URL from bucket + object name", () => {
    expect(p.viewUrl("abc.json")).toBe(
      "https://gnfd-testnet-sp1.bnbchain.org/view/free-web-mcp-evidence/abc.json",
    );
  });

  it("objectName = contentHash + .json (content-addressed, immutable)", () => {
    const h = p.contentHashOf('{"b":2}');
    const uri = p.viewUrl(`${h}.json`);
    expect(uri).toContain(`${h}.json`);
  });
});
