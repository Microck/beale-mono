import { useEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { FleetAppServer } from '@beale/app-server-runtime/protocol';

export function SidebarServerSelector({ servers, value, collapsed, onChange }: {
  servers: FleetAppServer[];
  value: string;
  collapsed: boolean;
  onChange: (serverId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const options = [{ id: 'local', name: 'Local' }, ...servers];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.id === value));
  const selected = options[selectedIndex]!;

  useEffect(() => {
    if (collapsed) setOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (!open) return undefined;
    optionRefs.current[selectedIndex]?.focus();
    const dismissOnOutsidePointer = (event: PointerEvent): void => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointer);
  }, [open, selectedIndex]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const currentIndex = optionRefs.current.findIndex((option) => option === document.activeElement);
    const nextIndex = event.key === 'ArrowDown' ? (currentIndex + 1) % options.length
      : event.key === 'ArrowUp' ? (currentIndex - 1 + options.length) % options.length
        : event.key === 'Home' ? 0
          : event.key === 'End' ? options.length - 1 : null;
    if (nextIndex === null) return;
    event.preventDefault();
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      ref={pickerRef}
      className="sidebar-server-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="sidebar-server-selector"
        title={selected.name}
        aria-label={`App server: ${selected.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className="sidebar-server-selector-label">{selected.name}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="sidebar-server-menu" role="menu" aria-label="App server" onKeyDown={handleMenuKeyDown}>
          {options.map((option, index) => (
            <button
              key={option.id}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === selected.id}
              tabIndex={index === selectedIndex ? 0 : -1}
              title={option.name}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                if (option.id !== value) onChange(option.id);
              }}
            >
              <span>{option.name}</span>
              {option.id === selected.id ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
