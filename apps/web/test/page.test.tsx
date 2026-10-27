import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Page from '@/app/page';

describe('placeholder page', () => {
  it('renders shadcn components and the agent names from @ai-travel/contracts', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Plan a trip in one sentence' })).toBeInTheDocument();
    expect(screen.getByText('BudgetAuditor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan my trip' })).toBeDisabled();
  });
});
