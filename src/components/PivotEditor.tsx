/**
 * Numeric pivot editor for users who want precision over dragging: pick a pivot,
 * type exact coordinates, toggle snap-to-grid, and tune the shock stroke.
 */

import type { Design } from '../kinematics/model';

interface Props {
  design: Design;
  selectedId: string | null;
  snap: boolean;
  gridSize: number;
  onMovePoint: (id: string, x: number, y: number) => void;
  onSelect: (id: string | null) => void;
  onSnap: (on: boolean) => void;
  onGridSize: (mm: number) => void;
  onShockStroke: (mm: number) => void;
}

export default function PivotEditor({
  design,
  selectedId,
  snap,
  gridSize,
  onMovePoint,
  onSelect,
  onSnap,
  onGridSize,
  onShockStroke,
}: Props) {
  const selected = design.points.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="editor">
      <div className="editor-row">
        <label className="field">
          <span>Pivot</span>
          <select
            value={selectedId ?? ''}
            onChange={(e) => onSelect(e.target.value || null)}
          >
            <option value="">Select a pivot…</option>
            {design.points.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.fixed ? ' (frame)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selected && (
        <div className="editor-row coords">
          <label className="field">
            <span>x (mm)</span>
            <input
              type="number"
              value={Math.round(selected.x * 10) / 10}
              step={snap ? gridSize : 1}
              onChange={(e) => onMovePoint(selected.id, parseFloat(e.target.value) || 0, selected.y)}
            />
          </label>
          <label className="field">
            <span>y (mm)</span>
            <input
              type="number"
              value={Math.round(selected.y * 10) / 10}
              step={snap ? gridSize : 1}
              onChange={(e) => onMovePoint(selected.id, selected.x, parseFloat(e.target.value) || 0)}
            />
          </label>
        </div>
      )}

      <div className="editor-row options">
        <label className="check">
          <input type="checkbox" checked={snap} onChange={(e) => onSnap(e.target.checked)} />
          Snap to grid
        </label>
        {snap && (
          <label className="field inline">
            <span>grid</span>
            <input
              type="number"
              min={1}
              value={gridSize}
              style={{ width: 56 }}
              onChange={(e) => onGridSize(parseFloat(e.target.value) || 1)}
            />
            <span className="unit">mm</span>
          </label>
        )}
      </div>

      <div className="editor-row">
        <label className="field">
          <span>Shock stroke: {design.shock.stroke.toFixed(0)} mm (eye-to-eye {design.shock.eyeToEye.toFixed(0)} mm)</span>
          <input
            type="range"
            min={20}
            max={Math.round(design.shock.eyeToEye * 0.6)}
            step={1}
            value={design.shock.stroke}
            onChange={(e) => onShockStroke(parseFloat(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
