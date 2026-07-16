/**
 * Small form controls used by the layer inspector: every scalar gets a
 * slider *and* a numeric entry field; colors get a picker plus alpha.
 */
import { useId, type ReactNode } from 'react';
import type { Rgba } from '../core/layers';

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group" open>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
  onChange: (value: number) => void;
}

export function SliderField({ label, value, min, max, step = 0.01, integer, onChange }: SliderFieldProps) {
  const id = useId();
  const parse = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(integer ? Math.trunc(n) : n);
  };
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={integer ? 1 : step}
        value={value}
        onChange={(e) => parse(e.target.value)}
      />
      <input
        className="num"
        type="number"
        step={integer ? 1 : step}
        value={value}
        onChange={(e) => parse(e.target.value)}
      />
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function CheckField({ label, value, onChange }: {
  label: string; value: boolean; onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export function TextField({ label, value, onChange }: {
  label: string; value: string; onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="text" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SeedField({ label, value, onChange }: {
  label: string; value: number; onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="num"
        type="number"
        step={1}
        min={0}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.trunc(n)));
        }}
      />
      <button
        type="button"
        className="dice"
        title="Random seed"
        onClick={() => onChange(Math.floor(Math.random() * 100000))}
      >
        🎲
      </button>
    </div>
  );
}

function channelHex(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
}

function rgbaToHex(c: Rgba): string {
  return `#${channelHex(c.r)}${channelHex(c.g)}${channelHex(c.b)}`;
}

export function ColorField({ label, value, onChange }: {
  label: string; value: Rgba; onChange: (value: Rgba) => void;
}) {
  const id = useId();
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="color"
        value={rgbaToHex(value)}
        onChange={(e) => {
          const hex = e.target.value;
          onChange({
            ...value,
            r: parseInt(hex.slice(1, 3), 16) / 255,
            g: parseInt(hex.slice(3, 5), 16) / 255,
            b: parseInt(hex.slice(5, 7), 16) / 255,
          });
        }}
      />
      <input
        className="num"
        type="number"
        title="Alpha"
        min={0}
        max={1}
        step={0.01}
        value={value.a}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange({ ...value, a: Math.min(1, Math.max(0, n)) });
        }}
      />
    </div>
  );
}
