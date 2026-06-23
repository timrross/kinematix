/**
 * Travel animation control: play/pause cycling through the travel, plus a scrub
 * slider so you can park the suspension anywhere and read the metrics there.
 */

interface Props {
  playing: boolean;
  animPos: number;
  travelMm: number | null;
  totalTravelMm: number | null;
  onPlayToggle: () => void;
  onScrub: (t: number) => void;
}

export default function AnimationBar({ playing, animPos, travelMm, totalTravelMm, onPlayToggle, onScrub }: Props) {
  return (
    <div className="anim-bar">
      <button className="play-btn" onClick={onPlayToggle} aria-label={playing ? 'Pause' : 'Play travel animation'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        className="scrub"
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={animPos}
        onChange={(e) => onScrub(parseFloat(e.target.value))}
        aria-label="Suspension travel position"
      />
      <div className="travel-readout">
        {travelMm !== null && totalTravelMm !== null ? (
          <>
            <strong>{travelMm.toFixed(0)}</strong> / {totalTravelMm.toFixed(0)} mm
          </>
        ) : (
          '—'
        )}
      </div>
    </div>
  );
}
