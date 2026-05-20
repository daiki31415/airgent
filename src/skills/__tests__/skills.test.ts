/**
 * Tests for skills/index.ts (SkillsManager)
 *
 * SkillsManager reads from ~/.config/Airgent/skills/.
 * We create real test files in that directory and clean up after.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = join(process.env.HOME || "/tmp", ".config", "Airgent", "skills");

const TEST_SKILLS = [
  { name: "test-git", content: "# Test Git Skill\n\nUse git commands\n", desc: "Git operations" },
  { name: "test-docker", content: "# Test Docker Skill\n\nUse docker commands\n", desc: "Docker operations" },
];

const INDEX_PATH = join(SKILLS_DIR, "index.json");

function getIndexData(): object {
  return {
    skills: TEST_SKILLS.map((s) => ({
      name: s.name,
      description: s.desc,
      tags: [],
      filePath: join(SKILLS_DIR, `${s.name}.md`),
    })),
  };
}

function writeTestFiles() {
  mkdirSync(SKILLS_DIR, { recursive: true });
  writeFileSync(INDEX_PATH, JSON.stringify(getIndexData()), "utf-8");
  for (const s of TEST_SKILLS) {
    writeFileSync(join(SKILLS_DIR, `${s.name}.md`), s.content, "utf-8");
  }
}

function cleanTestFiles() {
  const files = ["index.json", ...TEST_SKILLS.map((s) => `${s.name}.md`)];
  for (const f of files) {
    const p = join(SKILLS_DIR, f);
    if (existsSync(p)) rmSync(p);
  }
}

describe("SkillsManager", () => {
  beforeAll(() => {
    writeTestFiles();
  });

  afterAll(() => {
    cleanTestFiles();
  });

  test("constructor loads index", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const index = mgr.getIndex();
    expect(index.skills).toBeDefined();
    expect(Array.isArray(index.skills)).toBe(true);
  });

  test("getIndex returns skill list", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const index = mgr.getIndex();
    const names = index.skills.map((s: any) => s.name);
    expect(names).toContain("test-git");
    expect(names).toContain("test-docker");
  });

  test("getActiveSkills returns empty initially", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    expect(mgr.getActiveSkills()).toEqual([]);
  });

  test("loadSkill loads a skill by name", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const skill = mgr.loadSkill("test-git");
    expect(skill).not.toBeNull();
    if (skill) {
      expect(skill.name).toBe("test-git");
      expect(skill.content).toContain("Test Git Skill");
      expect(skill.version).toBe("1.0");
    }
  });

  test("loadSkill returns null for unknown skill", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const skill = mgr.loadSkill("nonexistent");
    expect(skill).toBeNull();
  });

  test("loadSkill caches after first load", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const skill1 = mgr.loadSkill("test-docker");
    const skill2 = mgr.loadSkill("test-docker");
    expect(skill1).toBe(skill2);
  });

  test("getActiveSkills includes loaded skills", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    mgr.loadSkill("test-git");
    const active = mgr.getActiveSkills();
    expect(active).toContain("test-git");
  });

  test("injectSkill replaces {{skill:name}} placeholder with skill content", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const prompt = "Use {{skill:test-git}} to commit";
    const result = mgr.injectSkill(prompt, "test-git");
    expect(result).toContain("[Skill: test-git]");
    expect(result).toContain("[/Skill]");
    expect(result).not.toContain("{{skill:test-git}}");
  });

  test("injectSkill removes placeholder for unknown skill", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const prompt = "Use {{skill:unknown}} here";
    const result = mgr.injectSkill(prompt, "unknown");
    expect(result).toBe("Use  here");
  });

  test("injectSkill with no placeholder leaves prompt unchanged", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const prompt = "Just a normal prompt";
    const result = mgr.injectSkill(prompt, "test-git");
    expect(result).toBe("Just a normal prompt");
  });

  test("injectSkill with multiple placeholders replaces all", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const prompt = "{{skill:test-git}} and {{skill:test-git}} again";
    const result = mgr.injectSkill(prompt, "test-git");
    const occurrences = (result.match(/\[Skill: test-git\]/g) || []).length;
    expect(occurrences).toBe(2);
  });

  test("getActiveSkills returns all loaded skill names", () => {
    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    mgr.loadSkill("test-git");
    mgr.loadSkill("test-docker");
    const active = mgr.getActiveSkills();
    expect(active).toContain("test-git");
    expect(active).toContain("test-docker");
    expect(active.length).toBe(2);
  });

  test("loadSkill returns null for non-existent file", () => {
    // Write index with a skill pointing to missing file
    const badIndex = {
      skills: [
        { name: "ghost", description: "Ghost", tags: [], filePath: join(SKILLS_DIR, "ghost.md") },
      ],
    };
    writeFileSync(INDEX_PATH, JSON.stringify(badIndex), "utf-8");

    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const skill = mgr.loadSkill("ghost");
    expect(skill).toBeNull();

    // Restore index
    writeFileSync(INDEX_PATH, JSON.stringify(getIndexData()), "utf-8");
  });

  test("loadSkill returns null for path outside skills directory", () => {
    const outsideIndex = {
      skills: [
        { name: "outside", description: "Outside", tags: [], filePath: "/tmp/malicious.md" },
      ],
    };
    writeFileSync(INDEX_PATH, JSON.stringify(outsideIndex), "utf-8");

    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const skill = mgr.loadSkill("outside");
    expect(skill).toBeNull();

    // Restore index
    writeFileSync(INDEX_PATH, JSON.stringify(getIndexData()), "utf-8");
  });

  test("handles malformed index.json gracefully", () => {
    const backup = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, "utf-8") : "";
    writeFileSync(INDEX_PATH, "not valid json", "utf-8");

    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const index = mgr.getIndex();
    expect(index.skills).toEqual([]);

    // Restore
    writeFileSync(INDEX_PATH, JSON.stringify(getIndexData()), "utf-8");
  });

  test("handles missing index.json gracefully", () => {
    if (existsSync(INDEX_PATH)) rmSync(INDEX_PATH);

    const { SkillsManager } = require("../index");
    const mgr = new SkillsManager();
    const index = mgr.getIndex();
    expect(index.skills).toEqual([]);

    // Restore
    writeFileSync(INDEX_PATH, JSON.stringify(getIndexData()), "utf-8");
  });
});
