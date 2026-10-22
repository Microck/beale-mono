import { useRef, useState, type JSX } from 'react';
import { Search } from 'lucide-react';

export function WorkspaceTitleSearch({ label, query, onChange }: {
  label: string;
  query: string;
  onChange: (query: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = (): void => {
    onChange('');
    setOpen(false);
  };
  return <div className={`campaign-board-title-search${open ? ' is-open' : ''}`} role="search">
    <button
      aria-label={open ? `Close ${label} search` : `Search ${label}`}
      aria-expanded={open}
      onClick={() => open ? close() : setOpen(true)}
      ref={buttonRef}
      title={open ? `Close ${label} search` : `Search ${label}`}
      type="button"
    ><Search aria-hidden="true" size={16} /></button>
    {open ? <input
      aria-label={`Filter ${label}`}
      autoFocus
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        close();
        buttonRef.current?.focus();
      }}
      placeholder={`Filter ${label}`}
      type="search"
      value={query}
    /> : null}
  </div>;
}

export function workspaceCatalogMatchesQuery(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return !normalizedQuery || fields.some((field) => field?.toLocaleLowerCase().includes(normalizedQuery));
}
