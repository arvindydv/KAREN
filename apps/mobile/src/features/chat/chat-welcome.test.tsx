import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ChatWelcome, SUGGESTIONS, SuggestionCards, greeting } from './chat-welcome';

describe('ChatWelcome', () => {
  const evening = new Date(2026, 10, 22, 19, 0);
  it('greets the user by name for the time of day', async () => {
    await render(<ChatWelcome name="Asha" now={evening} />);
    expect(screen.getByText('Good evening, Asha.')).toBeTruthy();
  });

  it('falls back to a neutral greeting without a name', async () => {
    await render(<ChatWelcome name={null} now={new Date(2026, 10, 22, 9, 0)} />);
    expect(screen.getByText('Good morning.')).toBeTruthy();
  });

  it('the orb starts a voice conversation when voice is available', async () => {
    const onTalk = jest.fn();
    await render(<ChatWelcome name="Asha" now={evening} onTalk={onTalk} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Tap KAREN to talk' }));
    expect(onTalk).toHaveBeenCalled();
  });
});

describe('greeting', () => {
  it('follows the clock', () => {
    expect(greeting('Ravi', new Date(2026, 0, 1, 2))).toBe('Hey, Ravi');
    expect(greeting('Ravi', new Date(2026, 0, 1, 14))).toBe('Good afternoon, Ravi');
    expect(greeting(null, new Date(2026, 0, 1, 2))).toBe('Hey there');
  });
});

describe('SuggestionCards', () => {
  it('sends the chosen starter prompt', async () => {
    const onPick = jest.fn();
    await render(<SuggestionCards onPick={onPick} disabled={false} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Suggestion: Plan my day' }));
    expect(onPick).toHaveBeenCalledWith(SUGGESTIONS[0]);
  });

  it('does nothing while disabled', async () => {
    const onPick = jest.fn();
    await render(<SuggestionCards onPick={onPick} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Suggestion: Plan my day' }));
    expect(onPick).not.toHaveBeenCalled();
  });
});
