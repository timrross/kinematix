/**
 * The mode switch (Tune ⇄ Build) plus, in Build mode, the tool palette and
 * undo/redo. Lives in the stage toolbar so the canvas tools sit right above the
 * canvas.
 */

import { useStore, type Tool } from '../state/store';

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Select / move a pivot' },
  { id: 'add', label: 'Add', hint: 'Tap empty space to add a pivot' },
  { id: 'link', label: 'Link', hint: 'Tap two pivots to connect them' },
  { id: 'delete', label: 'Delete', hint: 'Tap a pivot or link to remove it' },
];

export default function BuildToolbar() {
  const mode = useStore((s) => s.mode);
  const tool = useStore((s) => s.tool);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { setMode, setTool, undo, redo } = useStore.getState();

  return (
    <div className="buildbar">
      <div className="mode-toggle" role="tablist" aria-label="Editor mode">
        <button role="tab" aria-selected={mode === 'tune'} className={`mode-btn ${mode === 'tune' ? 'active' : ''}`} onClick={() => setMode('tune')}>Tune</button>
        <button role="tab" aria-selected={mode === 'build'} className={`mode-btn build ${mode === 'build' ? 'active' : ''}`} onClick={() => setMode('build')}>Build</button>
      </div>

      {mode === 'build' && (
        <>
          <div className="tool-palette" role="toolbar" aria-label="Build tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                className={`tool-btn ${tool === t.id ? 'active' : ''}`}
                title={t.hint}
                aria-pressed={tool === t.id}
                onClick={() => setTool(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="undo-group">
            <button className="tool-btn" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)">↶</button>
            <button className="tool-btn" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)">↷</button>
          </div>
        </>
      )}
    </div>
  );
}
