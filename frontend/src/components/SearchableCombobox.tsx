import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Plus,
  Loader2,
  FolderGit2,
  GitBranch,
  User,
  Check,
  Tag,
} from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label?: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: string;
  icon?: React.ReactNode;
  category?: string;
  isPrivate?: boolean;
  avatarUrl?: string | null;
}

export interface SearchableComboboxProps<T = any> {
  label: string;
  sublabel?: string;
  placeholder?: string;
  values: string[];
  onChange: (values: string[]) => void;
  icon?: React.ReactNode;
  allowWildcard?: boolean;
  entityType?: 'repository' | 'branch' | 'user' | 'custom';
  fetchOptions?: (query: string) => Promise<T[]>;
  staticOptions?: T[];
  getItemValue: (item: T) => string;
  getItemLabel?: (item: T) => string;
  renderOption?: (item: T, isSelected: boolean) => React.ReactNode;
  renderChip?: (val: string, onRemove: () => void) => React.ReactNode;
  helperText?: string;
  disabled?: boolean;
  enableSelectAll?: boolean;
  maxVisibleChips?: number;
}

export function SearchableCombobox<T>({
  label,
  sublabel,
  placeholder = 'Type to search or enter pattern...',
  values,
  onChange,
  icon,
  allowWildcard = true,
  entityType = 'custom',
  fetchOptions,
  staticOptions,
  getItemValue,
  getItemLabel,
  renderOption,
  renderChip,
  helperText,
  disabled = false,
  enableSelectAll = false,
  maxVisibleChips = 0,
}: SearchableComboboxProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [showAllSelected, setShowAllSelected] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Default chip icon by entity type
  const getChipIcon = (val: string) => {
    if (val.includes('*')) return <Tag className="w-3 h-3 text-amber-700" />;
    switch (entityType) {
      case 'repository':
        return <FolderGit2 className="w-3 h-3 text-brand-700" />;
      case 'branch':
        return <GitBranch className="w-3 h-3 text-indigo-700" />;
      case 'user':
        return <User className="w-3 h-3 text-emerald-700" />;
      default:
        return <Tag className="w-3 h-3 text-slate-600" />;
    }
  };

  // Perform search
  const loadData = useCallback(
    async (searchQuery: string) => {
      if (staticOptions) {
        if (!searchQuery.trim()) {
          setOptions(staticOptions);
        } else {
          const q = searchQuery.toLowerCase();
          setOptions(
            staticOptions.filter((item) => {
              const val = getItemValue(item).toLowerCase();
              const lbl = getItemLabel ? getItemLabel(item).toLowerCase() : '';
              return val.includes(q) || lbl.includes(q);
            })
          );
        }
        return;
      }

      if (fetchOptions) {
        setIsLoading(true);
        setLoadError(null);
        try {
          const res = await fetchOptions(searchQuery);
          setOptions(res);
        } catch (err) {
          setOptions([]);
          const error = err as { code?: string; message?: string; rateLimitReset?: number };
          if (error.code === 'AUTH_INVALID_TOKEN') setLoadError('Your Bitbucket token expired. Reconnect in Settings.');
          else if (error.code === 'RATE_LIMITED') setLoadError(`Bitbucket rate limit reached${error.rateLimitReset ? `. Retry in ${error.rateLimitReset}s.` : '.'}`);
          else setLoadError(error.message || 'Unable to load live Bitbucket data. Try again.');
        } finally {
          setIsLoading(false);
        }
      }
    },
    [fetchOptions, staticOptions, getItemValue, getItemLabel]
  );

  // Debounced query effect
  useEffect(() => {
    if (!isOpen) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      loadData(query);
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, isOpen, loadData]);

  // Initial load when opened
  useEffect(() => {
    if (isOpen) {
      loadData(query);
      setHighlightedIndex(-1);
    }
  }, [isOpen]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const addValue = (val: string) => {
    const trimmed = val.trim();
    if (!trimmed) return;
    if (!values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setQuery('');
    setHighlightedIndex(-1);
  };

  const removeValue = (val: string) => {
    onChange(values.filter((v) => v !== val));
  };

  const toggleValue = (val: string) => {
    if (values.includes(val)) {
      removeValue(val);
    } else {
      addValue(val);
    }
  };

  const optionValues = options.map(getItemValue);
  const allOptionsSelected = optionValues.length > 0 && optionValues.every((val) => values.includes(val));
  const visibleValues = maxVisibleChips > 0 && !showAllSelected
    ? values.slice(0, maxVisibleChips)
    : values;
  const hiddenValueCount = Math.max(values.length - visibleValues.length, 0);

  const selectAllOptions = () => {
    if (optionValues.length === 0 || allOptionsSelected) return;
    onChange([...values, ...optionValues.filter((val) => !values.includes(val))]);
  };

  // Check if query should show "Add as wildcard" option
  const showWildcardOption =
    allowWildcard &&
    query.trim().length > 0 &&
    !values.includes(query.trim()) &&
    !options.some((opt) => getItemValue(opt).toLowerCase() === query.trim().toLowerCase());

  // Keyboard navigation
  const totalSelectable = options.length + (showWildcardOption ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightedIndex((prev) => (prev < totalSelectable - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : totalSelectable - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }

      if (showWildcardOption && highlightedIndex === 0) {
        addValue(query);
        return;
      }

      const optionIndex = showWildcardOption ? highlightedIndex - 1 : highlightedIndex;
      if (optionIndex >= 0 && optionIndex < options.length) {
        const selectedVal = getItemValue(options[optionIndex]);
        toggleValue(selectedVal);
      } else if (query.trim()) {
        addValue(query);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlightedIndex(-1);
    } else if (e.key === 'Backspace' && !query && values.length > 0) {
      removeValue(values[values.length - 1]);
    }
  };

  return (
    <div className="space-y-1.5 min-w-0 max-w-full" ref={containerRef}>
      {/* Header Label */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 min-w-0">
          {icon}
          <span className="truncate">{label}</span>
        </label>
        {sublabel && <span className="text-[11px] text-slate-500 font-mono truncate max-w-[58%]">{sublabel}</span>}
      </div>

      {/* Main Input & Chip Box */}
      <div
        onClick={() => {
          if (!disabled) {
            setIsOpen(true);
            inputRef.current?.focus();
          }
        }}
        className={`min-h-[44px] max-w-full min-w-0 overflow-hidden p-1.5 bg-app-panel-strong border rounded-xl flex flex-wrap items-center gap-1.5 transition-all cursor-text ${
          isOpen
            ? 'border-brand-500 ring-2 ring-brand-200 shadow-sm'
            : 'border-app-line hover:border-brand-300'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {/* Selected Chips */}
        {visibleValues.map((val) => {
          if (renderChip) {
            return renderChip(val, () => removeValue(val));
          }

          const isWildcard = val.includes('*');
          return (
            <span
              key={val}
              className={`inline-flex max-w-full min-w-0 items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono transition-all animate-scale-in ${
                isWildcard
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-app-panel-muted text-app-ink border border-app-line'
              }`}
            >
              <span className="flex-shrink-0">{getChipIcon(val)}</span>
              <span className="min-w-0 truncate" aria-label={val}>{val}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeValue(val);
                }}
                className="hover:text-rose-400 p-0.5 rounded transition-colors text-slate-600"
                aria-label={`Remove ${val}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}

        {hiddenValueCount > 0 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowAllSelected(true);
            }}
            className="min-h-9 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100"
            aria-expanded={false}
            aria-label={`Show ${hiddenValueCount} more selected values`}
          >
            +{hiddenValueCount} selected
          </button>
        )}

        {showAllSelected && maxVisibleChips > 0 && values.length > maxVisibleChips && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setShowAllSelected(false);
            }}
            className="min-h-9 rounded-lg px-2.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-50"
            aria-expanded={true}
          >
            Show less
          </button>
        )}

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : 'Add more or pattern...'}
          className="flex-1 min-w-[140px] bg-transparent text-xs text-slate-900 placeholder-slate-600 outline-none px-2 py-1 font-mono"
        />

        {/* Right loading spinner or indicator */}
        {isLoading && (
          <div className="px-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-700" />
          </div>
        )}
      </div>

      {helperText && <p className="text-[11px] text-slate-500">{helperText}</p>}

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-multiselectable="true"
          className="relative z-50 mt-1 w-full rounded-xl bg-app-panel/98 backdrop-blur-xl border border-app-line shadow-float overflow-hidden animate-scale-in"
        >
          <div className="max-h-[260px] overflow-y-auto p-1.5 space-y-1">
            {/* Wildcard Option if typed */}
            {showWildcardOption && (
              <div
                role="option"
                aria-selected={false}
                onClick={() => addValue(query)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                  highlightedIndex === 0
                    ? 'bg-brand-100 text-brand-900 border-l-2 border-brand-500'
                    : 'hover:bg-amber-50 text-amber-800'
                }`}
              >
                <Plus className="w-3.5 h-3.5 text-amber-700 flex-shrink-0" />
                <span className="font-mono">
                  Add <strong className="text-amber-900">"{query.trim()}"</strong> as wildcard pattern
                </span>
              </div>
            )}

            {/* Loading state skeleton */}
            {isLoading && options.length === 0 && (
              <div className="p-3 text-center text-xs text-slate-600 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-700" />
                <span>Searching Bitbucket...</span>
              </div>
            )}

            {/* Empty state */}

              {loadError && !isLoading && (
                <div role="alert" className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center justify-between gap-3">
                  <span>{loadError}</span>
                  <button type="button" onClick={() => loadData(query)} className="min-h-11 px-3 rounded-lg border border-rose-300 bg-app-panel font-semibold hover:bg-rose-100">Retry</button>
                </div>
              )}

            {!isLoading && options.length === 0 && !showWildcardOption && (
              <div className="p-4 text-center text-xs text-slate-600">
                <p>No matching Bitbucket entities found.</p>
                {allowWildcard && query.trim() && (
                  <p className="mt-1 text-slate-500 font-mono text-[11px]">
                    Press Enter to use <span className="text-slate-700">"{query.trim()}"</span> as custom rule.
                  </p>
                )}
              </div>
            )}

            {/* Options List */}
            {options.map((item, idx) => {
              const val = getItemValue(item);
              const isSelected = values.includes(val);
              const currentIndex = showWildcardOption ? idx + 1 : idx;
              const isHighlighted = highlightedIndex === currentIndex;

              return (
                <div
                  key={`${val}-${idx}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => toggleValue(val)}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition-colors ${
                    isHighlighted
                      ? 'bg-blue-600/20 text-blue-100 border-l-2 border-blue-500'
                      : isSelected
                      ? 'bg-brand-50 text-app-ink'
                      : 'hover:bg-slate-100/60 text-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div
                      className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                        isSelected
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'border-app-line bg-app-panel-muted'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      {renderOption ? (
                        renderOption(item, isSelected)
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium truncate">{val}</span>
                          {getItemLabel && (
                            <span className="text-slate-500 text-[11px] truncate">
                              {getItemLabel(item)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Popover Footer */}
          <div className="px-3 py-2 bg-app-panel-muted border-t border-app-line flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono">
            <span>
              {options.length > 0 ? `Showing ${options.length} items` : 'Use * for wildcards'}
            </span>
            <div className="flex items-center gap-2">
              {values.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="min-h-11 px-2 font-semibold text-slate-600 hover:text-rose-700 transition-colors"
                >
                  Clear all ({values.length})
                </button>
              )}
              {enableSelectAll && optionValues.length > 0 && (
                <button
                  type="button"
                  onClick={selectAllOptions}
                  disabled={allOptionsSelected}
                  className="min-h-11 rounded-lg bg-brand-700 px-3 font-semibold text-white hover:bg-brand-800 disabled:cursor-default disabled:bg-slate-200 disabled:text-slate-500"
                  aria-label={query.trim() ? `Select all ${optionValues.length} matching items` : `Select all ${optionValues.length} items`}
                >
                  {allOptionsSelected
                    ? 'All shown selected'
                    : query.trim()
                    ? `Select matching (${optionValues.length})`
                    : `Select all (${optionValues.length})`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
