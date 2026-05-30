import React, { useCallback, useEffect, useState } from "react";

interface SkillGroup {
  host: string;
  names: string[];
}

/**
 * Lists saved per-site skills (domain skills) grouped by host, with delete.
 * Rendered inside the WorkflowsPopover. A site skill is passive knowledge the
 * agent reads on future visits — so there is no "run", only review/remove.
 */
export const SiteSkillsSection: React.FC = () => {
  const [skills, setSkills] = useState<SkillGroup[]>([]);

  const refreshSkills = useCallback(async () => {
    const s = (await window.horizonAPI.invoke("domainSkill:list", {})) as
      | SkillGroup[]
      | undefined;
    setSkills(Array.isArray(s) ? s : []);
  }, []);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  const removeSkill = useCallback(
    async (host: string, name: string) => {
      try {
        await window.horizonAPI.invoke("domainSkill:remove", { host, name });
        await refreshSkills();
      } catch (err) {
        console.error("Failed to remove site skill:", err);
      }
    },
    [refreshSkills],
  );

  if (!skills.some((g) => g.names.length > 0)) return null;

  return (
    <div className="mt-2 max-h-40 overflow-y-auto">
      <div
        className="text-xs font-semibold px-2 py-1"
        style={{ color: "var(--chrome-fg-muted)" }}
      >
        Site skills
      </div>
      {skills.flatMap((g) =>
        g.names.map((n) => (
          <div
            key={`${g.host}/${n}`}
            className="flex items-center justify-between px-2 py-1 text-sm"
          >
            <span style={{ color: "var(--chrome-fg)" }}>{n}</span>
            <span className="text-xs" style={{ color: "var(--chrome-fg-subtle)" }}>
              {g.host}
            </span>
            <button
              type="button"
              aria-label={`Delete site skill ${n} for ${g.host}`}
              onClick={() => {
                void removeSkill(g.host, n);
              }}
              className="text-xs"
              style={{ background: "transparent", border: 0, cursor: "pointer", padding: "2px 4px", color: "var(--chrome-fg-muted)" }}
            >
              ✕
            </button>
          </div>
        )),
      )}
    </div>
  );
};
