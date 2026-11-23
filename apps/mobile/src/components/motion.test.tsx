import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import { Stagger } from './motion';

function Fields() {
  // A component that renders a fragment of several fields, like a form inside <QueryView>.
  return (
    <>
      <Text>Currency</Text>
      <Text>Save</Text>
    </>
  );
}

describe('Stagger', () => {
  it('keeps the screen spacing inside each wrapper so fragment children never touch', async () => {
    await render(
      <View>
        <Stagger gap={16}>
          <Fields />
        </Stagger>
      </View>,
    );
    expect(screen.getByText('Save')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toMatch(/"gap":16/);
  });
});
