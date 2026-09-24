import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SearchableCombobox } from '../components/SearchableCombobox';
import { BitbucketBranchMeta, BitbucketRepositoryMeta, BitbucketUserMeta } from '../types';

describe('Searchable Multi-Select Combobox Integration & Usability Tests', () => {
  const sampleRepos: BitbucketRepositoryMeta[] = [
    {
      slug: 'auth-service',
      name: 'auth-service',
      projectKey: 'CORE',
      projectName: 'Core Infrastructure',
      isPrivate: true,
      defaultBranch: 'main',
      description: 'OAuth & SAML authentication service',
      fullName: 'CORE/auth-service',
    },
    {
      slug: 'backend-api',
      name: 'backend-api',
      projectKey: 'CORE',
      projectName: 'Core Infrastructure',
      isPrivate: true,
      defaultBranch: 'develop',
      description: 'Primary REST API Gateway',
      fullName: 'CORE/backend-api',
    },
    {
      slug: 'worker-engine',
      name: 'worker-engine',
      projectKey: 'PLATFORM',
      projectName: 'Platform Tools',
      isPrivate: false,
      defaultBranch: 'master',
      description: 'Asynchronous task queue worker',
      fullName: 'PLATFORM/worker-engine',
    },
  ];

  const sampleBranches: BitbucketBranchMeta[] = [
    { name: 'main', displayId: 'main', type: 'default', isDefault: true, latestCommit: 'a1b2c3d' },
    { name: 'release/v2.4.0', displayId: 'release/v2.4.0', type: 'release', isDefault: false, latestCommit: 'e4f5g6h' },
    { name: 'feature/saml-sso', displayId: 'feature/saml-sso', type: 'feature', isDefault: false, latestCommit: 'i7j8k9l' },
    { name: 'hotfix/token-leak', displayId: 'hotfix/token-leak', type: 'hotfix', isDefault: false, latestCommit: 'm0n1o2p' },
  ];

  const sampleUsers: BitbucketUserMeta[] = [
    {
      username: 'hungnv',
      displayName: 'Nguyen Van Hung',
      email: 'hungnv@internal.company.com',
      avatarUrl: 'https://api.dicebear.com/7.x/identicon/svg?seed=hungnv',
      active: true,
    },
    {
      username: 'techlead',
      displayName: 'Alex Rivers',
      email: 'alex.rivers@company.com',
      avatarUrl: null,
      active: true,
    },
    {
      username: 'bot-approver',
      displayName: 'CI Automated Approver',
      email: 'bot@company.internal',
      avatarUrl: null,
      active: true,
    },
  ];

  describe('1. Repositories Combobox (Search, Filter, Wildcards, Multi-Select)', () => {
    it('searches repositories with debounced query and renders rich metadata', async () => {
      const fetchRepos = vi.fn().mockImplementation(async (query: string) => {
        if (!query) return sampleRepos;
        return sampleRepos.filter((r) => r.fullName.toLowerCase().includes(query.toLowerCase()));
      });
      const handleChange = vi.fn();

      render(
        <SearchableCombobox<BitbucketRepositoryMeta>
          label="Target Repositories"
          sublabel="e.g. CORE/*, PROJ/backend-service"
          values={['CORE/auth-service']}
          onChange={handleChange}
          entityType="repository"
          allowWildcard={true}
          fetchOptions={fetchRepos}
          getItemValue={(r) => r.fullName}
          getItemLabel={(r) => r.description || r.slug}
          renderOption={(repo) => (
            <div className="flex items-center justify-between w-full">
              <span className="font-bold text-xs font-mono">[{repo.projectKey}] {repo.slug}</span>
              {repo.isPrivate && <span>Private</span>}
              {repo.defaultBranch && <span>{repo.defaultBranch}</span>}
            </div>
          )}
        />
      );

      // Verify label and initial chip
      expect(screen.getByText('Target Repositories')).toBeInTheDocument();
      expect(screen.getByText('CORE/auth-service')).toBeInTheDocument();

      // Open popover by focusing input
      const input = screen.getByPlaceholderText(/Add more or pattern.../i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('[CORE] auth-service')).toBeInTheDocument();
        expect(screen.getByText('[CORE] backend-api')).toBeInTheDocument();
        expect(screen.getByText('[PLATFORM] worker-engine')).toBeInTheDocument();
      });

      // Type search query
      fireEvent.change(input, { target: { value: 'worker' } });

      await waitFor(() => {
        expect(screen.getByText('[PLATFORM] worker-engine')).toBeInTheDocument();
        expect(screen.queryByText('[CORE] backend-api')).not.toBeInTheDocument();
      });

      // Select worker-engine
      fireEvent.click(screen.getByText('[PLATFORM] worker-engine'));

      // Both initial chip and newly added repo should be returned
      expect(handleChange).toHaveBeenCalledWith(['CORE/auth-service', 'PLATFORM/worker-engine']);
    });

    it('creates and renders amber wildcard chip pattern (e.g. CORE/*)', async () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox<BitbucketRepositoryMeta>
          label="Target Repositories"
          values={[]}
          onChange={handleChange}
          entityType="repository"
          allowWildcard={true}
          staticOptions={sampleRepos}
          getItemValue={(r) => r.fullName}
        />
      );

      const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'CORE/*' } });

      await waitFor(() => {
        expect(screen.getByText(/as wildcard pattern/i)).toBeInTheDocument();
      });

      // Click on wildcard option
      fireEvent.click(screen.getByText(/as wildcard pattern/i));

      expect(handleChange).toHaveBeenCalledWith(['CORE/*']);
    });

    it('removes a repository chip when clicking the X icon', () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox<BitbucketRepositoryMeta>
          label="Target Repositories"
          values={['CORE/auth-service', 'CORE/backend-api']}
          onChange={handleChange}
          entityType="repository"
          staticOptions={sampleRepos}
          getItemValue={(r) => r.fullName}
        />
      );

      const removeBtn = screen.getByLabelText('Remove CORE/auth-service');
      fireEvent.click(removeBtn);

      expect(handleChange).toHaveBeenCalledWith(['CORE/backend-api']);
    });
  });

  describe('2. Branches Combobox (Target & Source Branches, Categorized Badges)', () => {
    it('renders categorized branch types: default, release, feature, bugfix', async () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox<BitbucketBranchMeta>
          label="Target Branches (Destination)"
          values={['main']}
          onChange={handleChange}
          entityType="branch"
          allowWildcard={true}
          staticOptions={sampleBranches}
          getItemValue={(b) => b.name}
          renderOption={(branch) => (
            <div className="flex items-center justify-between w-full">
              <span>{branch.name}</span>
              <span className="capitalize">{branch.type}</span>
            </div>
          )}
        />
      );

      expect(screen.getByText('Target Branches (Destination)')).toBeInTheDocument();
      expect(screen.getByText('main')).toBeInTheDocument();

      const input = screen.getByPlaceholderText(/Add more or pattern.../i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('release/v2.4.0')).toBeInTheDocument();
        expect(screen.getByText('feature/saml-sso')).toBeInTheDocument();
        expect(screen.getByText('hotfix/token-leak')).toBeInTheDocument();
      });

      // Click release branch
      fireEvent.click(screen.getByText('release/v2.4.0'));
      expect(handleChange).toHaveBeenCalledWith(['main', 'release/v2.4.0']);
    });

    it('allows entering branch wildcards (e.g. release/*)', async () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox<BitbucketBranchMeta>
          label="Source Branches"
          values={[]}
          onChange={handleChange}
          entityType="branch"
          allowWildcard={true}
          staticOptions={sampleBranches}
          getItemValue={(b) => b.name}
        />
      );

      const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'feature/*' } });

      await waitFor(() => {
        expect(screen.getByText(/as wildcard pattern/i)).toBeInTheDocument();
      });

      // Press Enter to commit wildcard
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(handleChange).toHaveBeenCalledWith(['feature/*']);
    });
  });

  describe('3. Authors Combobox (Whitelist & Blacklist, Avatars, Wildcard *)', () => {
    it('renders user avatars, display names, @usernames and email addresses', async () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox<BitbucketUserMeta>
          label="Author Whitelist"
          values={['hungnv']}
          onChange={handleChange}
          entityType="user"
          allowWildcard={true}
          staticOptions={sampleUsers}
          getItemValue={(u) => u.username}
          renderOption={(user) => (
            <div className="flex items-center justify-between w-full">
              <span>{user.displayName}</span>
              <span>@{user.username}</span>
              {user.email && <span>{user.email}</span>}
            </div>
          )}
        />
      );

      expect(screen.getByText('Author Whitelist')).toBeInTheDocument();
      expect(screen.getByText('hungnv')).toBeInTheDocument();

      const input = screen.getByPlaceholderText(/Add more or pattern.../i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('Alex Rivers')).toBeInTheDocument();
        expect(screen.getByText('@techlead')).toBeInTheDocument();
        expect(screen.getByText('alex.rivers@company.com')).toBeInTheDocument();
      });

      // Select Alex Rivers
      fireEvent.click(screen.getByText('Alex Rivers'));
      expect(handleChange).toHaveBeenCalledWith(['hungnv', 'techlead']);
    });

    it('supports selecting wildcard "*" to approve pull requests for all authors', async () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox<BitbucketUserMeta>
          label="Author Whitelist"
          values={[]}
          onChange={handleChange}
          entityType="user"
          allowWildcard={true}
          staticOptions={sampleUsers}
          getItemValue={(u) => u.username}
        />
      );

      const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '*' } });

      await waitFor(() => {
        expect(screen.getByText(/as wildcard pattern/i)).toBeInTheDocument();
      });

      fireEvent.keyDown(input, { key: 'Enter' });
      expect(handleChange).toHaveBeenCalledWith(['*']);
    });
  });

  describe('4. WAI-ARIA 1.2 & Keyboard Navigation Compliance', () => {
    it('manages ARIA attributes correctly (role, aria-expanded, aria-multiselectable)', async () => {
      render(
        <SearchableCombobox
          label="Target Repositories"
          values={[]}
          onChange={vi.fn()}
          staticOptions={sampleRepos}
          getItemValue={(r) => r.fullName}
        />
      );

      const combobox = screen.getByRole('combobox');
      expect(combobox).toHaveAttribute('aria-expanded', 'false');
      expect(combobox).toHaveAttribute('aria-haspopup', 'listbox');

      const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(combobox).toHaveAttribute('aria-expanded', 'true');
        const listbox = screen.getByRole('listbox');
        expect(listbox).toBeInTheDocument();
        expect(listbox).toHaveAttribute('aria-multiselectable', 'true');
      });
    });

    it('navigates with ArrowDown, ArrowUp, Enter to select, and Escape to dismiss', async () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox
          label="Target Repositories"
          values={[]}
          onChange={handleChange}
          staticOptions={sampleRepos}
          getItemValue={(r) => r.fullName}
        />
      );

      const input = screen.getByPlaceholderText(/Type to search or enter pattern.../i);
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Press ArrowDown to highlight first item
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // Press Enter to select the highlighted item (first option is CORE/auth-service)
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(handleChange).toHaveBeenCalledWith(['CORE/auth-service']);

      // Press Escape to dismiss listbox
      fireEvent.keyDown(input, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });

    it('removes the last selected chip when pressing Backspace in an empty input', () => {
      const handleChange = vi.fn();

      render(
        <SearchableCombobox
          label="Target Repositories"
          values={['CORE/auth-service', 'CORE/backend-api']}
          onChange={handleChange}
          staticOptions={sampleRepos}
          getItemValue={(r) => r.fullName}
        />
      );

      const input = screen.getByPlaceholderText(/Add more or pattern.../i);
      // Press Backspace while query is empty
      fireEvent.keyDown(input, { key: 'Backspace' });

      // Should drop the last item (CORE/backend-api)
      expect(handleChange).toHaveBeenCalledWith(['CORE/auth-service']);
    });
  });
});
