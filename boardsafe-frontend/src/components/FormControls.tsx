import type { InputHTMLAttributes, ReactNode } from "react";
import { fieldClass } from "./controls";

export function Field({
  label,
  id,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string }) {
  return (
    <label htmlFor={id} className={`block text-sm font-medium text-slate-200 ${className}`}>
      {label}
      <input {...props} id={id} className={fieldClass} />
    </label>
  );
}

export function SelectField({
  label,
  id,
  children,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={id} className={`block text-sm font-medium text-slate-200 ${className}`}>
      {label}
      <select {...props} id={id} className={fieldClass}>
        {children}
      </select>
    </label>
  );
}

export function CoordinateFields({
  prefix,
  lat,
  lon,
  onLat,
  onLon,
}: {
  prefix: string;
  lat: string;
  lon: string;
  onLat: (v: string) => void;
  onLon: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field
        id={`${prefix}-lat`}
        label={`Latitud (${prefix})`}
        type="number"
        step="any"
        min={-90}
        max={90}
        required
        value={lat}
        onChange={(e) => onLat(e.target.value)}
      />
      <Field
        id={`${prefix}-lon`}
        label={`Longitud (${prefix})`}
        type="number"
        step="any"
        min={-180}
        max={180}
        required
        value={lon}
        onChange={(e) => onLon(e.target.value)}
      />
    </div>
  );
}
