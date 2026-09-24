import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { StatsOverview } from '../components/StatsOverview';
import { SchedulerStatus } from '../types';

describe('Responsive Usability & Interaction Performance Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('1. Responsive Layout & Touch Targets', () => {
    it('provides minimum touch targets and mobile-first container wrapping', () => {
      render(
        <SearchableCombobox<string>
          label="Test Repositories"
          values={['CORE/api', 'CORE/billing']}
          onChange={vi.fn()}
          getItemValue={(v: string) => v}
        />
      );

      // The main container has min-height >= 44px (iOS/Android recommended touch target size >= 44px)
      const combobox = screen.getByRole('combobox');
      expect(combobox.className).toContain('min-h-[44px]');
      expect(combobox.className).toContain('flex-wrap');

      // Chips have accessible remove buttons with min dimensions
      const removeBtn = screen.getByLabelText('Remove CORE/api');
      expect(removeBtn).toBeInTheDocument();
      expect(removeBtn.tagName.toLowerCase()).toBe('button');
    });

    it('contains popover height with scrollable container to prevent mobile screen blowout', () => {
      render(
        <SearchableCombobox<string>
          label="Branches"
          values={[]}
          onChange={vi.fn()}
          staticOptions={['main', 'develop', 'release/1.0', 'feature/login', 'bugfix/patch']}
          getItemValue={(v: string) => v}
        />
      );

      const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
      fireEvent.focus(input);

      // Popover container must have max-height class and overflow-y-auto for viewports
      const listbox = screen.getByRole('listbox');
      expect(listbox).toBeInTheDocument();
      expect(listbox.innerHTML).toContain('max-h-[260px]');
      expect(listbox.innerHTML).toContain('overflow-y-auto');
    });

    it('StatsOverview employs adaptive multi-column grid layout across breakpoints', () => {
      const mockStatus: SchedulerStatus = {
        isRunning: true,
        activeJobsCount: 3,
        totalJobsCount: 5,
        lastExecutionAt: new Date().toISOString(),
        vpnConnected: true,
        bitbucketStatus: 'CONNECTED',
        totalApprovedCount: 42,
        uptimeSeconds: 3600,
      };

      const { container } = render(<StatsOverview status={mockStatus} />);

      // Verify grid adapts from 2 columns on mobile/tablet to 4 on desktop
      const grid = container.querySelector('.grid');
      expect(grid).toBeInTheDocument();
      expect(grid?.className).toContain('grid-cols-2');
      expect(grid?.className).toContain('lg:grid-cols-4');
    });
  });

  describe('2. Debounce Performance & API Throttling', () => {
    it('debounces rapid keystrokes by 250ms, issuing only a single API call', async () => {
      const fetchMock = vi.fn().mockResolvedValue([
        { name: 'CORE/auth-service' },
        { name: 'CORE/backend-api' },
      ]);

      render(
        <SearchableCombobox
          label="Repositories"
          values={[]}
          onChange={vi.fn()}
          fetchOptions={fetchMock}
          getItemValue={(item: any) => item.name}
        />
      );

      const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);

      // Focus opens the combobox (triggers initial load)
      act(() => {
        fireEvent.focus(input);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Rapidly type 5 keystrokes without waiting
      act(() => {
        fireEvent.change(input, { target: { value: 'b' } });
        fireEvent.change(input, { target: { value: 'ba' } });
        fireEvent.change(input, { target: { value: 'bac' } });
        fireEvent.change(input, { target: { value: 'back' } });
        fireEvent.change(input, { target: { value: 'backend' } });
      });

      // Before 250ms elapses, fetchMock should NOT have been called again
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Fast-forward by 249ms: still throttled
      act(() => {
        vi.advanceTimersByTime(249);
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance by 1 more ms (total 250ms): debounced call fires exactly once with final query
      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith('backend');
    });
  });
});
