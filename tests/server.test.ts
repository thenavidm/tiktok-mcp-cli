import { describe, expect, it } from "vitest";
import { connect } from "@thenavidm/slipway/testing";
import { app } from "../src/app.js";
import { ALL_TOOLS } from "../src/tools/index.js";

const BASE = {
  TIKTOK_CLIENT_KEY: "key",
  TIKTOK_CLIENT_SECRET: "secret",
  TIKTOK_REFRESH_TOKEN: "refresh",
};

/** What a client receives over MCP in this environment. */
async function listed(env: Record<string, string> = BASE) {
  const mcp = await connect(app, { env });
  const tools = await mcp.listTools();
  await mcp.close();
  return tools;
}

describe("tool registration", () => {
  it("registers every tool with a description and a title", () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name, "tool name").toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.title.length, `${tool.name} title`).toBeGreaterThan(0);
      /* A short description is the most common way a tool becomes unusable:
         the model is choosing from names and descriptions alone. */
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(60);
    }
  });

  it("gives every tool a unique name", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts an account argument on everything that reaches TikTok", async () => {
    for (const tool of await listed()) {
      if (tool.name === "list_accounts") continue;
      expect(Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}), tool.name).toContain("account");
    }
  });

  it("asks for approval on exactly the irreversible tools", async () => {
    const confirming = (await listed())
      .filter((tool) => "confirm" in ((tool.inputSchema as { properties?: object }).properties ?? {}))
      .map((tool) => tool.name);
    expect(confirming.sort()).toEqual(["post_photos", "post_video", "revoke_access"]);
  });

  it("does not guard the reversible writes", () => {
    /* Drafts land in the creator's own inbox and publish nothing. Confirming
       them would train the reflex that makes the confirm on post_video
       worthless, which is the whole reason this test exists. */
    for (const name of ["send_video_to_drafts", "send_photos_to_drafts"]) {
      const tool = ALL_TOOLS.find((t) => t.name === name)!;
      expect(tool.risk).toBe("write");
      expect(tool.requireConfirm).toBe(false);
    }
  });
});

describe("annotations", () => {
  it("marks reads read-only and irreversible writes destructive, and everything as reaching the network", async () => {
    const tools = await listed();
    for (const tool of tools) {
      const risk = ALL_TOOLS.find((t) => t.name === tool.name)!.risk;
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(risk === "read");
      expect(tool.annotations?.destructiveHint, tool.name).toBe(risk === "destructive");
      expect(tool.annotations?.openWorldHint, tool.name).toBe(true);
    }
  });
});

describe("read-only and destructive modes", () => {
  it("registers all 14 tools by default", async () => {
    expect((await listed()).length).toBe(14);
  });

  it("removes write tools entirely under TIKTOK_READ_ONLY", async () => {
    const names = (await listed({ ...BASE, TIKTOK_READ_ONLY: "1" })).map((tool) => tool.name);
    /* Removed, not refused: a model cannot call a tool it cannot see, and it
       cannot argue with a refusal it never receives. */
    for (const name of ["post_video", "post_photos", "send_video_to_drafts", "revoke_access"]) {
      expect(names).not.toContain(name);
    }
    expect(names.length).toBe(9);
  });

  it("keeps drafts and removes publishing under TIKTOK_ALLOW_DESTRUCTIVE=0", async () => {
    const names = (await listed({ ...BASE, TIKTOK_ALLOW_DESTRUCTIVE: "0" })).map((tool) => tool.name);
    expect(names).toContain("send_video_to_drafts");
    expect(names).not.toContain("post_video");
    expect(names.length).toBe(11);
  });
});
