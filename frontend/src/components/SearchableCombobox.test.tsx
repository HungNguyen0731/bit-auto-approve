import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchableCombobox } from './SearchableCombobox';

describe('SearchableCombobox Component', () => {
  const sampleOptions = [
    { fullName: 'CORE/auth-service', slug: 'auth-service', projectKey: 'CORE' },
    { fullName: 'CORE/backend-api', slug: 'backend-api', projectKey: 'CORE' },
    { fullName: 'PLATFORM/worker', slug: 'worker', projectKey: 'PLATFORM' },
  ];

  it('renders label, sublabel, and existing chip tags', () => {
    const handleChange = vi.fn();
    render(
      <SearchableCombobox
        label="Target Repositories"
        sublabel="e.g. CORE/*"
        values={['CORE/auth-service', '*-service']}
        onChange={handleChange}
        staticOptions={sampleOptions}
        getItemValue={(item) => item.fullName}
        getItemLabel={(item) => item.slug}
      />
    );

    expect(screen.getByText('Target Repositories')).toBeInTheDocument();
    expect(screen.getByText('e.g. CORE/*')).toBeInTheDocument();
    expect(screen.getByText('CORE/auth-service')).toBeInTheDocument();
    expect(screen.getByText('*-service')).toBeInTheDocument();
  });

  it('removes a chip when clicking its X button', () => {
    const handleChange = vi.fn();
    render(
      <SearchableCombobox
        label="Repositories"
        values={['CORE/auth-service', 'CORE/backend-api']}
        onChange={handleChange}
        staticOptions={sampleOptions}
        getItemValue={(item) => item.fullName}
      />
    );

    const removeBtn = screen.getByLabelText('Remove CORE/auth-service');
    fireEvent.click(removeBtn);

    expect(handleChange).toHaveBeenCalledWith(['CORE/backend-api']);
  });

  it('opens popover on click and lists options', async () => {
    const handleChange = vi.fn();
    render(
      <SearchableCombobox
        label="Repositories"
        values={[]}
        onChange={handleChange}
        staticOptions={sampleOptions}
        getItemValue={(item) => item.fullName}
        getItemLabel={(item) => item.slug}
      />
    );

    const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('CORE/backend-api')).toBeInTheDocument();
      expect(screen.getByText('PLATFORM/worker')).toBeInTheDocument();
    });
  });

  it('allows adding a custom wildcard pattern via typing and Enter', async () => {
    const handleChange = vi.fn();
    render(
      <SearchableCombobox
        label="Repositories"
        values={[]}
        onChange={handleChange}
        allowWildcard={true}
        staticOptions={sampleOptions}
        getItemValue={(item) => item.fullName}
      />
    );

    const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
    fireEvent.change(input, { target: { value: 'CORE/*' } });

    await waitFor(() => {
      expect(screen.getByText(/as wildcard pattern/i)).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleChange).toHaveBeenCalledWith(['CORE/*']);
  });

  it('removes the last tag on Backspace when input is empty', () => {
    const handleChange = vi.fn();
    render(
      <SearchableCombobox
        label="Repositories"
        values={['REPO-A', 'REPO-B']}
        onChange={handleChange}
        staticOptions={sampleOptions}
        getItemValue={(item) => item.fullName}
      />
    );

    const input = screen.getByPlaceholderText(/Add more or pattern.../i);
    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(handleChange).toHaveBeenCalledWith(['REPO-A']);
  });

  it('closes popover on Escape key', async () => {
    render(
      <SearchableCombobox
        label="Repositories"
        values={[]}
        onChange={vi.fn()}
        staticOptions={sampleOptions}
        getItemValue={(item) => item.fullName}
      />
    );

    const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});
