"use client";

import { useRef, useState, type ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type AppSelectOption = {
  value: string;
  label: ReactNode;
  textValue?: string;
  marker?: ReactNode;
  disabled?: boolean;
};

type AppSelectProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly AppSelectOption[];
  "aria-label": string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  contentClassName?: string;
  displayValue?: ReactNode;
  title?: string;
  id?: string;
};

// Radix items cannot have an empty value. Encode all items so clear/all options
// stay selectable without colliding with real values, including imported names.
const encodeValue = (value: string) => `value:${value}`;

export function AppSelect({ value, onValueChange, options, "aria-label": label, disabled, required, className, contentClassName, displayValue, title, id }: AppSelectProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [invalid, setInvalid] = useState(false);
  const changeValue = (next: string) => {
    setInvalid(false);
    onValueChange(next);
  };

  return <><Select value={encodeValue(value)} onValueChange={next => changeValue(next.slice("value:".length))} disabled={disabled}>
    <SelectTrigger ref={triggerRef} id={id} aria-label={label} aria-required={required} aria-invalid={invalid || undefined} title={title} className={cn("h-9", className)}>
      <SelectValue>{displayValue}</SelectValue>
    </SelectTrigger>
    <SelectContent align="start" className={contentClassName}>
      {options.map(option => <SelectItem key={option.value} value={encodeValue(option.value)} disabled={option.disabled} textValue={option.textValue ?? (typeof option.label === "string" ? option.label : undefined)}>
        <span className="flex min-w-0 items-center gap-2">
          {option.marker && <span aria-hidden="true" className="flex shrink-0 items-center">{option.marker}</span>}
          <span className="truncate">{option.label}</span>
        </span>
      </SelectItem>)}
    </SelectContent>
  </Select>
    {/* Real empty values preserve native form validation despite encoded Radix items. */}
    {required && <select aria-hidden="true" tabIndex={-1} className="sr-only" required disabled={disabled} value={value} onChange={event => changeValue(event.target.value)} onInvalid={event => {
      event.preventDefault();
      setInvalid(true);
      triggerRef.current?.focus();
    }}>
      <option value="" />
      {options.filter(option => option.value !== "").map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.textValue ?? (typeof option.label === "string" ? option.label : option.value)}</option>)}
    </select>}
  </>;
}
