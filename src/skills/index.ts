/**
 * Skills Manager
 *
 * Lazy-loading skill system. Index loaded at startup,
 * full content loaded on demand.
 */

import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { rootLogger, sanitizeError } from "../utils/logger";
import type { SkillIndex, SkillDef } from "../types";

const SKILLS_DIR = path.join(homedir(), ".config", "Airgent", "skills");
const SKILLS_DIR_RESOLVED = path.resolve(SKILLS_DIR);

export class SkillsManager {
  private index: SkillIndex = { skills: [] };
  private loadedSkills = new Map<string, SkillDef>();
  private logger = rootLogger.child("skills");

  constructor() {
    this.loadIndex();
  }

  /**
   * Get the full skill index.
   */
  getIndex(): SkillIndex {
    return this.index;
  }

  /**
   * Get names of currently loaded (active) skills.
   */
  getActiveSkills(): string[] {
    return Array.from(this.loadedSkills.keys());
  }

  /**
   * Load a skill by name. Caches after first load.
   */
  loadSkill(name: string): SkillDef | null {
    if (this.loadedSkills.has(name)) {
      return this.loadedSkills.get(name)!;
    }

    const summary = this.index.skills.find(s => s.name === name);
    if (!summary) {
      this.logger.warn(`Skill not found: ${name}`);
      return null;
    }

    try {
      const skillPath = path.resolve(summary.filePath);
      if (!skillPath.startsWith(SKILLS_DIR_RESOLVED + "/") && skillPath !== SKILLS_DIR_RESOLVED) {
        this.logger.warn(`Skill path outside skills directory: ${summary.name}`);
        return null;
      }
      const content = fs.readFileSync(skillPath, "utf-8");
      const skill: SkillDef = {
        name: summary.name,
        description: summary.description,
        tags: summary.tags,
        content,
        version: "1.0",
      };
      this.loadedSkills.set(name, skill);
      this.logger.info(`Loaded skill: ${name}`);
      return skill;
    } catch (err) {
      this.logger.warn(`Failed to load skill ${name}: ${sanitizeError(err)}`);
      return null;
    }
  }

  /**
   * Inject skill content into a prompt via {{skill:name}} template syntax.
   */
  injectSkill(prompt: string, skillName: string): string {
    const skill = this.loadSkill(skillName);
    if (!skill) {
      return prompt.replace(new RegExp(`\\{\\{skill:${skillName}\\}\\}`, "g"), "");
    }

    const injection = `[Skill: ${skill.name}]\n${skill.content}\n[/Skill]`;
    return prompt.replace(new RegExp(`\\{\\{skill:${skillName}\\}\\}`, "g"), injection);
  }

  private loadIndex(): void {
    const indexPath = path.join(SKILLS_DIR, "index.json");
    try {
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, "utf-8");
        this.index = JSON.parse(raw);
        this.logger.info(`Loaded ${this.index.skills.length} skills from index`);
      } else {
        this.logger.info("No skills index found, creating default");
        fs.mkdirSync(SKILLS_DIR, { recursive: true });
        this.index = { skills: [] };
        fs.writeFileSync(indexPath, JSON.stringify(this.index, null, 2), { mode: 0o600 });
      }
    } catch (err) {
      this.logger.warn(`Failed to load skills: ${sanitizeError(err)}`);
      this.index = { skills: [] };
    }
  }
}
