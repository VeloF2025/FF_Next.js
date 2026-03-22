commit 6b824421265058dbedcee01453c44ab3134655b6
Author: Claude Sonnet 4.5 <claude@anthropic.com>
Date:   Sun Mar 22 17:45:05 2026 +0200

    conduit: add ← Prospective demote button on Executable rows

diff --git a/src/modules/conduit/components/PortfolioTable.tsx b/src/modules/conduit/components/PortfolioTable.tsx
index d26de898..9f7e9e02 100644
--- a/src/modules/conduit/components/PortfolioTable.tsx
+++ b/src/modules/conduit/components/PortfolioTable.tsx
@@ -44,14 +44,18 @@ interface ProjectsGridProps {
   tableLabel: string;
   defaultStatus: 'prospective' | 'executable' | 'wip';
   promoteLabel?: string;        // e.g. "→ Executable"
-  promoteToStatus?: 'executable' | 'wip';
-  onProjectPromoted?: (project: ConduitProject) => void; // called after promote so parent can add to next section
+  promoteToStatus?: 'prospective' | 'executable' | 'wip';
+  demoteLabel?: string;         // e.g. "← Prospective"
+  demoteToStatus?: 'prospective' | 'executable';
+  onProjectPromoted?: (project: ConduitProject) => void;
+  onProjectDemoted?: (project: ConduitProject) => void;
   showAddButton?: boolean;
 }
 
 function ProjectsGrid({
   initialProjects, tableLabel, defaultStatus,
   promoteLabel, promoteToStatus, onProjectPromoted,
+  demoteLabel, demoteToStatus, onProjectDemoted,
   showAddButton = true,
 }: ProjectsGridProps) {
   const [projects, setProjects] = useState<ConduitProject[]>(initialProjects);
@@ -127,6 +131,26 @@ function ProjectsGrid({
     }
   };
 
+  const demoteProject = async (project: ConduitProject) => {
+    if (!demoteToStatus) return;
+    setPromoting(prev => ({ ...prev, [project.id]: true }));
+    try {
+      const res = await fetch(`/api/conduit/projects/${project.id}`, {
+        method: 'PATCH',
+        headers: { 'Content-Type': 'application/json' },
+        body: JSON.stringify({ status: demoteToStatus }),
+      });
+      if (!res.ok) throw new Error(await res.text());
+      const { data } = await res.json() as { data: ConduitProject };
+      setProjects(prev => prev.filter(p => p.id !== project.id));
+      onProjectDemoted?.(data);
+    } catch (err) {
+      setError(err instanceof Error ? err.message : 'Move back failed');
+    } finally {
+      setPromoting(prev => ({ ...prev, [project.id]: false }));
+    }
+  };
+
   const toggleExpand = (id: string) => {
     setExpanded(prev => {
       const next = new Set(prev);
@@ -363,6 +387,19 @@ function ProjectsGrid({
                         {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : justSaved ? <CheckCircle2 className="w-3 h-3 text-emerald-300" /> : <Save className="w-3 h-3" />}
                         {isSaving ? 'Saving' : justSaved ? 'Saved' : 'Save'}
                       </button>
+                      {demoteToStatus && demoteLabel && (
+                        <button
+                          onClick={() => demoteProject(project)}
+                          disabled={promoting[project.id]}
+                          title={demoteLabel}
+                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-gray-200 disabled:opacity-40 transition-colors whitespace-nowrap"
+                        >
+                          {promoting[project.id]
+                            ? <Loader2 className="w-3 h-3 animate-spin" />
+                            : <ArrowRight className="w-3 h-3 rotate-180" />}
+                          {promoting[project.id] ? '…' : demoteLabel}
+                        </button>
+                      )}
                       {promoteToStatus && promoteLabel && (
                         <button
                           onClick={() => promoteProject(project)}
@@ -460,6 +497,9 @@ export function PortfolioTable({ prospectiveProjects, executableProjects, wipPro
           promoteLabel="→ WIP"
           promoteToStatus="wip"
           onProjectPromoted={p => setWip(prev => [...prev, p])}
+          demoteLabel="← Prospective"
+          demoteToStatus="prospective"
+          onProjectDemoted={p => setProspective(prev => [...prev, p])}
           showAddButton
         />
       </div>
