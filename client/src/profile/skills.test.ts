// client/src/profile/skills.test.ts
import { describe, expect, it } from "vitest";
import type { FieldDescriptor, ProfileDetails } from "../types/index";
import { baseKey, fitItems, flattenSkills, orderedSkillEntries, planSkillValues, rankSkills, skillFieldOf } from "./skills";

const SKILLS = ["Python", "Pytest", "Robot Framework", "Selenium WebDriver", "Docker", "Kubernetes (working knowledge)", "Java 8", "Python 3.11", "Go"];
const JOB = {
  title: "Senior QA Automation Engineer (Java)",
  description: "Strong Java and Selenium. Docker and k8s. Ready to go.",
};

function d(id: string, label: string, extra: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { id, selector: `#${id}`, label, type: "text", placeholder: "", options: [], required: false, ...extra };
}

describe("skills", (): void => {
  it("flattens categories in order without duplicates", (): void => {
    const details = { skills: { A: ["Python", "Pytest"], B: ["python", "Docker", " "] } } as unknown as ProfileDetails;
    expect(flattenSkills(details)).toEqual(["Python", "Pytest", "Docker"]);
    expect(flattenSkills(undefined)).toEqual([]);
  });

  it("keeps the user's category order after chrome.storage sorts the keys", (): void => {
    // What comes back from storage: keys sorted A-Z, order kept separately.
    const stored = JSON.parse(JSON.stringify({
      skills: { "AI tools": ["LangChain"], Other: ["Excel"], "Test automation": ["Python", "Robot Framework"] },
      skillOrder: ["Test automation", "AI tools", "Other"],
    })) as ProfileDetails;
    expect(flattenSkills(stored)).toEqual(["Python", "Robot Framework", "LangChain", "Excel"]);
    expect(orderedSkillEntries({ skills: { B: ["b"], A: ["a"] } })[0]?.[0]).toBe("B"); // old profiles: as stored
  });

  it("ranks job matches first, keeps candidate order for ties, collapses versions", (): void => {
    const ranked = rankSkills(SKILLS, JOB);
    expect(ranked[0]).toBe("Java 8");
    expect(new Set(ranked.slice(1, 4))).toEqual(new Set(["Selenium WebDriver", "Docker", "Kubernetes (working knowledge)"]));
    expect(ranked.slice(4, 6)).toEqual(["Python", "Pytest"]);
    expect(ranked).not.toContain("Python 3.11");
    expect(ranked.indexOf("Go")).toBe(ranked.length - 1); // "go" the verb is not Go
    expect(baseKey("Pydantic v2")).toBe("pydantic");
  });

  it("fits whole items only", (): void => {
    expect(fitItems(["Python", "Robot Framework", "Go"], 12)).toBe("Python, Go");
    expect(fitItems(["a", "b", "c"], undefined, 2)).toBe("a, b");
  });

  it("detects skill fields but not questions about skills", (): void => {
    expect(skillFieldOf(d("s", "Key skills"))).toEqual({ mode: "list" });
    expect(skillFieldOf(d("s", "Your top 5 skills"))).toEqual({ mode: "list", maxItems: 5 });
    expect(skillFieldOf(d("skill_2", "Skill 2"))).toEqual({ mode: "slot", slot: 2 });
    expect(skillFieldOf(d("y", "How many years of Python?"))).toBeNull();
    expect(skillFieldOf(d("n", "First name"))).toBeNull();
  });

  it("plans slots, limited lists and drop-downs by relevance", (): void => {
    const out = planSkillValues(SKILLS, [
      d("s2", "Skill 2"),
      d("s1", "Skill 1"),
      d("list", "Skills", { maxLength: 30 }),
      d("pick", "Main technology", { type: "select", options: ["C#", "Python", "Java"] }),
    ], JOB);
    expect(out["s1"]).toBe("Java 8");
    const ranked = rankSkills(SKILLS, JOB);
    expect(out["s2"]).toBe(ranked[1]);
    expect(out["list"]?.length).toBeLessThanOrEqual(30);
    expect(out["list"]?.startsWith(`Java 8, ${ranked[1]}`)).toBe(true);
    expect(out["pick"]).toBe("Java");
  });
});
