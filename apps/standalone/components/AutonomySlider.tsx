'use client';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

const levels = [
  ['L0 · Manual', 'Every action is directed by a human operator.'],
  ['L1 · Assisted', 'The system proposes; a human decides.'],
  ['L2 · Standard', 'Bounded, read-only orchestration.'],
  ['L3 · Restricted', 'Dual approval is required for sensitive action.'],
  ['L4 · Autonomous', 'Unavailable in the local prototype.'],
];

export default function AutonomySlider() {
  const [level, setLevel] = useState(2);
  const [name, description] = levels[level];
  return <section className="control-card">
    <div className="control-heading"><h3><SlidersHorizontal size={15} aria-hidden="true" />Autonomy level</h3><span className="control-value">{level}/4</span></div>
    <input className="range" type="range" min="0" max="4" value={level} aria-label="Autonomy level" onChange={event => setLevel(Number(event.target.value))} />
    <strong>{name}</strong><p className="control-copy">{description}</p>
    {level >= 3 && <p className="control-note danger">This UI does not alter backend policy. Durable approval remains mandatory.</p>}
  </section>;
}
